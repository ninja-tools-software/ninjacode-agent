import { describe, expect, it } from "vitest";
import { shellGrantScopes } from "./shellScope.js";

describe("shellGrantScopes", () => {
  it("reduces a simple command to its program name", () => {
    expect(shellGrantScopes("grep foo bar.txt")).toEqual(["grep"]);
    expect(shellGrantScopes("cat README.md")).toEqual(["cat"]);
    expect(shellGrantScopes("ls -la")).toEqual(["ls"]);
  });

  it("keeps the subcommand for dispatch-style programs", () => {
    expect(shellGrantScopes("git push origin main")).toEqual(["git push"]);
    expect(shellGrantScopes("npm run build")).toEqual(["npm run"]);
    expect(shellGrantScopes("docker compose up")).toEqual(["docker compose"]);
  });

  it("falls back to the program when the next token is a flag", () => {
    expect(shellGrantScopes("git -C sub status")).toEqual(["git"]);
  });

  it("skips leading environment assignments", () => {
    expect(shellGrantScopes("FOO=1 BAR=2 ls")).toEqual(["ls"]);
  });

  it("strips a leading path from the program", () => {
    expect(shellGrantScopes("/usr/bin/grep foo")).toEqual(["grep"]);
  });

  it("collects a scope per segment of a chained command", () => {
    expect(shellGrantScopes("cat a | grep b")).toEqual(["cat", "grep"]);
    expect(shellGrantScopes("cd src && ls").sort()).toEqual(["cd", "ls"]);
  });

  it("dedupes repeated scopes", () => {
    expect(shellGrantScopes("cat a | cat b")).toEqual(["cat"]);
  });

  it("bails to exact-match (empty) for dynamic or unparseable commands", () => {
    expect(shellGrantScopes("echo $(date)")).toEqual([]);
    expect(shellGrantScopes("echo `whoami`")).toEqual([]);
    expect(shellGrantScopes("echo ${HOME}")).toEqual([]);
    expect(shellGrantScopes("   ")).toEqual([]);
  });
});
