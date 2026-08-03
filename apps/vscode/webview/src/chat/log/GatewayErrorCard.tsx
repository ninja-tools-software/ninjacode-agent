import { t } from "../../i18n.js";
import type { GatewayErrorInfo, VsCodeApi } from "../types.js";
import {
  formatRenewsAt,
  gatewayErrorCardSpec,
  type GatewayErrorAction,
} from "./gatewayErrorCopy.js";

function runAction(action: GatewayErrorAction, vscode: VsCodeApi): void {
  switch (action.id) {
    case "upgrade":
      vscode.postMessage({ type: "gateway_upgrade", tier: action.tier ?? "pro" });
      return;
    case "account":
      vscode.postMessage({ type: "gateway_open_account" });
      return;
    case "change_model":
      vscode.postMessage({ type: "gateway_change_model" });
      return;
    case "sign_in":
      vscode.postMessage({ type: "gateway_sign_in" });
      return;
    case "support":
      vscode.postMessage({
        type: "open_ref",
        ref: {
          id: "url:https://ninjacode.dev",
          kind: "url",
          target: "https://ninjacode.dev",
          label: "NinjaCode",
          status: "resolved",
        },
      });
  }
}

export function GatewayErrorCard({
  item,
  vscode,
}: {
  item: GatewayErrorInfo & { kind: "gateway_error" };
  vscode: VsCodeApi;
}) {
  const spec = gatewayErrorCardSpec(item);
  const title = spec.titleArgs?.length
    ? t(spec.title, ...spec.titleArgs)
    : t(spec.title);
  const body = spec.bodyArgs?.length ? t(spec.body, ...spec.bodyArgs) : t(spec.body);
  return (
    <div className={`gw-error sev-${spec.severity} panel-enter msg-enter`} role="status">
      <div className="gw-error-head">
        <span className="gw-error-badge">{t(spec.badge)}</span>
        <strong>{title}</strong>
      </div>
      <p className="gw-error-body">{body}</p>
      {spec.renewsAt && (
        <span className="gw-error-meta">{t("Credits renew {0}", formatRenewsAt(spec.renewsAt))}</span>
      )}
      {spec.actions.length > 0 && (
        <div className="gw-error-actions">
          {spec.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.primary ? "btn primary" : "btn"}
              onClick={() => runAction(action, vscode)}
            >
              {t(action.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
