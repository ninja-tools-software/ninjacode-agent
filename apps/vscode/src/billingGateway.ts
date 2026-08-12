import type {
  AccountOveragePayload,
  CreditPackPayload,
  GatewayPlanPayload,
  PlanKind,
  PlansCatalogPayload,
} from "./protocol.js";

const PLANS_TTL_MS = 10 * 60 * 1000;

let plansCache: { at: number; base: string; catalog: PlansCatalogPayload } | null = null;

type CheckoutBody =
  | { tier: string; planKind?: PlanKind }
  | { kind: "pack"; packId: string };

export type BillingResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

function parseGatewayPlan(raw: unknown): GatewayPlanPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.tier !== "string" || typeof o.label !== "string") return null;
  if (typeof o.priceEur !== "number" || typeof o.commitmentPriceEur !== "number") return null;
  if (typeof o.monthlyCredits !== "number" || typeof o.bonusPct !== "number") return null;
  return {
    tier: o.tier,
    label: o.label,
    priceEur: o.priceEur,
    commitmentPriceEur: o.commitmentPriceEur,
    monthlyCredits: o.monthlyCredits,
    bonusPct: o.bonusPct,
    highlight: o.highlight === true,
  };
}

function parseCreditPack(raw: unknown): CreditPackPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string") return null;
  if (typeof o.credits !== "number" || typeof o.priceEur !== "number") return null;
  return { id: o.id, label: o.label, credits: o.credits, priceEur: o.priceEur };
}

export function parsePlansCatalog(raw: unknown): PlansCatalogPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.creditValueEur !== "number" || typeof o.packExpiryMonths !== "number") return null;
  if (!Array.isArray(o.plans) || !Array.isArray(o.packs)) return null;
  const plans = o.plans.map(parseGatewayPlan).filter((p): p is GatewayPlanPayload => p !== null);
  if (plans.length === 0) return null;
  return {
    creditValueEur: o.creditValueEur,
    packExpiryMonths: o.packExpiryMonths,
    plans,
    packs: o.packs.map(parseCreditPack).filter((p): p is CreditPackPayload => p !== null),
  };
}

export function parseOverage(raw: unknown): AccountOveragePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nums = [
    o.limitEur,
    o.limitCredits,
    o.consumedCredits,
    o.consumedEur,
    o.availableCredits,
    o.maxLimitEur,
  ];
  if (nums.some((n) => typeof n !== "number")) return null;
  return {
    limitEur: o.limitEur as number,
    limitCredits: o.limitCredits as number,
    consumedCredits: o.consumedCredits as number,
    consumedEur: o.consumedEur as number,
    availableCredits: o.availableCredits as number,
    maxLimitEur: o.maxLimitEur as number,
  };
}

export async function fetchPlans(gatewayBase: string): Promise<PlansCatalogPayload | null> {
  const now = Date.now();
  if (plansCache && plansCache.base === gatewayBase && now - plansCache.at < PLANS_TTL_MS) {
    return plansCache.catalog;
  }
  try {
    const res = await fetch(`${gatewayBase}/v1/plans`);
    if (!res.ok) return plansCache?.base === gatewayBase ? plansCache.catalog : null;
    const catalog = parsePlansCatalog(await res.json());
    if (!catalog) return null;
    plansCache = { at: now, base: gatewayBase, catalog };
    return catalog;
  } catch {
    return plansCache?.base === gatewayBase ? plansCache.catalog : null;
  }
}

export async function createCheckout(
  gatewayBase: string,
  apiKey: string,
  body: CheckoutBody,
): Promise<BillingResult<{ url: string }>> {
  return billingPost(gatewayBase, apiKey, "/v1/billing/checkout", body);
}

export async function changeSubscription(
  gatewayBase: string,
  apiKey: string,
  tier: string,
): Promise<BillingResult<{ url: string }>> {
  return billingPost(gatewayBase, apiKey, "/v1/billing/subscription/change", { tier });
}

export async function openBillingPortal(
  gatewayBase: string,
  apiKey: string,
): Promise<BillingResult<{ url: string }>> {
  return billingPost(gatewayBase, apiKey, "/v1/billing/portal", {});
}

export async function setOverageLimit(
  gatewayBase: string,
  apiKey: string,
  limitEur: number,
): Promise<BillingResult<AccountOveragePayload>> {
  return billingRequest(gatewayBase, apiKey, "/v1/billing/overage", {
    method: "PUT",
    body: JSON.stringify({ limitEur }),
  }).then((res) => {
    if (!res.ok) return res;
    const overage = parseOverage(res.data);
    if (!overage) return { ok: false, error: "invalid_response", status: 200 };
    return { ok: true, data: overage };
  });
}

export async function resumeSubscription(
  gatewayBase: string,
  apiKey: string,
): Promise<BillingResult<{ resumed: boolean }>> {
  return billingPost(gatewayBase, apiKey, "/v1/billing/subscription/resume", {});
}

async function billingPost<T>(
  gatewayBase: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<BillingResult<T>> {
  return billingRequest<T>(gatewayBase, apiKey, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function billingRequest<T>(
  gatewayBase: string,
  apiKey: string,
  path: string,
  init: RequestInit,
): Promise<BillingResult<T>> {
  try {
    const res = await fetch(`${gatewayBase}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? `http_${res.status}`, status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 0 };
  }
}
