export interface TelemetrySpan {
  name: string;
  startTime: number;
  attributes: Record<string, string | number | boolean | undefined>;
  end: (extra?: Record<string, string | number | boolean | undefined>) => void;
}

export interface TelemetryExporter {
  export(span: {
    name: string;
    startTime: number;
    endTime: number;
    attributes: Record<string, string | number | boolean | undefined>;
  }): void;
}

let enabled = process.env.NINJACODE_OTEL === "1";
let exporter: TelemetryExporter = {
  export(span) {
    process.stderr.write(`${JSON.stringify({ type: "otel.span", ...span })}\n`);
  },
};

/** Opt-in OpenTelemetry-shaped spans. Disabled unless configured or NINJACODE_OTEL=1. */
export function configureTelemetry(options: { enabled?: boolean; exporter?: TelemetryExporter } = {}): void {
  if (options.enabled !== undefined) enabled = options.enabled;
  if (options.exporter) exporter = options.exporter;
}

export function startSpan(
  name: string,
  attributes: Record<string, string | number | boolean | undefined> = {},
): TelemetrySpan {
  const startTime = Date.now();
  return {
    name,
    startTime,
    attributes: { ...attributes },
    end(extra = {}) {
      if (!enabled) return;
      exporter.export({
        name,
        startTime,
        endTime: Date.now(),
        attributes: { ...attributes, ...extra },
      });
    },
  };
}
