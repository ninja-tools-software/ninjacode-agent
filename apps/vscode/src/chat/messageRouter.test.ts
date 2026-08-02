import { describe, expect, it, vi } from "vitest";
import type { ChatToHost, SettingsToHost, WebviewToHost } from "../protocol.js";
import { createMessageRouter, type ChatMessageHandlers } from "./messageRouter.js";

/** Every chat message routes to a no-op, except the ones a test overrides. */
function handlers(overrides: Partial<ChatMessageHandlers> = {}): ChatMessageHandlers {
  return new Proxy({ ...overrides } as Record<string, unknown>, {
    get: (target, prop: string) => target[prop] ?? (() => {}),
    has: () => true,
  }) as ChatMessageHandlers;
}

describe("createMessageRouter", () => {
  it("dispatches a chat message to its handler with the narrowed payload", async () => {
    const stop = vi.fn();
    const userMessage = vi.fn();
    const route = createMessageRouter(
      handlers({ stop, user_message: userMessage }),
      async () => true,
    );

    await route({ type: "stop" });
    await route({ type: "user_message", text: "hi", nodes: [], refs: [] });

    expect(stop).toHaveBeenCalledOnce();
    expect(userMessage).toHaveBeenCalledWith({ type: "user_message", text: "hi", nodes: [], refs: [] });
  });

  it("awaits an async handler before returning", async () => {
    const order: string[] = [];
    const route = createMessageRouter(
      handlers({
        stop: async () => {
          await Promise.resolve();
          order.push("handler");
        },
      }),
      async () => true,
    );

    await route({ type: "stop" });
    order.push("after");
    expect(order).toEqual(["handler", "after"]);
  });

  it("falls back to the settings handler for anything it does not own", async () => {
    const settings = vi.fn(async () => true);
    const table = { stop: () => {} } as unknown as ChatMessageHandlers;
    const route = createMessageRouter(table, settings);

    const msg = { type: "set_model", model: "claude" } as unknown as SettingsToHost;
    await route(msg as WebviewToHost);
    expect(settings).toHaveBeenCalledWith(msg);
  });

  it("never sends a message to both paths", async () => {
    const settings = vi.fn(async () => true);
    const stop = vi.fn();
    const route = createMessageRouter({ stop } as unknown as ChatMessageHandlers, settings);

    await route({ type: "stop" } as ChatToHost);
    expect(stop).toHaveBeenCalledOnce();
    expect(settings).not.toHaveBeenCalled();
  });

  it("propagates a handler failure instead of swallowing it", async () => {
    const route = createMessageRouter(
      handlers({
        stop: () => {
          throw new Error("boom");
        },
      }),
      async () => true,
    );
    await expect(route({ type: "stop" })).rejects.toThrow("boom");
  });
});
