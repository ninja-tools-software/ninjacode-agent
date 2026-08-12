import * as vscode from "vscode";
import { t } from "./locale.js";
import type { PlanKind } from "./protocol.js";
import type { SettingsMessage } from "./settingsTypes.js";
import type { BillingResult } from "./billingGateway.js";

export interface BillingHandlerContext {
  subscribe(tier: string, planKind?: PlanKind): Promise<void>;
  buyPack(packId: string): Promise<void>;
  setOverage(limitEur: number): Promise<void>;
  openPortal(): Promise<void>;
  resumeSubscription(): Promise<void>;
}

export const BILLING_HANDLERS: Record<
  string,
  (msg: SettingsMessage, ctx: BillingHandlerContext) => Promise<void>
> = {
  account_subscribe: async (msg, ctx) => {
    await ctx.subscribe(msg.tier ?? "starter", msg.planKind);
  },
  account_buy_pack: async (msg, ctx) => {
    if (msg.packId) await ctx.buyPack(msg.packId);
  },
  account_set_overage: async (msg, ctx) => {
    if (typeof msg.limitEur === "number") await ctx.setOverage(msg.limitEur);
  },
  account_billing_portal: async (_msg, ctx) => {
    await ctx.openPortal();
  },
  account_resume_subscription: async (_msg, ctx) => {
    await ctx.resumeSubscription();
  },
};

export function billingErrorMessage(error: string): string {
  if (error === "already_subscribed") return t("You already have an active NinjaCode Pass.");
  if (error === "stripe_not_configured") return t("Billing is not available right now.");
  if (error === "no_active_subscription") return t("No active subscription to update.");
  if (error === "stripe_subscription_required") {
    return t("An active NinjaCode Pass is required to set an overage limit.");
  }
  if (error === "no_stripe_customer") {
    return t("No billing customer on this account yet. Subscribe first.");
  }
  return t("Billing request failed: {0}", error);
}

export async function openBillingUrl(result: BillingResult<{ url: string }>): Promise<boolean> {
  if (!result.ok) {
    vscode.window.showErrorMessage(billingErrorMessage(result.error));
    return false;
  }
  const url = result.data.url;
  if (typeof url !== "string" || !url) {
    vscode.window.showErrorMessage(t("Billing request failed: {0}", "missing_url"));
    return false;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url));
  return true;
}
