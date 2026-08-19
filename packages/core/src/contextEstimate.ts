import type { Message, ToolSpec } from "@ninjacode/providers";

const DEFAULT_CALIBRATION = 1.1;
const MAX_CALIBRATION = 4;
const CALIBRATION_SAMPLES = 64;
const calibrationByModel = new Map<string, number[]>();

function modelKey(model?: string): string {
  return model?.trim().toLowerCase() || "default";
}

/** Record observed provider input usage so future estimates remain conservative. */
export function recordTokenCalibration(model: string | undefined, estimated: number, actual: number): void {
  if (estimated <= 0 || actual <= 0) return;
  const ratio = Math.min(MAX_CALIBRATION, Math.max(1, actual / estimated));
  const key = modelKey(model);
  const samples = calibrationByModel.get(key) ?? [];
  samples.push(ratio);
  if (samples.length > CALIBRATION_SAMPLES) samples.shift();
  calibrationByModel.set(key, samples);
}

/** A guarded p95 multiplier; it is never below the raw chars/4 estimate. */
export function tokenCalibrationMultiplier(model?: string): number {
  const samples = calibrationByModel.get(modelKey(model));
  if (!samples?.length) return DEFAULT_CALIBRATION;
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  return Math.min(MAX_CALIBRATION, Math.max(1, p95 * 1.05));
}

/** Conservative token estimate calibrated from actual usage for the resolved model. */
export function estimateTokens(messages: Message[], model?: string): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil((chars / 4) * tokenCalibrationMultiplier(model));
}

function estimateTextTokens(text: string, model?: string): number {
  return Math.ceil((text.length / 4) * tokenCalibrationMultiplier(model));
}

/** Breakdown of estimated tokens consumed by the next LLM call. */
export interface ContextUsageBreakdown {
  system: number;
  history: number;
  tools: number;
  /** Subset of `history` attributable to file-read tool results (informational). */
  files: number;
  /** Reserved output budget (not part of `total`, shown for headroom awareness). */
  output: number;
  /** system + history + tools — the actual input token estimate. */
  total: number;
  /** Context window budget being tracked against (0 if unknown). */
  window: number;
  /** Guard band reserved for tokenizer/provider variance. */
  safetyMargin: number;
  /** window - output - safetyMargin; 0 when the window is unknown. */
  inputBudget: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const MIN_INPUT_BUDGET = 32_768;
const MIN_INPUT_FRACTION = 0.25;

/** Guard band reserved for tokenizer/provider variance. */
export function contextSafetyMargin(window: number): number {
  return window > 0 ? Math.max(512, Math.floor(window * 0.05)) : 0;
}

/**
 * Cap per-turn `maxTokens` so reserved output cannot consume the effective
 * context window. Leaves at least `min(32768, 25% of window)` tokens for input.
 */
export function clampMaxTokens(maxTokens: number, contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return maxTokens;
  const safety = contextSafetyMargin(contextWindow);
  const minInput = Math.max(
    1,
    Math.min(MIN_INPUT_BUDGET, Math.floor(contextWindow * MIN_INPUT_FRACTION)),
  );
  return Math.max(1, Math.min(maxTokens, contextWindow - safety - minInput));
}

/**
 * Estimate the token breakdown for an upcoming completion request, without
 * double-counting: `system` and `history` must be disjoint (i.e. `history`
 * should not include the system message) — callers own that split.
 */
export function estimateContextUsage(opts: {
  system: string;
  history: Message[];
  tools?: ToolSpec[];
  window?: number;
  reservedOutput?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model?: string;
}): ContextUsageBreakdown {
  const system = estimateTextTokens(opts.system, opts.model);
  const history = estimateTokens(opts.history, opts.model);
  const files = estimateTokens(
    opts.history.filter(
      (m) => m.role === "tool" && (m.name === "read_file" || m.name === "list_dir"),
    ),
    opts.model,
  );
  const tools = opts.tools?.length ? estimateTextTokens(JSON.stringify(opts.tools), opts.model) : 0;
  const window = opts.window ?? 0;
  const output = opts.reservedOutput ?? 0;
  const safetyMargin = contextSafetyMargin(window);

  return {
    system,
    history,
    tools,
    files,
    output,
    total: system + history + tools,
    window,
    safetyMargin,
    inputBudget: window > 0 ? Math.max(1, window - output - safetyMargin) : 0,
    cacheRead: opts.cacheReadTokens,
    cacheWrite: opts.cacheWriteTokens,
  };
}
