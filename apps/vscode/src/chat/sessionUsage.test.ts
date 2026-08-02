import { describe, expect, it } from "vitest";
import { addTurnUsage, seedSessionUsage } from "./sessionUsage.js";

const GATEWAY = { provider: "gateway", model: "claude-sonnet-4-20250514" };

describe("addTurnUsage", () => {
  it("accumulates every token class across turns", () => {
    const first = addTurnUsage(null, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 500,
      cacheWriteTokens: 300,
    });
    const second = addTurnUsage(first, {
      inputTokens: 40,
      outputTokens: 10,
      cacheReadTokens: 600,
    });

    expect(second).toMatchObject({
      turns: 2,
      inputTokens: 140,
      outputTokens: 30,
      cacheReadTokens: 1100,
      cacheWriteTokens: 300,
    });
  });

  it("treats missing cache counts as zero rather than NaN", () => {
    const total = addTurnUsage(null, { inputTokens: 10, outputTokens: 5 });
    expect(total.cacheReadTokens).toBe(0);
    expect(total.cacheWriteTokens).toBe(0);
  });

  it("keeps the model from the previous total when the caller gives none", () => {
    const first = addTurnUsage(null, { inputTokens: 10, outputTokens: 1 }, GATEWAY);
    const second = addTurnUsage(first, { inputTokens: 10, outputTokens: 1 });
    expect(second.model).toBe(GATEWAY.model);
  });
});

describe("seedSessionUsage", () => {
  it("restores totals persisted with the session", () => {
    const seeded = seedSessionUsage(
      { inputTokens: 900, outputTokens: 120, cacheReadTokens: 40, cacheWriteTokens: 0 },
      4,
      GATEWAY,
    );
    expect(seeded).toMatchObject({
      turns: 4,
      inputTokens: 900,
      outputTokens: 120,
      model: GATEWAY.model,
    });
  });

  it("stays null for a session that never spent anything", () => {
    expect(seedSessionUsage(undefined, 0)).toBeNull();
    expect(
      seedSessionUsage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 0),
    ).toBeNull();
  });
});
