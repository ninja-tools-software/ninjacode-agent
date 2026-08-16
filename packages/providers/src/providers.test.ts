import { describe, expect, it } from "vitest";
import {
  EchoProvider,
  MockProvider,
  createProvider,
  findModelAnywhere,
  getModelInfo,
  getProviderCatalog,
} from "./index.js";

describe("providers", () => {
  it("echo returns last user message", async () => {
    const p = new EchoProvider();
    const c = await p.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(c.text).toContain("hi");
  });
  it("factory creates mock", () => {
    expect(createProvider({ kind: "mock" }).name).toBe("mock");
  });
  it("mock can emit tool calls", async () => {
    const p = new MockProvider([{ toolCalls: [{ id: "1", name: "list_dir", arguments: { path: "." } }] }]);
    const c = await p.complete({ messages: [{ role: "user", content: "x" }] });
    expect(c.toolCalls).toHaveLength(1);
  });
});

describe("DeepSeek catalog", () => {
  it("exposes current V4 models with correct context/output limits", () => {
    const catalog = getProviderCatalog("deepseek");
    expect(catalog).toBeDefined();
    const ids = catalog!.models.map((m) => m.id);
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("deepseek-v4-pro");

    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const model = getModelInfo("deepseek", id);
      expect(model?.contextWindow).toBe(1_000_000);
      expect(model?.maxOutput).toBe(384_000);
      expect(model?.reasoning?.kind).toBe("levels");
    }
  });

  it("keeps deprecated deepseek-chat / deepseek-reasoner as backward-compat aliases", () => {
    const chat = getModelInfo("deepseek", "deepseek-chat");
    const reasoner = getModelInfo("deepseek", "deepseek-reasoner");
    expect(chat).toBeDefined();
    expect(reasoner).toBeDefined();
    // Legacy IDs now proxy to V4 under the hood, so limits should match V4.
    expect(chat?.contextWindow).toBe(1_000_000);
    expect(reasoner?.contextWindow).toBe(1_000_000);
  });

  it("lists deepseek-v4-flash first so it's the default in the UI model picker", () => {
    const catalog = getProviderCatalog("deepseek");
    expect(catalog?.models[0]?.id).toBe("deepseek-v4-flash");
  });

  it("returns undefined for an unknown model id instead of the catalog default", () => {
    expect(getModelInfo("deepseek", "does-not-exist")).toBeUndefined();
    expect(getModelInfo("deepseek", "")?.id).toBe("deepseek-v4-flash");
  });

  it("factory still builds a deepseek provider instance", () => {
    const provider = createProvider({ kind: "deepseek", apiKey: "test" });
    expect(provider.name).toBe("deepseek");
  });

  it("factory builds moonshot, glm, mistral, xai, and mammouth providers", () => {
    expect(createProvider({ kind: "moonshot", apiKey: "test" }).name).toBe("moonshot");
    expect(createProvider({ kind: "glm", apiKey: "test" }).name).toBe("glm");
    expect(createProvider({ kind: "mistral", apiKey: "test" }).name).toBe("mistral");
    expect(createProvider({ kind: "xai", apiKey: "test" }).name).toBe("xai");
    expect(createProvider({ kind: "mammouth", apiKey: "test" }).name).toBe("mammouth");
  });

  it("is discoverable from any catalog via findModelAnywhere", () => {
    expect(findModelAnywhere("deepseek-v4-pro")?.contextWindow).toBe(1_000_000);
  });
});

describe("local provider", () => {
  it("factory builds a local provider named 'local'", () => {
    const provider = createProvider({ kind: "local" });
    expect(provider.name).toBe("local");
  });

  it("exposes a Local LLM catalog with a default model", () => {
    const catalog = getProviderCatalog("local");
    expect(catalog?.label).toBe("Local LLM");
    expect(catalog?.models[0]?.id).toBe("default");
  });
});

describe("xai provider", () => {
  it("factory builds an xai provider named 'xai'", () => {
    const provider = createProvider({ kind: "xai", apiKey: "test" });
    expect(provider.name).toBe("xai");
  });

  it("exposes Grok 4.6 as the default catalog model", () => {
    const catalog = getProviderCatalog("xai");
    expect(catalog?.label).toBe("xAI");
    expect(catalog?.models[0]?.id).toBe("grok-4.6");
  });
});

describe("mammouth provider", () => {
  it("factory builds a mammouth provider named 'mammouth'", () => {
    const provider = createProvider({ kind: "mammouth", apiKey: "test" });
    expect(provider.name).toBe("mammouth");
  });

  it("exposes a Mammouth AI catalog with a placeholder model", () => {
    const catalog = getProviderCatalog("mammouth");
    expect(catalog?.label).toBe("Mammouth AI");
    expect(catalog?.models[0]?.id).toBe("mammouth-recommended");
  });
});
