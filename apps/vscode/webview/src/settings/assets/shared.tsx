import React, { useEffect, useRef } from "react";
import { t } from "../../i18n.js";
import { CloseIcon, EditIcon, ExportIcon, PlusIcon, TrashIcon } from "../../icons.js";

type AssetFamily = "mcp" | "skill" | "rule" | "agent";

export const NEXT_RUN_HINT = "Changes apply to the next message you send.";

/** Files under `.ninjacode/` are ours; the rest are foreign conventions we read. */
export function isManaged(source: string): boolean {
  return source.startsWith(".ninjacode");
}

export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function joinList(value: string[] | undefined): string {
  return (value ?? []).join(", ");
}

/** Subscribe to host replies for one asset family (bodies loaded on demand, errors). */
export function useAssetMessages(
  kind: AssetFamily,
  handlers: {
    onBody?: (id: string, data: Record<string, unknown>) => void;
    onError?: (message: string) => void;
  },
): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as Record<string, unknown> & { type?: string; kind?: string };
      if (msg.kind !== kind) return;
      if (msg.type === "asset_body") ref.current.onBody?.(String(msg.id ?? ""), msg);
      if (msg.type === "asset_error") ref.current.onError?.(String(msg.message ?? t("Failed")));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [kind]);
}

export function AssetToolbar({
  label,
  hint,
  onNew,
  children,
}: {
  label: string;
  hint?: string;
  onNew?: { label: string; onClick: () => void };
  children?: React.ReactNode;
}) {
  return (
    <div className="card__label">
      <span>{label}</span>
      {hint && <span className="asset-hint muted">{hint}</span>}
      <span className="grow" />
      {children}
      {onNew && (
        <button className="btn subtle" onClick={onNew.onClick}>
          <PlusIcon size={12} />
          {onNew.label}
        </button>
      )}
    </div>
  );
}

export function AssetRow({
  title,
  badges,
  summary,
  enabled,
  onToggle,
  onEdit,
  onOpen,
  onDelete,
  details,
}: {
  title: React.ReactNode;
  badges?: React.ReactNode;
  summary?: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
  details?: React.ReactNode;
}) {
  return (
    <div className={`asset-row ${enabled ? "" : "asset-row--off"}`}>
      <label className="asset-row__toggle" data-tooltip={enabled ? t("Disable") : t("Enable")}>
        <input type="checkbox" checked={enabled} onChange={onToggle} />
      </label>
      <div className="asset-row__body">
        <div className="asset-row__title">
          <strong>{title}</strong>
          {badges}
        </div>
        {summary && <div className="asset-row__summary muted">{summary}</div>}
        {details}
      </div>
      <div className="asset-row__actions">
        {onEdit && (
          <button className="btn subtle" data-tooltip={t("Edit")} onClick={onEdit}>
            <EditIcon size={12} />
          </button>
        )}
        {onOpen && (
          <button className="btn subtle" data-tooltip={t("Open file")} onClick={onOpen}>
            <ExportIcon size={12} />
          </button>
        )}
        {onDelete && (
          <button className="btn subtle danger" data-tooltip={t("Delete")} onClick={onDelete}>
            <TrashIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function AssetForm({
  title,
  onSave,
  onCancel,
  saveLabel,
  error,
  children,
}: {
  title: string;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
    ref.current?.querySelector<HTMLInputElement>("input, textarea")?.focus();
  }, []);

  return (
    <div className="asset-form" ref={ref}>
      <div className="asset-form__head">
        <strong>{title}</strong>
        <button className="btn subtle" data-tooltip={t("Cancel")} onClick={onCancel}>
          <CloseIcon size={12} />
        </button>
      </div>
      {children}
      {error && <p className="asset-form__error">{error}</p>}
      <div className="asset-form__actions">
        <button className="btn primary" onClick={onSave}>
          {saveLabel ?? t("Save")}
        </button>
        <button className="btn" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="asset-field">
      <span className="asset-field__label">
        {label}
        {hint && <span className="muted"> — {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function KeyValueRows({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  rows: Array<[string, string]>;
  onChange: (rows: Array<[string, string]>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const update = (i: number, idx: 0 | 1, value: string) => {
    const next = rows.map((r) => [...r] as [string, string]);
    next[i]![idx] = value;
    onChange(next);
  };
  return (
    <div className="kv-rows">
      {rows.map((row, i) => (
        <div className="kv-rows__row" key={i}>
          <input
            value={row[0]}
            placeholder={keyPlaceholder}
            onChange={(e) => update(i, 0, e.target.value)}
          />
          <input
            value={row[1]}
            placeholder={valuePlaceholder}
            onChange={(e) => update(i, 1, e.target.value)}
          />
          <button
            className="btn subtle danger"
            data-tooltip={t("Remove")}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button className="btn subtle" onClick={() => onChange([...rows, ["", ""]])}>
        <PlusIcon size={12} />
        {t("Add")}
      </button>
    </div>
  );
}

export function recordToRows(record: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(record ?? {});
}

export function rowsToRecord(rows: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of rows) {
    if (key.trim()) out[key.trim()] = value;
  }
  return out;
}
