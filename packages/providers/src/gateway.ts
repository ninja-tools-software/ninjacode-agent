import type { CompletionRequest, LlmProvider, StreamSink } from "./types.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

export interface GatewayConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/**
 * NinjaCode commercial gateway — OpenAI-compatible proxy at list price (zero markup).
 * Auth via NinjaCode account API key / credits.
 */
export class NinjaCodeGatewayProvider extends OpenAICompatibleProvider implements LlmProvider {
  constructor(config: GatewayConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? "https://gateway.ninja-code.ai/v1",
      model: config.model ?? "auto",
      name: "ninjacode-gateway",
      headers: {
        "X-NinjaCode-Client": "ninjacode/0.1.0",
      },
    });
  }

  override async completeStreaming(req: CompletionRequest, sink?: StreamSink) {
    return super.completeStreaming(req, sink);
  }
}
