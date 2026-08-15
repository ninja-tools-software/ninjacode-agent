/**
 * Blast-radius classification for shell commands.
 *
 * `run_shell` carries a static `shell` risk, which is enough to force an
 * approval the first time a command runs. It is not enough once the user
 * answers "always": a grant on the `git` command type covers `git push
 * --force` exactly as much as `git status`. This module recognises the command
 * shapes whose effect is hard or impossible to undo so the permission engine
 * can treat them as `destructive` and refuse to satisfy them from a coarse
 * grant.
 *
 * Matching is syntactic and deliberately conservative: it never decides
 * whether a given path is safe, only whether the command belongs to a known
 * irreversible family. False positives cost one approval prompt; false
 * negatives cost a workspace.
 */

import { segmentProgram, splitShellSegments } from "./shellScope.js";
import {
  interpreterPayload,
  interpreterUsesEval,
  isCodeInterpreter,
} from "./shellParse.js";

/** Programs that hand the command root privileges — scope is unbounded. */
const PRIVILEGE_ESCALATION = new Set(["sudo", "doas", "su"]);

/** Programs that are irreversible whatever their arguments. */
const ALWAYS_DESTRUCTIVE = new Map<string, string>([
  ["dd", "raw device write"],
  ["shred", "unrecoverable file destruction"],
  ["fdisk", "partition table edit"],
  ["parted", "partition table edit"],
  ["shutdown", "host shutdown"],
  ["reboot", "host reboot"],
  ["halt", "host shutdown"],
  ["poweroff", "host shutdown"],
]);

/** Fetchers whose output piped into an interpreter runs unreviewed remote code. */
const FETCHERS = new Set(["curl", "wget"]);
const INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

/** True for a bundled short flag such as `r` in `-rf`, but not for `--recursive`. */
function hasShortFlag(args: string[], letter: string): boolean {
  return args.some((a) => a.startsWith("-") && !a.startsWith("--") && a.slice(1).includes(letter));
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return args.some((a) => flags.includes(a));
}

function isRecursive(args: string[]): boolean {
  return hasShortFlag(args, "r") || hasShortFlag(args, "R") || hasFlag(args, "--recursive");
}

/** Operands only — flags and `key=value` tokens are not paths. */
function operands(args: string[]): string[] {
  return args.filter((a) => !a.startsWith("-") && !a.includes("="));
}

/**
 * A path the workspace confinement cannot vouch for: absolute, home-relative,
 * or climbing out with `..`. `run_shell` is not path-confined the way the fs
 * tools are, so these are the ones worth an extra prompt.
 */
function touchesOutsideWorkspace(args: string[]): boolean {
  return operands(args).some((a) => a.startsWith("/") || a.startsWith("~") || a.includes(".."));
}

function gitDanger(args: string[]): string | null {
  const [subcommand, ...rest] = args;
  if (subcommand === "push" && hasFlag(rest, "-f", "--force", "--force-with-lease")) {
    return "force push rewrites remote history";
  }
  if (subcommand === "push" && hasFlag(rest, "--delete", "-d")) return "remote branch deletion";
  if (subcommand === "reset" && hasFlag(rest, "--hard")) return "discards uncommitted work";
  if (subcommand === "clean" && (hasShortFlag(rest, "f") || hasFlag(rest, "--force"))) {
    return "deletes untracked files";
  }
  if (subcommand === "branch" && hasShortFlag(rest, "D")) return "force branch deletion";
  if (subcommand === "filter-branch" || subcommand === "filter-repo") return "rewrites history";
  return null;
}

function dockerDanger(args: string[]): string | null {
  const [subcommand, object] = args;
  if (subcommand === "system" && object === "prune") return "prunes docker state";
  if (subcommand === "rmi" || subcommand === "prune") return "removes docker images";
  if ((subcommand === "volume" || subcommand === "image") && object === "rm") {
    return "removes docker volumes or images";
  }
  return null;
}

/** Argument-dependent rules, keyed by program basename. */
const PROGRAM_RULES: Record<string, (args: string[]) => string | null> = {
  rm: (args) => {
    if (isRecursive(args)) return "recursive delete";
    if (touchesOutsideWorkspace(args)) return "delete outside the workspace";
    return null;
  },
  chmod: (args) =>
    isRecursive(args) || operands(args).includes("777") ? "recursive permission change" : null,
  chown: (args) => (isRecursive(args) ? "recursive ownership change" : null),
  git: gitDanger,
  docker: dockerDanger,
  "docker-compose": (args) =>
    args[0] === "down" && hasFlag(args, "-v", "--volumes") ? "removes compose volumes" : null,
  kubectl: (args) =>
    args[0] === "delete" || args[0] === "drain" ? "deletes cluster resources" : null,
  terraform: (args) =>
    args[0] === "apply" || args[0] === "destroy" ? "mutates real infrastructure" : null,
  gh: (args) => (args[1] === "delete" ? "deletes a GitHub resource" : null),
  npm: (args) => (args[0] === "publish" ? "publishes a package" : null),
  pnpm: (args) => (args[0] === "publish" ? "publishes a package" : null),
  yarn: (args) => (args[0] === "publish" ? "publishes a package" : null),
  bun: (args) => (args[0] === "publish" ? "publishes a package" : null),
  cargo: (args) => (args[0] === "publish" ? "publishes a crate" : null),
  find: (args) =>
    hasFlag(args, "-delete") || (args.includes("-exec") && args.includes("rm"))
      ? "bulk delete"
      : null,
};

/** Programs that run another command given as their arguments. */
const COMMAND_WRAPPERS = new Set([
  "xargs",
  "env",
  "nohup",
  "time",
  "nice",
  "timeout",
  "command",
  "stdbuf",
]);

/**
 * Argv of the command a wrapper is about to run: skip the wrapper's own flags,
 * `VAR=value` assignments and the leading duration `timeout` takes.
 */
function unwrapCommand(args: string[]): string[] | null {
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    const isWrapperOwn = token.startsWith("-") || token.includes("=") || /^\d+[smhd]?$/.test(token);
    if (!isWrapperOwn) break;
    i++;
  }
  const inner = args.slice(i);
  return inner.length > 0 ? inner : null;
}

function basename(program: string): string {
  const slash = program.lastIndexOf("/");
  return slash === -1 ? program : program.slice(slash + 1);
}

function interpreterDanger(program: string, args: string[], depth: number): string | null {
  if (!interpreterUsesEval(program, args)) return null;
  if (isCodeInterpreter(program)) return "executes dynamic code";
  const payload = interpreterPayload(program, args);
  if (!payload || depth >= 4) return "executes dynamic shell code";
  return classifyShellDangerInternal(payload, depth + 1);
}

function argvDanger(program: string, args: string[], depth: number): string | null {
  if (PRIVILEGE_ESCALATION.has(program)) return "runs with elevated privileges";
  if (program === "eval") return "evaluates a dynamic shell command";
  const always = ALWAYS_DESTRUCTIVE.get(program);
  if (always) return always;
  if (program.startsWith("mkfs")) return "formats a filesystem";

  const interpreted = interpreterDanger(program, args, depth);
  if (interpreted) return interpreted;

  const rule = PROGRAM_RULES[program];
  if (rule) return rule(args);

  // `xargs rm -r`, `timeout 5 rm -rf x`: the danger is in the wrapped command.
  if (depth < 2 && COMMAND_WRAPPERS.has(program)) {
    const inner = unwrapCommand(args);
    if (inner) return argvDanger(basename(inner[0]!), inner.slice(1), depth + 1);
  }
  return null;
}

function segmentDanger(segment: string, depth: number): string | null {
  const parsed = segmentProgram(segment);
  if (!parsed) return null;
  return argvDanger(parsed.program, parsed.args, depth);
}

/** Fork bomb, in its usual spellings. */
const FORK_BOMB = /:\s*\(\s*\)\s*\{|:\|:&/;
/** Output redirected onto a block device rather than a file. */
const DEVICE_REDIRECT = />\s*\/dev\/(sd|disk|nvme|hd)/;

function rawCommandDanger(command: string): string | null {
  if (FORK_BOMB.test(command)) return "fork bomb";
  if (DEVICE_REDIRECT.test(command)) return "writes to a block device";
  return null;
}

/**
 * Remote code fetched and piped straight into an interpreter. Checked across
 * segments rather than per segment, since the fetch and the execution are two
 * different programs joined by a pipe.
 */
function remoteExecutionDanger(programs: string[]): string | null {
  if (programs.length < 2) return null;
  const fetches = programs.some((p) => FETCHERS.has(p));
  const interprets = programs.some((p) => INTERPRETERS.has(p));
  return fetches && interprets ? "executes unreviewed remote code" : null;
}

/**
 * Classify a shell command. Returns a short English reason when the command is
 * irreversible enough to warrant the `destructive` risk class, or null when it
 * is an ordinary shell command.
 */
function classifyShellDangerInternal(command: string, depth: number): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const raw = rawCommandDanger(trimmed);
  if (raw) return raw;

  const segments = splitShellSegments(trimmed);
  const programs: string[] = [];
  for (const segment of segments) {
    const reason = segmentDanger(segment, depth);
    if (reason) return reason;
    const parsed = segmentProgram(segment);
    if (parsed) programs.push(parsed.program);
  }

  return remoteExecutionDanger(programs);
}

export function classifyShellDanger(command: string): string | null {
  return classifyShellDangerInternal(command, 0);
}
