import { describe, expect, it } from "vitest";
import {
  buildGatewayPriceTables,
  listGatewayModelInfos,
  listGatewayModels,
  listRoutableGatewayModels,
} from "./gatewayModels.js";
import { resolveGatewayRoutes } from "./gatewayRegistry.js";

function primary(modelId: string, env: Record<string, string> = {}) {
  return resolveGatewayRoutes(modelId, env)[0];
}

function failover(modelId: string, env: Record<string, string> = {}) {
  return resolveGatewayRoutes(modelId, env)[1];
}

describe("gatewayRegistry", () => {
  it("lists Pass models including virtual Auto", () => {
    const ids = listGatewayModels().map((m) => m.id);
    expect(ids).toContain("auto");
    expect(ids).not.toContain("auto-frontier");
    expect(ids).not.toContain("auto-balanced");
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4-pro");
    expect(listGatewayModels().find((m) => m.id === "auto")?.virtual).toBe(true);
    expect(listRoutableGatewayModels().map((m) => m.id)).not.toContain("auto");
  });

  it("omits per-model rate tables but exposes costIndex", () => {
    const infos = listGatewayModelInfos();
    const sonnet = infos.find((m) => m.id === "claude-sonnet-4-20250514");
    expect(sonnet?.price).toBeUndefined();
    expect(sonnet?.costIndex).toBe(14.4);
    expect(sonnet?.label).toBe("Claude Sonnet 4");

    const gpt4o = infos.find((m) => m.id === "gpt-4o");
    expect(gpt4o?.price).toBeUndefined();
    expect(gpt4o?.costIndex).toBe(10);

    const auto = infos.find((m) => m.id === "auto");
    expect(auto?.price).toBeUndefined();
    expect(auto?.costIndex).toBeNull();
    expect(auto?.tags).toContain("auto");

    expect(infos[0]?.id).toBe("auto");
    const priced = infos.filter((m) => m.costIndex != null).map((m) => m.costIndex as number);
    expect(priced).toEqual([...priced].sort((a, b) => b - a));
  });

  it("routes deepseek-v4-pro natively when DEEPSEEK_API_KEY is set", () => {
    const route = primary("deepseek-v4-pro", {
      DEEPSEEK_API_KEY: "ds-key",
      OPENROUTER_API_KEY: "or-key",
    });
    expect(route?.provider).toBe("deepseek");
    expect(route?.upstreamModel).toBe("deepseek-v4-pro");
    expect(route?.apiKey).toBe("ds-key");
    expect(failover("deepseek-v4-pro", {
      DEEPSEEK_API_KEY: "ds-key",
      OPENROUTER_API_KEY: "or-key",
    })?.provider).toBe("openrouter");
  });

  it("returns empty chain for unknown and virtual models", () => {
    expect(resolveGatewayRoutes("deepseek-chat", { DEEPSEEK_API_KEY: "ds-key" })).toEqual([]);
    expect(resolveGatewayRoutes("auto", { DEEPSEEK_API_KEY: "ds-key" })).toEqual([]);
  });

  it("prefers Anthropic native for Claude when key is set", () => {
    const route = primary("claude-sonnet-4-20250514", {
      ANTHROPIC_API_KEY: "ant-key",
      OPENROUTER_API_KEY: "or-key",
    });
    expect(route?.provider).toBe("anthropic");
    expect(route?.upstreamKind).toBe("anthropic-messages");
    expect(route?.apiKey).toBe("ant-key");
    expect(failover("claude-sonnet-4-20250514", {
      ANTHROPIC_API_KEY: "ant-key",
      OPENROUTER_API_KEY: "or-key",
    })?.provider).toBe("openrouter");
  });

  it("falls back to OpenRouter for Claude without Anthropic key", () => {
    const route = primary("claude-sonnet-4-20250514", {
      OPENROUTER_API_KEY: "or-key",
    });
    expect(route?.provider).toBe("openrouter");
    expect(route?.upstreamModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("failover route carries its own upstream model name", () => {
    const fb = failover("claude-sonnet-4-20250514", {
      ANTHROPIC_API_KEY: "ant-key",
      OPENROUTER_API_KEY: "or-key",
    });
    expect(fb?.upstreamModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("builds price tables from registry without virtual Auto", () => {
    const { list } = buildGatewayPriceTables();
    expect(list["gpt-4o"]?.input).toBe(2.5);
    expect(list.auto).toBeUndefined();
    expect(list["glm-4.5"]?.input).toBe(0.5);
    expect(list["mistral-large-latest"]?.output).toBe(6);
  });

  it("exposes cache prices for Anthropic models (read + write)", () => {
    const { list, cost } = buildGatewayPriceTables();
    expect(list["claude-sonnet-4-20250514"]?.cacheRead).toBe(0.3);
    expect(list["claude-sonnet-4-20250514"]?.cacheWrite).toBe(3.75);
    expect(cost["claude-sonnet-4-20250514"]?.cacheRead).toBe(0.24);
    expect(cost["claude-sonnet-4-20250514"]?.cacheWrite).toBe(3.0);
  });

  it("exposes cache-read price for DeepSeek models without cache-write", () => {
    const { list } = buildGatewayPriceTables();
    expect(list["deepseek-v4-flash"]?.cacheRead).toBe(0.014);
    expect(list["deepseek-v4-flash"]?.cacheWrite).toBeUndefined();
    expect(list["deepseek-v4-pro"]?.cacheRead).toBe(0.055);
  });

  it("routes Moonshot natively when key is set", () => {
    const route = primary("kimi-k2-0711-preview", {
      MOONSHOT_API_KEY: "ms-key",
      OPENROUTER_API_KEY: "or-key",
    });
    expect(route?.provider).toBe("moonshot");
    expect(route?.upstreamModel).toBe("kimi-k2-0711-preview");
    expect(failover("kimi-k2-0711-preview", {
      MOONSHOT_API_KEY: "ms-key",
      OPENROUTER_API_KEY: "or-key",
    })?.provider).toBe("openrouter");
  });

  it("routes GLM via OpenRouter without native key", () => {
    const route = primary("glm-4.5", { OPENROUTER_API_KEY: "or-key" });
    expect(route?.provider).toBe("openrouter");
    expect(route?.upstreamModel).toBe("zhipu/glm-4.5");
  });

  it("routes Mistral natively when key is set", () => {
    const route = primary("mistral-large-latest", {
      MISTRAL_API_KEY: "mi-key",
    });
    expect(route?.provider).toBe("mistral");
    expect(route?.upstreamModel).toBe("mistral-large-latest");
  });
});
