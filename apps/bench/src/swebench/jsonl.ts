import type { SweBenchPrediction } from "./types.js";

export function serializePredictionLine(prediction: SweBenchPrediction): string {
  return `${JSON.stringify(prediction)}\n`;
}

export function parsePredictionLines(content: string): SweBenchPrediction[] {
  const out: SweBenchPrediction[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as SweBenchPrediction);
  }
  return out;
}
