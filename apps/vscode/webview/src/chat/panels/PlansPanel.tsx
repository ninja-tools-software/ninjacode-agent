import { useMemo } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, DotsIcon, TrashIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { groupSessionsByRecency } from "../format.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import { useAnchoredMenu } from "../hooks/useAnchoredMenu.js";
import type { PlanSummary, VsCodeApi } from "../types.js";

interface PlansPanelProps {
  plans: PlanSummary[];
  activePlanId?: string;
  loading: boolean;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (planId: string) => void;
  onActivate: (planId: string) => void;
  onDelete: (planId: string) => void;
  closing?: boolean;
  vscode: VsCodeApi;
}

function PlanItemMenu({
  plan,
  menu,
  onDelete,
  vscode,
}: {
  plan: PlanSummary;
  menu: ReturnType<typeof useAnchoredMenu>;
  onDelete: (planId: string) => void;
  vscode: VsCodeApi;
}) {
  if (!menu.mounted) return null;
  return createPortal(
    <div
      ref={menu.menuRef}
      className={animCls("plans-item-menu anim-pop", menu.closing && "anim-closing")}
      style={menu.menuStyle}
      role="menu"
    >
      <button
        type="button"
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation();
          menu.setOpen(false);
          vscode.postMessage({ type: "open_plan", planId: plan.id });
        }}
      >
        {t("Open preview")}
      </button>
      <button
        type="button"
        className="menu-item danger"
        onClick={(e) => {
          e.stopPropagation();
          menu.setOpen(false);
          onDelete(plan.id);
        }}
      >
        <TrashIcon size={14} /> {t("Delete")}
      </button>
    </div>,
    document.body,
  );
}

function PlanItemMain({
  plan,
  active,
  onOpen,
}: {
  plan: PlanSummary;
  active: boolean;
  onOpen: (planId: string) => void;
}) {
  return (
    <button
      type="button"
      className="plans-main"
      data-tooltip={t("Open plan: {0}", plan.title)}
      onClick={() => onOpen(plan.id)}
    >
      <span className="plans-active-icon" aria-hidden="true">
        {active ? <CheckIcon size={12} /> : null}
      </span>
      <span className="plans-copy">
        <span className="plans-title">{plan.title}</span>
        {plan.preview && <span className="plans-preview muted">{plan.preview}</span>}
      </span>
    </button>
  );
}

function PlanItemActions({
  plan,
  active,
  menu,
  onActivate,
  onDelete,
  vscode,
}: {
  plan: PlanSummary;
  active: boolean;
  menu: ReturnType<typeof useAnchoredMenu>;
  onActivate: (planId: string) => void;
  onDelete: (planId: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="plans-item-actions">
      {!active && (
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          data-tooltip={t("Use this plan in the current session")}
          aria-label={t("Activate plan")}
          onClick={(e) => {
            e.stopPropagation();
            onActivate(plan.id);
          }}
        >
          {t("Use")}
        </button>
      )}
      <div className="plans-item-menu-wrap">
        <button
          ref={menu.buttonRef}
          type="button"
          className={`icon-btn icon-btn--sm${menu.open ? " active" : ""}`}
          data-tooltip={t("More actions")}
          aria-label={t("More actions")}
          aria-expanded={menu.open}
          onClick={(e) => {
            e.stopPropagation();
            menu.toggle();
          }}
        >
          <DotsIcon size={12} />
        </button>
        <PlanItemMenu plan={plan} menu={menu} onDelete={onDelete} vscode={vscode} />
      </div>
    </div>
  );
}

function PlanItem({
  plan,
  active,
  onOpen,
  onActivate,
  onDelete,
  vscode,
}: {
  plan: PlanSummary;
  active: boolean;
  onOpen: (planId: string) => void;
  onActivate: (planId: string) => void;
  onDelete: (planId: string) => void;
  vscode: VsCodeApi;
}) {
  const menu = useAnchoredMenu();

  return (
    <li className={`plans-item${active ? " active" : ""}`}>
      <PlanItemMain plan={plan} active={active} onOpen={onOpen} />
      <PlanItemActions
        plan={plan}
        active={active}
        menu={menu}
        onActivate={onActivate}
        onDelete={onDelete}
        vscode={vscode}
      />
    </li>
  );
}

export function PlansPanel({
  plans,
  activePlanId,
  loading,
  query,
  onQuery,
  onOpen,
  onActivate,
  onDelete,
  closing,
  vscode,
}: PlansPanelProps) {
  const groups = useMemo(() => groupSessionsByRecency(plans), [plans]);

  return (
    <div className={animCls("plans-panel anim-slide-right", closing && "anim-closing")}>
      <input
        className="plans-search"
        value={query}
        placeholder={t("Search plans…")}
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="plans-scroll">
        {loading && <p className="muted plans-empty">{t("Loading…")}</p>}
        {!loading && plans.length === 0 && <p className="muted plans-empty">{t("No plans yet.")}</p>}
        {groups.map((group) => (
          <section key={group.label}>
            <div className="plans-group-label">{t(group.label)}</div>
            <ul className="plans-list">
              {group.sessions.map((p) => (
                <PlanItem
                  key={p.id}
                  plan={p}
                  active={p.id === activePlanId}
                  onOpen={onOpen}
                  onActivate={onActivate}
                  onDelete={onDelete}
                  vscode={vscode}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
