import { describe, expect, it } from "vitest";
import { queueMermaidRender, resetMermaidRenderQueue } from "./mermaidRenderQueue.js";

describe("queueMermaidRender", () => {
  it("runs tasks one after another", async () => {
    resetMermaidRenderQueue();
    const order: number[] = [];

    const first = queueMermaidRender(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const second = queueMermaidRender(async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
