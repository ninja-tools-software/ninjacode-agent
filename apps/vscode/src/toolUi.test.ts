import { describe, expect, it } from "vitest";
import {
  formatEditRange,
  formatReadRange,
  formatReadRangeFromMeta,
  formatToolLineRange,
} from "./toolUi.js";

describe("formatReadRange", () => {
  it("uses offset and limit", () => {
    expect(formatReadRange({ offset: 10, limit: 41 })).toBe("L10-50");
  });

  it("defaults offset to 1 when only limit is given", () => {
    expect(formatReadRange({ limit: 20 })).toBe("L1-20");
  });

  it("collapses to a single line when limit is 1", () => {
    expect(formatReadRange({ offset: 5, limit: 1 })).toBe("L5");
  });

  it("returns undefined for full-file reads (no limit)", () => {
    expect(formatReadRange({ offset: 5 })).toBeUndefined();
    expect(formatReadRange({})).toBeUndefined();
    expect(formatReadRange(undefined)).toBeUndefined();
  });

  it("ignores non-positive or non-finite limits", () => {
    expect(formatReadRange({ limit: 0 })).toBeUndefined();
    expect(formatReadRange({ limit: Number.NaN })).toBeUndefined();
  });
});

describe("formatReadRangeFromMeta", () => {
  it("formats the served range from startLine/endLine", () => {
    expect(formatReadRangeFromMeta({ startLine: 1, endLine: 585, totalLines: 1042 })).toBe(
      "L1-585",
    );
  });

  it("collapses a single served line", () => {
    expect(formatReadRangeFromMeta({ startLine: 42, endLine: 42 })).toBe("L42");
  });

  it("rejects empty or incomplete meta", () => {
    expect(formatReadRangeFromMeta({ startLine: 1, endLine: 0 })).toBeUndefined();
    expect(formatReadRangeFromMeta({ startLine: 1 })).toBeUndefined();
    expect(formatReadRangeFromMeta(undefined)).toBeUndefined();
  });
});

describe("formatEditRange", () => {
  it("reports the changed region on the after side", () => {
    const before = "a\nb\nc\nd\ne";
    const after = "a\nb\nX\nY\nd\ne";
    expect(formatEditRange(before, after)).toBe("L3-4");
  });

  it("reports the whole file for a new file", () => {
    expect(formatEditRange("", "line1\nline2\nline3")).toBe("L1-3");
  });

  it("returns undefined when content is unchanged", () => {
    expect(formatEditRange("same", "same")).toBeUndefined();
  });

  it("returns undefined when after is missing", () => {
    expect(formatEditRange("x", undefined)).toBeUndefined();
  });

  it("handles a single changed line", () => {
    expect(formatEditRange("a\nb\nc", "a\nB\nc")).toBe("L2");
  });
});

describe("formatToolLineRange", () => {
  it("dispatches read_file to args when meta is absent", () => {
    expect(formatToolLineRange("read_file", { offset: 3, limit: 8 })).toBe("L3-10");
  });

  it("prefers read_file meta over args (served range after budget truncation)", () => {
    expect(
      formatToolLineRange(
        "read_file",
        { path: "fluid-sim.js" },
        { startLine: 1, endLine: 585, totalLines: 1042, lines: 585 },
      ),
    ).toBe("L1-585");
  });

  it("shows a badge for full-file reads once meta reports the served range", () => {
    expect(
      formatToolLineRange("read_file", { path: "small.ts" }, { startLine: 1, endLine: 12, totalLines: 12 }),
    ).toBe("L1-12");
  });

  it("dispatches write_file to meta before/after", () => {
    expect(
      formatToolLineRange("write_file", undefined, { before: "a\nb", after: "a\nB\nc" }),
    ).toBe("L2-3");
  });

  it("dispatches edit_file to meta before/after", () => {
    expect(
      formatToolLineRange("edit_file", undefined, { before: "x\ny\nz", after: "x\nY\nz" }),
    ).toBe("L2");
  });

  it("handles apply_patch with a single changed file", () => {
    const meta = {
      fileChanges: {
        "a.ts": { before: "1\n2\n3", after: "1\n2\n3\n4" },
      },
    };
    expect(formatToolLineRange("apply_patch", undefined, meta)).toBe("L4");
  });

  it("returns undefined for apply_patch touching multiple files", () => {
    const meta = {
      fileChanges: {
        "a.ts": { before: "1", after: "2" },
        "b.ts": { before: "3", after: "4" },
      },
    };
    expect(formatToolLineRange("apply_patch", undefined, meta)).toBeUndefined();
  });

  it("returns undefined for unrelated tools", () => {
    expect(formatToolLineRange("search", { query: "foo" })).toBeUndefined();
  });
});
