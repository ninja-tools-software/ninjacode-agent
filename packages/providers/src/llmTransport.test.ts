import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { llmFetchInit } from "./llmTransport.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** Real loopback endpoint: a stubbed `fetch` cannot prove the dispatcher works. */
async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no loopback port");
  return `http://127.0.0.1:${address.port}`;
}

function sse(chunks: string[]): http.RequestListener {
  return (_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of chunks) response.write(chunk);
    response.end();
  };
}

describe("LLM streaming transport", () => {
  /**
   * Regression: an `undici` major newer than Node's bundled `fetch` is rejected
   * with "invalid onRequestStart method" and every LLM call fails instantly.
   * Only a real request catches that — asserting the dispatcher's type does not.
   */
  it("hands global fetch a dispatcher it accepts", async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("pong");
    });

    const response = await fetch(url, llmFetchInit({ method: "POST", body: "{}" }));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("pong");
  });

  it("streams a provider completion end to end through the dispatcher", async () => {
    const baseUrl = await serve(sse([
      'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]));
    const provider = new OpenAICompatibleProvider({ apiKey: "k", baseUrl, name: "loopback" });

    const completion = await provider.completeStreaming({
      messages: [{ role: "user", content: "ping" }],
    });

    expect(completion.text).toBe("hello");
    expect(completion.usage.inputTokens).toBe(10);
  });

  it("propagates an abort through the dispatcher instead of hanging", async () => {
    const url = await serve(() => {
      // Never responds: only the caller's signal can end this request.
    });
    const controller = new AbortController();
    const pending = fetch(url, llmFetchInit({ method: "POST", signal: controller.signal }));
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("reuses one dispatcher so connections are pooled across turns", () => {
    expect(llmFetchInit({}).dispatcher).toBe(llmFetchInit({}).dispatcher);
  });
});
