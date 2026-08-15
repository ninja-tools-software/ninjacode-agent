const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_INTERPRETERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const CODE_INTERPRETERS = new Set(["node", "python", "python2", "python3", "ruby", "perl"]);
const DYNAMIC_WRAPPERS = new Set([
  "eval",
  "xargs",
  "env",
  "nohup",
  "time",
  "nice",
  "timeout",
  "command",
  "stdbuf",
  "sudo",
  "doas",
  "su",
  "busybox",
  "entrypoint",
]);
const SCRIPT_SUFFIX = /\.(sh|bash|zsh|ksh|fish|py|js|mjs|cjs|rb|pl)$/;

interface ScanState {
  quote: "'" | '"' | null;
  escaped: boolean;
}

function separatorLength(input: string, index: number): number {
  const pair = input.slice(index, index + 2);
  if (pair === "&&" || pair === "||") return 2;
  return /[;|&\n]/.test(input[index] ?? "") ? 1 : 0;
}

/** Split only on unquoted shell operators. */
export function splitShellSegments(command: string): string[] {
  const out: string[] = [];
  const state: ScanState = { quote: null, escaped: false };
  let start = 0;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (state.escaped) {
      state.escaped = false;
      continue;
    }
    if (ch === "\\" && state.quote !== "'") {
      state.escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      state.quote = state.quote === ch ? null : state.quote ?? ch;
      continue;
    }
    if (state.quote) continue;
    const length = separatorLength(command, i);
    if (!length) continue;
    const segment = command.slice(start, i).trim();
    if (segment) out.push(segment);
    i += length - 1;
    start = i + 1;
  }
  const tail = command.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Minimal shell word tokenizer: removes quotes while preserving quoted whitespace. */
export function tokenizeShellWords(segment: string): string[] | null {
  const words: string[] = [];
  const state: ScanState = { quote: null, escaped: false };
  let word = "";
  let active = false;
  for (const ch of segment) {
    if (state.escaped) {
      word += ch;
      active = true;
      state.escaped = false;
      continue;
    }
    if (ch === "\\" && state.quote !== "'") {
      state.escaped = true;
      active = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (state.quote === ch) state.quote = null;
      else if (!state.quote) state.quote = ch;
      else word += ch;
      active = true;
      continue;
    }
    if (!state.quote && /\s/.test(ch)) {
      if (active) words.push(word);
      word = "";
      active = false;
      continue;
    }
    word += ch;
    active = true;
  }
  if (state.quote || state.escaped) return null;
  if (active) words.push(word);
  return words;
}

export function programBasename(program: string): string {
  const normalized = program.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function parseShellInvocation(
  segment: string,
): { program: string; args: string[] } | null {
  const tokens = tokenizeShellWords(segment);
  if (!tokens) return null;
  let index = 0;
  while (index < tokens.length && ASSIGNMENT.test(tokens[index]!)) index++;
  const raw = tokens[index];
  if (!raw) return null;
  return { program: programBasename(raw), args: tokens.slice(index + 1) };
}

function hasEvalFlag(program: string, args: string[]): boolean {
  if (SHELL_INTERPRETERS.has(program)) {
    return args.some((arg) => arg === "--command" || /^-[^-]*c/.test(arg));
  }
  if (program.startsWith("python")) return args.includes("-c");
  return CODE_INTERPRETERS.has(program) && args.some((arg) => arg === "-e" || arg === "--eval");
}

export function interpreterPayload(program: string, args: string[]): string | null {
  if (!SHELL_INTERPRETERS.has(program)) return null;
  const index = args.findIndex((arg) => arg === "--command" || /^-[^-]*c/.test(arg));
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function looksLikeScript(program: string): boolean {
  return program.startsWith(".") || program.includes("/") || SCRIPT_SUFFIX.test(program);
}

function invocationIsDynamic(program: string, args: string[]): boolean {
  if (DYNAMIC_WRAPPERS.has(program) || looksLikeScript(program)) return true;
  if (args.some((arg) => arg === "-c" || arg === "-e" || arg === "--eval" || arg === "--command")) {
    return true;
  }
  return hasEvalFlag(program, args);
}

/** Collapse unquoted whitespace so exact grants compare equivalent spellings. */
export function canonicalizeShellCommand(command: string): string {
  const state: ScanState = { quote: null, escaped: false };
  let out = "";
  let pendingSpace = false;
  for (const ch of command.trim()) {
    if (state.escaped) {
      out += ch;
      state.escaped = false;
      pendingSpace = false;
      continue;
    }
    if (ch === "\\" && state.quote !== "'") {
      if (pendingSpace) out += " ";
      pendingSpace = false;
      state.escaped = true;
      out += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (pendingSpace && !state.quote) out += " ";
      pendingSpace = false;
      state.quote = state.quote === ch ? null : (state.quote ?? ch);
      out += ch;
      continue;
    }
    if (!state.quote && /\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) out += " ";
    pendingSpace = false;
    out += ch;
  }
  return out;
}

/** Dynamic evaluation may change meaning between runs, so approval is never persisted. */
export function isNonGrantableShellCommand(command: string): boolean {
  const canonical = canonicalizeShellCommand(command);
  if (/(\$\(|`|<<|<\(|>\()/.test(canonical)) return true;
  if (/\$'|\$\{|\$[A-Za-z_*@?]/.test(canonical)) return true;
  if (/\\x[0-9a-fA-F]{2}|\\[0-7]{3}|\\u[0-9a-fA-F]{4}/.test(canonical)) return true;
  for (const segment of splitShellSegments(canonical)) {
    const parsed = parseShellInvocation(segment);
    if (!parsed || invocationIsDynamic(parsed.program, parsed.args)) return true;
  }
  return false;
}

export function isCodeInterpreter(program: string): boolean {
  return CODE_INTERPRETERS.has(program) && !SHELL_INTERPRETERS.has(program);
}

export function interpreterUsesEval(program: string, args: string[]): boolean {
  return hasEvalFlag(program, args);
}
