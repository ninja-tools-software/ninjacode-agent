import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import { repeatedReadWarning } from "./readChurn.js";

function read(path: string, args: { offset?: number; limit?: number } = {}): Message {
  const arguments_: Record<string, unknown> = { path };
  if (typeof args.offset === "number") arguments_.offset = args.offset;
  if (typeof args.limit === "number") arguments_.limit = args.limit;
  return {
    role: "assistant",
    content: "",
    toolCalls: [{ id: `r${args.offset ?? 0}-${args.limit ?? "all"}`, name: "read_file", arguments: arguments_ }],
  };
}

describe("repeatedReadWarning", () => {
  it("stays silent while each file is read a few times", () => {
    const history = [read("a.py"), read("a.py"), read("a.py"), read("b.py")];
    expect(repeatedReadWarning(history)).toBeUndefined();
  });

  it("fires when one file is paged over at shifting offsets that overlap", () => {
    // Offset-only reads extend to EOF, so each overlaps the previous.
    const history = [
      read("f.py", { offset: 85 }),
      read("f.py", { offset: 200 }),
      read("f.py", { offset: 240 }),
      read("f.py", { offset: 279 }),
    ];
    const warning = repeatedReadWarning(history);
    expect(warning).toContain("f.py");
    expect(warning).toContain("4 times");
  });

  it("allows disjoint pagination without warning", () => {
    const history = [
      read("f.py", { offset: 1, limit: 400 }),
      read("f.py", { offset: 401, limit: 400 }),
      read("f.py", { offset: 801, limit: 400 }),
      read("f.py", { offset: 1201, limit: 400 }),
    ];
    expect(repeatedReadWarning(history)).toBeUndefined();
  });

  it("warns once per path, so the cached suffix stops churning", () => {
    const history: Message[] = [read("f.py"), read("f.py"), read("f.py"), read("f.py")];
    const first = repeatedReadWarning(history);
    expect(first).toBeDefined();

    history.push({ role: "user", content: `[System] ${first}` }, read("f.py"));
    expect(repeatedReadWarning(history)).toBeUndefined();
  });

  it("still flags a second offender after the first is warned", () => {
    const history: Message[] = [read("f.py"), read("f.py"), read("f.py"), read("f.py")];
    history.push({ role: "user", content: `[System] ${repeatedReadWarning(history)}` });
    history.push(read("g.py"), read("g.py"), read("g.py"), read("g.py"));
    expect(repeatedReadWarning(history)).toContain("g.py");
  });

  it("names the worst offender first", () => {
    const history = [
      read("f.py"),
      read("f.py"),
      read("f.py"),
      read("f.py"),
      read("g.py"),
      read("g.py"),
      read("g.py"),
      read("g.py"),
      read("g.py"),
    ];
    expect(repeatedReadWarning(history)).toContain("g.py");
  });

  it("ignores searches and writes", () => {
    const history: Message[] = [
      { role: "assistant", content: "", toolCalls: [{ id: "1", name: "grep", arguments: { path: "f.py" } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "2", name: "grep", arguments: { path: "f.py" } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "3", name: "grep", arguments: { path: "f.py" } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "4", name: "edit_file", arguments: { path: "f.py" } }] },
      { role: "assistant", content: "", toolCalls: [{ id: "5", name: "edit_file", arguments: { path: "f.py" } }] },
    ];
    expect(repeatedReadWarning(history)).toBeUndefined();
  });

  it("warns after repeated shell dumps of the same artefact", () => {
    const dump = (id: string): Message => ({
      role: "assistant",
      content: "",
      toolCalls: [{ id, name: "run_shell", arguments: { command: "sed -n '1,80p' /tmp/orig.asm" } }],
    });
    const history = [dump("1"), dump("2"), dump("3"), dump("4")];
    const warning = repeatedReadWarning(history);
    expect(warning).toContain("orig.asm");
    expect(warning).toContain("inspected the same artefact");
    history.push({ role: "user", content: `[System] ${warning}` }, dump("5"));
    expect(repeatedReadWarning(history)).toBeUndefined();
  });
});
