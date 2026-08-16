import type { SubAgentGovernanceOptions } from "./agentOptions.js";

export interface ResolvedSubAgentGovernance {
  maxConcurrency: number;
  maxCostUsd: number;
  maxTurns: number;
  timeoutMs: number;
}

export const DEFAULT_SUBAGENT_GOVERNANCE: ResolvedSubAgentGovernance = {
  maxConcurrency: 2,
  maxCostUsd: 0.5,
  maxTurns: 12,
  timeoutMs: 2 * 60 * 1000,
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function resolveSubAgentGovernance(
  options: SubAgentGovernanceOptions = {},
): ResolvedSubAgentGovernance {
  return {
    maxConcurrency: positiveInteger(options.maxConcurrency, DEFAULT_SUBAGENT_GOVERNANCE.maxConcurrency),
    maxCostUsd:
      options.maxCostUsd != null && Number.isFinite(options.maxCostUsd) && options.maxCostUsd > 0
        ? options.maxCostUsd
        : DEFAULT_SUBAGENT_GOVERNANCE.maxCostUsd,
    maxTurns: positiveInteger(options.maxTurns, DEFAULT_SUBAGENT_GOVERNANCE.maxTurns),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_SUBAGENT_GOVERNANCE.timeoutMs),
  };
}

function abortError(signal?: AbortSignal): DOMException {
  return new DOMException(String(signal?.reason ?? "Aborted"), "AbortError");
}

class PermitPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw abortError(signal);
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaseFunction();
    }
    return new Promise<() => void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve(this.releaseFunction());
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(grant);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError(signal));
      };
      this.waiters.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}

/** Shared scheduler: bounded children, with every writing task serialized. */
export class SubAgentOrchestrator {
  readonly governance: ResolvedSubAgentGovernance;
  private readonly permits: PermitPool;
  private readonly writerPermit = new PermitPool(1);

  constructor(options: SubAgentGovernanceOptions = {}) {
    this.governance = resolveSubAgentGovernance(options);
    this.permits = new PermitPool(this.governance.maxConcurrency);
  }

  async run<T>(writes: boolean, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    const releaseWriter = writes ? await this.writerPermit.acquire(signal) : undefined;
    try {
      const release = await this.permits.acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    } finally {
      releaseWriter?.();
    }
  }
}
