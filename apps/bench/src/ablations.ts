import type { PerformanceOptions } from "@ninjacode/core";

const ABLATION_COMPONENTS = [
  "parallel-tool-reads",
  "async-session-persistence",
  "provider-prompt-cache",
  "minimal-volatile-context",
] as const;

export type AblationComponent = (typeof ABLATION_COMPONENTS)[number];

export interface AblationVariant {
  name: string;
  disabled: AblationComponent[];
}

const PRESETS: Record<string, AblationVariant> = {
  optimized: { name: "optimized", disabled: [] },
  control: { name: "control", disabled: [...ABLATION_COMPONENTS] },
  "no-parallel-reads": {
    name: "no-parallel-reads",
    disabled: ["parallel-tool-reads"],
  },
  "no-async-persistence": {
    name: "no-async-persistence",
    disabled: ["async-session-persistence"],
  },
  "no-provider-cache": {
    name: "no-provider-cache",
    disabled: ["provider-prompt-cache"],
  },
  "no-context-deltas": {
    name: "no-context-deltas",
    disabled: ["minimal-volatile-context"],
  },
};

export function resolveAblationVariant(name = "optimized"): AblationVariant {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown ablation "${name}". Expected: ${Object.keys(PRESETS).join(", ")}`);
  }
  return { name: preset.name, disabled: [...preset.disabled] };
}

export function ablationAgentOptions(variant: AblationVariant): {
  performance: PerformanceOptions;
  enablePromptCache: boolean;
} {
  const disabled = new Set(variant.disabled);
  return {
    performance: {
      parallelToolReads: !disabled.has("parallel-tool-reads"),
      asyncSessionPersistence: !disabled.has("async-session-persistence"),
      minimalVolatileContext: !disabled.has("minimal-volatile-context"),
    },
    enablePromptCache: !disabled.has("provider-prompt-cache"),
  };
}

export function ablationComponents(variant: AblationVariant): Record<AblationComponent, boolean> {
  const disabled = new Set(variant.disabled);
  return Object.fromEntries(
    ABLATION_COMPONENTS.map((component) => [component, !disabled.has(component)]),
  ) as Record<AblationComponent, boolean>;
}

export function ablationPlan(scope: "quick" | "holdout" | "public-subset", variantName: string) {
  const variant = resolveAblationVariant(variantName);
  const commonGates = [
    "--max-pass-rate-drop", "0",
    "--max-cost-increase-pct", "30",
    "--max-wall-time-increase-pct", "40",
    "--max-p95-latency-increase-pct", "40",
    "--require-single-ablation",
  ];
  const run =
    scope === "quick"
      ? ["pnpm", "bench:confirm", "--", "--ablation", variant.name]
      : scope === "holdout"
        ? ["pnpm", "bench:holdout", "--", "--ablation", variant.name]
        : [
            `NINJACODE_PERF_ABLATION=${variant.name}`,
            "pnpm",
            "bench:harbor:subset",
          ];
  return {
    scope,
    variant,
    live: true,
    executed: false,
    run,
    compare: ["ninjabench", "compare", "<baseline>", "<variant>", ...commonGates],
  };
}
