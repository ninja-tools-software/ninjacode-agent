import { describe, expect, it } from "vitest";
import {
  canonicalizeShellCommand,
  interpreterPayload,
  isNonGrantableShellCommand,
  parseShellInvocation,
  programBasename,
  splitShellSegments,
  tokenizeShellWords,
} from "./shellParse.js";

describe("shell parsing", () => {
  it("does not split operators inside quoted interpreter payloads", () => {
    expect(splitShellSegments("bash -c 'echo ok; rm -rf build' && echo done")).toEqual([
      "bash -c 'echo ok; rm -rf build'",
      "echo done",
    ]);
  });

  it("tokenizes quoted payloads as a single argument", () => {
    expect(parseShellInvocation("bash -lc 'git push --force origin main'")).toEqual({
      program: "bash",
      args: ["-lc", "git push --force origin main"],
    });
    expect(interpreterPayload("bash", ["-lc", "git push --force origin main"])).toBe(
      "git push --force origin main",
    );
  });

  it("marks interpreters, wrappers and substitutions non-grantable", () => {
    const commands = [
      "bash -c 'echo ok'",
      "sh -lc 'pnpm test'",
      "node -e 'console.log(1)'",
      "python3 -c 'print(1)'",
      "env FOO=1 pnpm test",
      "xargs rm < files.txt",
      "eval 'echo ok'",
      "echo $(date)",
      "cat <(printf x)",
    ];
    for (const command of commands) expect(isNonGrantableShellCommand(command), command).toBe(true);
  });

  it("keeps ordinary static commands grantable", () => {
    expect(isNonGrantableShellCommand("git status -s")).toBe(false);
    expect(isNonGrantableShellCommand("pnpm test && pnpm lint")).toBe(false);
  });

  it("canonicalizes unquoted whitespace and keeps quoted payloads intact", () => {
    expect(canonicalizeShellCommand("  ls   -la  ")).toBe("ls -la");
    expect(canonicalizeShellCommand("echo 'a  b'")).toBe("echo 'a  b'");
    expect(tokenizeShellWords("echo 'a  b'")).toEqual(["echo", "a  b"]);
    expect(programBasename("/usr/bin/git")).toBe("git");
  });

  it("treats variables, ANSI-C quotes and hex/octal encodings as non-grantable", () => {
    const commands = [
      "bash $'\\x2dc' 'rm -rf /'",
      "echo $HOME",
      "rm ${TARGET}",
      "printf '\\x2fetc\\x2fpasswd'",
    ];
    for (const command of commands) expect(isNonGrantableShellCommand(command), command).toBe(true);
  });

  it("treats heredocs, scripts and unknown wrappers as non-grantable", () => {
    const commands = [
      "cat <<EOF\nrm -rf /\nEOF",
      "./deploy.sh --prod",
      "scripts/run.py --all",
      "busybox sh -c 'rm -rf /'",
    ];
    for (const command of commands) expect(isNonGrantableShellCommand(command), command).toBe(true);
  });
});
