import { useDismiss } from "./hooks/useDismiss.js";
import { PlansPanel } from "./panels/PlansPanel.js";
import { PlansToggleButton } from "./PlansToggleButton.js";
import type { PlanSummary, VsCodeApi } from "./types.js";

export function PlansHeaderPopover({
  plansOpen,
  plansClosing,
  plansMounted,
  plansItems,
  plansQuery,
  activePlanId,
  plansLoading,
  onToggle,
  onClose,
  onQuery,
  onOpen,
  onActivate,
  onDelete,
  vscode,
}: {
  plansOpen: boolean;
  plansClosing: boolean;
  plansMounted: boolean;
  plansItems: PlanSummary[];
  plansQuery: string;
  activePlanId?: string;
  plansLoading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onQuery: (q: string) => void;
  onOpen: (planId: string) => void;
  onActivate: (planId: string) => void;
  onDelete: (planId: string) => void;
  vscode: VsCodeApi;
}) {
  const wrapRef = useDismiss<HTMLDivElement>(plansOpen, onClose);
  return (
    <div className="plans-popover-wrap" ref={wrapRef}>
      <PlansToggleButton plansOpen={plansOpen} plansLoading={plansLoading} onToggle={onToggle} />
      {plansMounted && (
        <PlansPanel
          plans={plansItems}
          activePlanId={activePlanId}
          loading={plansLoading}
          query={plansQuery}
          onQuery={onQuery}
          closing={plansClosing}
          onOpen={onOpen}
          onActivate={onActivate}
          onDelete={onDelete}
          vscode={vscode}
        />
      )}
    </div>
  );
}
