import { animCls } from "../hooks/useAnimatedPresence.js";
import type { Hypothesis } from "../types.js";

export function HypothesesPanel({
  hypotheses,
  debugLogCount,
  closing,
}: {
  hypotheses: Hypothesis[];
  debugLogCount: number;
  closing?: boolean;
}) {
  return (
    <div className={animCls("hypotheses panel-enter", closing && "anim-closing")}>
      <div className="hypotheses-header">
        <strong>Hypotheses</strong>
        <span className="log-count">{debugLogCount} log(s)</span>
      </div>
      {hypotheses.length === 0 ? (
        <div className="hypotheses-empty">Waiting for hypotheses…</div>
      ) : (
        <ul>
          {hypotheses.map((h) => (
            <li key={h.id} className={`hyp status-${h.status}`}>
              <span className="hyp-badge">{h.status}</span>
              <span className="hyp-id">{h.id}</span>
              <span className="hyp-desc">{h.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
