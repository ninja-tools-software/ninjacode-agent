import { describe, expect, it, vi } from "vitest";
import { DebouncedSessionPersistence } from "./sessionPersistence.js";

describe("DebouncedSessionPersistence", () => {
  it("coalesces writes and flushes the latest snapshot", async () => {
    vi.useFakeTimers();
    const writes: number[] = [];
    const persistence = new DebouncedSessionPersistence(75);
    persistence.schedule(async () => {
      writes.push(1);
    });
    persistence.schedule(async () => {
      writes.push(2);
    });

    expect(writes).toEqual([]);
    await persistence.flush();
    expect(writes).toEqual([2]);
    vi.useRealTimers();
  });

  it("serializes a write scheduled while another is in flight", async () => {
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: number[] = [];
    const persistence = new DebouncedSessionPersistence(0);
    persistence.schedule(async () => {
      await blocked;
      writes.push(1);
    });
    const flushing = persistence.flush();
    await Promise.resolve();
    persistence.schedule(async () => {
      writes.push(2);
    });
    release();
    await flushing;

    expect(writes).toEqual([1, 2]);
  });
});
