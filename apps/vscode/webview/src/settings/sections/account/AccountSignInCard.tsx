import { useEffect, useState } from "react";
import { t } from "../../../i18n.js";
import type { VsCodeApi } from "../../../types.js";

export function AccountSignInCard({
  vscode,
  gatewayUrl,
}: {
  vscode: VsCodeApi;
  gatewayUrl: string;
}) {
  const [loginEmail, setLoginEmail] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [urlDraft, setUrlDraft] = useState(gatewayUrl);
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => setUrlDraft(gatewayUrl), [gatewayUrl]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTimedOut(true), 90_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  const startWait = () => {
    setWaiting(true);
    setTimedOut(false);
  };

  return (
    <div className="card card--hero">
      <div className="card__label">{t("NinjaCode Pass")}</div>
      <p className="muted">
        {t("Recommended. Sign in with your browser — if you are already logged in on the website, the extension connects automatically.")}
      </p>
      <BrowserLoginButton vscode={vscode} waiting={waiting} onWait={startWait} />
      {waiting && <WaitingHint timedOut={timedOut} />}
      <AdvancedSignIn
        vscode={vscode}
        loginEmail={loginEmail}
        setLoginEmail={setLoginEmail}
        pasteKey={pasteKey}
        setPasteKey={setPasteKey}
        urlDraft={urlDraft}
        setUrlDraft={setUrlDraft}
        onWait={startWait}
      />
    </div>
  );
}

function BrowserLoginButton({
  vscode,
  waiting,
  onWait,
}: {
  vscode: VsCodeApi;
  waiting: boolean;
  onWait: () => void;
}) {
  return (
    <div className="row">
      <button
        className="btn primary"
        disabled={waiting}
        onClick={() => {
          onWait();
          vscode.postMessage({ type: "account_browser_login" });
        }}
      >
        {waiting ? t("Waiting for browser…") : t("Sign in with browser")}
      </button>
    </div>
  );
}

function WaitingHint({ timedOut }: { timedOut: boolean }) {
  return (
    <p className="muted" style={{ marginTop: "0.75rem" }}>
      {timedOut
        ? t("Still waiting — finish sign-in in the browser, or use an option below.")
        : t("Complete sign-in in the browser window, then return here.")}
    </p>
  );
}

function AdvancedSignIn(props: {
  vscode: VsCodeApi;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  pasteKey: string;
  setPasteKey: (v: string) => void;
  urlDraft: string;
  setUrlDraft: (v: string) => void;
  onWait: () => void;
}) {
  return (
    <details className="account-advanced">
      <summary className="muted">
        {t("Other sign-in options")}
      </summary>
      <MagicLinkField {...props} />
      <PasteKeyField vscode={props.vscode} pasteKey={props.pasteKey} setPasteKey={props.setPasteKey} />
      <GatewayUrlField urlDraft={props.urlDraft} setUrlDraft={props.setUrlDraft} vscode={props.vscode} />
    </details>
  );
}

function MagicLinkField(props: {
  vscode: VsCodeApi;
  loginEmail: string;
  setLoginEmail: (v: string) => void;
  onWait: () => void;
}) {
  return (
    <div className="field" style={{ marginTop: "0.75rem" }}>
      <label>{t("Email")}</label>
      <div className="row">
        <input
          type="email"
          value={props.loginEmail}
          placeholder="you@company.com"
          onChange={(e) => props.setLoginEmail(e.target.value)}
        />
        <button
          className="btn"
          disabled={!props.loginEmail.trim()}
          onClick={() => {
            props.onWait();
            props.vscode.postMessage({ type: "account_login", email: props.loginEmail.trim() });
          }}
        >
          {t("Send link")}
        </button>
      </div>
    </div>
  );
}

function PasteKeyField({
  vscode,
  pasteKey,
  setPasteKey,
}: {
  vscode: VsCodeApi;
  pasteKey: string;
  setPasteKey: (v: string) => void;
}) {
  return (
    <div className="field">
      <label>{t("Or paste an API key")}</label>
      <div className="row">
        <input
          type="password"
          value={pasteKey}
          placeholder="nk_…"
          onChange={(e) => setPasteKey(e.target.value)}
        />
        <button
          className="btn"
          disabled={!pasteKey.trim()}
          onClick={() => {
            vscode.postMessage({ type: "account_paste_key", key: pasteKey.trim() });
            setPasteKey("");
          }}
        >
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

function GatewayUrlField({
  urlDraft,
  setUrlDraft,
  vscode,
}: {
  urlDraft: string;
  setUrlDraft: (v: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="field">
      <label>{t("Gateway URL")}</label>
      <input
        value={urlDraft}
        placeholder="https://gateway.ninja-code.ai"
        onChange={(e) => setUrlDraft(e.target.value)}
        onBlur={(e) =>
          vscode.postMessage({
            type: "update_settings",
            configKind: "gateway",
            baseUrl: e.target.value,
          })
        }
      />
    </div>
  );
}
