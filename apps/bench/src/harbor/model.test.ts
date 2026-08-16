import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHarborModel } from "./model.js";
import { agentImportPath, DEFAULT_DATASET } from "./paths.js";

describe("Harbor model parsing", () => {
  it("splits provider/model the way Harbor -m is written", () => {
    expect(parseHarborModel("deepseek/deepseek-chat")).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(parseHarborModel("anthropic/claude-sonnet-4")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4",
    });
    expect(parseHarborModel("openrouter/anthropic/claude-sonnet-4")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
    });
    expect(parseHarborModel("xai/grok-4.6")).toEqual({
      provider: "xai",
      model: "grok-4.6",
    });
  });

  it("keeps a bare model id as --model only", () => {
    expect(parseHarborModel("deepseek-chat")).toEqual({ model: "deepseek-chat" });
    expect(parseHarborModel(undefined)).toEqual({});
    expect(parseHarborModel("")).toEqual({});
  });

  it("ships the Harbor agent module next to the bench package", () => {
    expect(existsSync(agentImportPath())).toBe(true);
    const source = readFileSync(agentImportPath(), "utf8");
    expect(source).toContain("class NinjaCodeAgent");
    expect(source).toContain("def parse_harbor_model");
    expect(source).toContain('return "ninjacode"');
    expect(DEFAULT_DATASET).toBe("terminal-bench/terminal-bench-2-1");
  });
});
