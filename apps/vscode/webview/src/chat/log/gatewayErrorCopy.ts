import type { GatewayErrorInfo } from "../../../../src/protocol.js";

type GatewayErrorSeverity = "block" | "warn";

export type GatewayErrorAction =
  | { id: "upgrade"; label: string; primary?: boolean; tier?: string }
  | { id: "account"; label: string; primary?: boolean }
  | { id: "change_model"; label: string; primary?: boolean }
  | { id: "sign_in"; label: string; primary?: boolean }
  | { id: "support"; label: string; primary?: boolean };

interface GatewayErrorCardSpec {
  severity: GatewayErrorSeverity;
  badge: string;
  title: string;
  titleArgs?: string[];
  body: string;
  bodyArgs?: string[];
  /** ISO date from the gateway; UI formats via i18n `Credits renew {0}`. */
  renewsAt?: string;
  actions: GatewayErrorAction[];
}

export function formatRenewsAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const UPGRADE: GatewayErrorAction = { id: "upgrade", label: "Upgrade plan", primary: true, tier: "pro" };
const CHANGE_MODEL: GatewayErrorAction = {
  id: "change_model",
  label: "Choose another model",
  primary: true,
};

function creditsSpec(info: GatewayErrorInfo): GatewayErrorCardSpec {
  return {
    severity: "block",
    badge: "Credits",
    title: info.partial ? "Answer stopped — out of credits" : "You're out of credits",
    body: info.partial
      ? "Your balance ran out mid-answer, so the response above is incomplete."
      : "Your NinjaCode balance is empty for this cycle.",
    renewsAt: info.renewsAt,
    actions: [UPGRADE, { id: "account", label: "View account" }],
  };
}

function modelPricedSpec(info: GatewayErrorInfo): GatewayErrorCardSpec {
  return info.model
    ? {
        severity: "warn",
        badge: "Model",
        title: "{0} is unavailable right now",
        titleArgs: [info.model],
        body: "This model has no active price on the gateway, so it can't be billed.",
        actions: [CHANGE_MODEL],
      }
    : {
        severity: "warn",
        badge: "Model",
        title: "This model is unavailable right now",
        body: "This model has no active price on the gateway, so it can't be billed.",
        actions: [CHANGE_MODEL],
      };
}

function modelCatalogSpec(info: GatewayErrorInfo): GatewayErrorCardSpec {
  return {
    severity: "warn",
    badge: "Catalog",
    title: info.model ? "{0} isn't in your plan" : "This model isn't in your plan",
    titleArgs: info.model ? [info.model] : undefined,
    body: info.catalog
      ? "Your {0} catalog doesn't include this model."
      : "Your plan catalog doesn't include this model.",
    bodyArgs: info.catalog ? [info.catalog] : undefined,
    actions: [UPGRADE, { id: "change_model", label: "Choose another model" }],
  };
}

/** Pure copy/CTA table for gateway error cards — testable without React. */
export function gatewayErrorCardSpec(info: GatewayErrorInfo): GatewayErrorCardSpec {
  switch (info.code) {
    case "insufficient_credits":
      return creditsSpec(info);
    case "rate_limited":
      return {
        severity: "warn",
        badge: "Rate limit",
        title: "Too many requests",
        body: "The gateway is throttling this key. NinjaCode already retried automatically.",
        actions: [],
      };
    case "model_not_priced":
      return modelPricedSpec(info);
    case "model_not_in_catalog":
      return modelCatalogSpec(info);
    case "account_suspended":
      return {
        severity: "block",
        badge: "Account",
        title: "Your account is suspended",
        body: "Contact support to restore access.",
        actions: [{ id: "support", label: "Contact support", primary: true }],
      };
    case "unauthorized":
      return {
        severity: "block",
        badge: "Sign in",
        title: "Your session expired",
        body: "Sign in again to keep using NinjaCode.",
        actions: [{ id: "sign_in", label: "Sign in", primary: true }],
      };
    case "upstream_timeout":
      return {
        severity: "warn",
        badge: "Timeout",
        title: "The model stopped responding",
        body: "The provider went silent mid-answer. NinjaCode retried automatically.",
        actions: [],
      };
  }
}
