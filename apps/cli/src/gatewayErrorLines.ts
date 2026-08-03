import type { GatewayErrorInfo } from "@ninjacode/providers";
import { isTerminalGatewayCode } from "@ninjacode/providers";
import { t } from "./i18n.js";

const PRICING_URL = "https://ninjacode.dev/pricing";

/** Pure stderr lines for a typed gateway error. */
export function gatewayErrorLines(info: GatewayErrorInfo): string[] {
  switch (info.code) {
    case "insufficient_credits": {
      const lines = [
        info.partial
          ? t("cli.gateway.creditsPartial")
          : t("cli.gateway.credits"),
      ];
      if (info.renewsAt) {
        lines.push(t("cli.gateway.creditsRenew", { date: info.renewsAt.slice(0, 10), url: PRICING_URL }));
      } else {
        lines.push(`  ${PRICING_URL}`);
      }
      return lines;
    }
    case "rate_limited":
      return [t("cli.gateway.rateLimited")];
    case "model_not_priced":
      return [t("cli.gateway.modelNotPriced", { model: info.model ?? "model" })];
    case "model_not_in_catalog":
      return [
        t("cli.gateway.modelNotInCatalog", {
          model: info.model ?? "model",
          catalog: info.catalog ?? "plan",
        }),
      ];
    case "account_suspended":
      return [t("cli.gateway.accountSuspended")];
    case "unauthorized":
      return [t("cli.gateway.unauthorized")];
    case "upstream_timeout":
      return [t("cli.gateway.upstreamTimeout")];
  }
}

export function gatewayExitCode(info: GatewayErrorInfo | undefined): number | undefined {
  if (!info) return undefined;
  return isTerminalGatewayCode(info.code) ? 3 : 2;
}
