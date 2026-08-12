import type { GatewayPlanPayload, PlanKind } from "../../../types.js";

export const OVERAGE_PRESETS = [0, 5, 20, 50, 100] as const;

export function creditPercent(credits: number, included: number): number {
  if (included <= 0) return 0;
  return Math.max(0, Math.min(100, (credits / included) * 100));
}

export function overageCreditsFor(limitEur: number, creditValueEur: number): number {
  if (creditValueEur <= 0) return 0;
  return Math.round(limitEur / creditValueEur);
}

export function overageConsumedPct(consumed: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, (consumed / limit) * 100));
}

export function displayPrice(plan: GatewayPlanPayload, kind: PlanKind): number {
  return kind === "commitment" ? plan.commitmentPriceEur : plan.priceEur;
}

export function commitmentTotal(plan: GatewayPlanPayload): number {
  return Math.round(plan.commitmentPriceEur * 12 * 100) / 100;
}

export function formatEur(n: number): string {
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${rounded} €`;
}

export function formatCredits(n: number): string {
  return Math.round(n).toLocaleString();
}

export function hasActivePass(passTier: string | null | undefined): boolean {
  return Boolean(passTier) && passTier !== "none";
}
