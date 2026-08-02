import { describe, expect, it, vi } from "vitest";
import { basename, formatContext, formatTokens, groupSessionsByRecency, readFileAsDataUrl, readFileAsText, relativeTime } from "./format.js";

describe("formatContext", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatContext(900)).toBe("900");
    expect(formatContext(128_000)).toBe("128k");
    expect(formatContext(1_000_000)).toBe("1M");
    expect(formatContext(1_500_000)).toBe("1.5M");
  });
});

describe("formatTokens", () => {
  it("keeps one decimal only when it carries information", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});

describe("relativeTime", () => {
  it("describes recent timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(relativeTime("2026-01-10T11:59:30Z")).toBe("just now");
    expect(relativeTime("2026-01-10T11:30:00Z")).toBe("30m ago");
    expect(relativeTime("2026-01-10T09:00:00Z")).toBe("3h ago");
    expect(relativeTime("2026-01-08T12:00:00Z")).toBe("2d ago");
    vi.useRealTimers();
  });

  it("returns nothing for an unparsable date", () => {
    expect(relativeTime("not a date")).toBe("");
  });
});

describe("groupSessionsByRecency", () => {
  it("buckets sessions into Today, Previous 7 days, and Older", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T15:00:00Z"));

    const sessions = [
      { id: "a", updatedAt: "2026-01-10T14:00:00Z" },
      { id: "b", updatedAt: "2026-01-08T12:00:00Z" },
      { id: "c", updatedAt: "2025-12-01T12:00:00Z" },
      { id: "d", updatedAt: "not-a-date" },
    ];

    const groups = groupSessionsByRecency(sessions);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Previous 7 days", "Older"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(groups[2]?.sessions.map((s) => s.id)).toEqual(["c", "d"]);

    vi.useRealTimers();
  });

  it("omits empty buckets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T15:00:00Z"));

    const groups = groupSessionsByRecency([{ id: "a", updatedAt: "2026-01-10T10:00:00Z" }]);
    expect(groups).toEqual([{ label: "Today", sessions: [{ id: "a", updatedAt: "2026-01-10T10:00:00Z" }] }]);

    vi.useRealTimers();
  });
});

describe("basename", () => {
  it("handles both separators and trailing slashes", () => {
    expect(basename("src/chat/App.tsx")).toBe("App.tsx");
    expect(basename("src\\chat\\App.tsx")).toBe("App.tsx");
    expect(basename("src/chat/")).toBe("chat");
    expect(basename("App.tsx")).toBe("App.tsx");
  });
});

describe("file readers", () => {
  it("reads text", async () => {
    expect(await readFileAsText(new File(["hello"], "a.txt"))).toBe("hello");
  });

  it("encodes a data URL with the file's mime type", async () => {
    const file = new File([new Uint8Array([104, 105])], "a.png", { type: "image/png" });
    expect(await readFileAsDataUrl(file)).toBe("data:image/png;base64,aGk=");
  });
});
