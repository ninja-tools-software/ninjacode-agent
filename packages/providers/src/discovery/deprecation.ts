export interface RouteStatusRow {
  status: string;
}

/** Whether a provider deprecation date is in the past (UTC). */
export function isDeprecationPast(deprecationDate: string, now: Date): boolean {
  const parsed = Date.parse(deprecationDate);
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime();
}

/** True when no routes remain active — model should be marked deprecated. */
export function shouldDeprecateModel(routes: RouteStatusRow[]): boolean {
  return routes.length > 0 && routes.every((r) => r.status !== "active");
}

export interface ProposalCounts {
  new: number;
  missing: number;
  deprecated: number;
  price_change: number;
}

export function summarizeProposals(
  proposals: Array<{ kind: string }>,
): ProposalCounts {
  return {
    new: proposals.filter((p) => p.kind === "new").length,
    missing: proposals.filter((p) => p.kind === "missing").length,
    deprecated: proposals.filter((p) => p.kind === "deprecated").length,
    price_change: proposals.filter((p) => p.kind === "price_change").length,
  };
}
