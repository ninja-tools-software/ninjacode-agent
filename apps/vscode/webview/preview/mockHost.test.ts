import { describe, expect, it } from "vitest";
import type { HostToWebview, UiLogItem } from "../../src/protocol.js";
import { createMockHost } from "./mockHost.js";
import { empty } from "./scenarios/basics.js";
import { kitchenSink } from "./scenarios/kitchenSink.js";
import { SCENARIOS } from "./scenarios/index.js";

function collect(scenario = kitchenSink) {
  const sent: HostToWebview[] = [];
  const host = createMockHost((msg) => sent.push(msg), scenario);
  return { sent, host };
}

/** Every branch of the `UiLogItem` union, so the preview cannot silently lose one. */
const LOG_KINDS: Array<UiLogItem["kind"]> = [
  "user",
  "assistant",
  "reasoning",
  "tool",
  "status",
  "routing",
  "error",
  "gateway_error",
  "approval",
  "question",
  "user_action",
];

describe("mock host", () => {
  it("replays settings then hydrate then the panels on ready", () => {
    const { sent, host } = collect();
    host.handle({ type: "ready" });

    expect(sent.map((m) => m.type).slice(0, 2)).toEqual(["settings", "hydrate"]);
    const tail = sent.map((m) => m.type).slice(2);
    expect(tail.slice(-kitchenSink.extras.length)).toEqual(kitchenSink.extras.map((m) => m.type));
  });

  it("clears the panels hydrate does not own, so scenarios cannot leak into each other", () => {
    const { sent, host } = collect();
    host.setScenario(empty);

    const reset = sent.filter((m) => m.type === "changes" || m.type === "plans");
    expect(reset).toEqual([
      { type: "changes", changes: [] },
      { type: "plans", items: [] },
    ]);
  });

  it("resolves the cards whose reply the UI waits for", () => {
    const { sent, host } = collect();
    host.handle({ type: "approve", requestId: "a-pending" });
    host.handle({ type: "user_action_done", requestId: "ua-pending", comment: "done" });

    expect(sent).toEqual([
      { type: "approval_resolved", requestId: "a-pending", approved: true },
      { type: "user_action_resolved", requestId: "ua-pending", comment: "done" },
    ]);
  });

  it("answers get_hunks with the scenario hunks for that path only", () => {
    const { sent, host } = collect();
    host.handle({ type: "get_hunks", path: "src/settings/theme.ts" });
    host.handle({ type: "get_hunks", path: "unknown.ts" });

    expect(sent[0]).toMatchObject({ type: "hunks", path: "src/settings/theme.ts" });
    expect(sent[0]).not.toMatchObject({ hunks: [] });
    expect(sent[1]).toEqual({ type: "hunks", path: "unknown.ts", hunks: [] });
  });

  it("ignores requests it has no answer for", () => {
    const { sent, host } = collect();
    host.handle({ type: "dismiss_drag_tip" });
    expect(sent).toEqual([]);
  });
});

describe("scenarios", () => {
  it("covers every log item kind in the kitchen sink", () => {
    const kinds = new Set(kitchenSink.hydrate.log.map((item) => item.kind));
    expect([...LOG_KINDS].filter((kind) => !kinds.has(kind))).toEqual([]);
  });

  it("exposes distinct ids so the toolbar can select them", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });
});
