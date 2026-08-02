import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export type HypothesisStatus = "pending" | "confirmed" | "rejected" | "inconclusive";

export interface Hypothesis {
  id: string;
  description: string;
  status: HypothesisStatus;
}

export interface DebugLogEntry {
  timestamp: string;
  hypothesisId: string;
  location?: string;
  message?: string;
  data?: unknown;
}

const DEBUG_LOG_FILENAME = "debug.log";
const HYPOTHESES_FILENAME = "hypotheses.json";

export function debugLogPath(agentDir: string): string {
  return path.join(agentDir, DEBUG_LOG_FILENAME);
}

export function hypothesesPath(agentDir: string): string {
  return path.join(agentDir, HYPOTHESES_FILENAME);
}

/**
 * In-memory hypothesis state, optionally persisted under `.ninjacode/hypotheses.json`.
 */
export class DebugSession {
  private hypotheses: Hypothesis[] = [];

  constructor(private readonly agentDir: string) {}

  list(): Hypothesis[] {
    return this.hypotheses.map((h) => ({ ...h }));
  }

  set(hypotheses: Hypothesis[]): void {
    this.hypotheses = hypotheses.map((h) => ({
      id: h.id,
      description: h.description,
      status: h.status ?? "pending",
    }));
  }

  updateStatus(id: string, status: HypothesisStatus): boolean {
    const h = this.hypotheses.find((x) => x.id === id);
    if (!h) return false;
    h.status = status;
    return true;
  }

  async persist(): Promise<void> {
    await fs.mkdir(this.agentDir, { recursive: true });
    await fs.writeFile(
      hypothesesPath(this.agentDir),
      JSON.stringify({ hypotheses: this.hypotheses }, null, 2),
      "utf8",
    );
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(hypothesesPath(this.agentDir), "utf8");
      const parsed = JSON.parse(raw) as { hypotheses?: Hypothesis[] };
      if (Array.isArray(parsed.hypotheses)) this.set(parsed.hypotheses);
    } catch {
      // none
    }
  }
}

/**
 * Local HTTP server that accepts NDJSON debug log posts from instrumented code.
 * Listens on 127.0.0.1 with an ephemeral port and a token in the path.
 */
export class DebugLogServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly token: string;
  private logCount = 0;
  private onLog?: (entry: DebugLogEntry) => void;

  constructor(
    private readonly agentDir: string,
    options?: { onLog?: (entry: DebugLogEntry) => void },
  ) {
    this.token = randomBytes(16).toString("hex");
    this.onLog = options?.onLog;
  }

  get url(): string {
    if (!this.port) throw new Error("DebugLogServer is not started");
    return `http://127.0.0.1:${this.port}/log/${this.token}`;
  }

  get count(): number {
    return this.logCount;
  }

  getToken(): string {
    return this.token;
  }

  async start(): Promise<string> {
    if (this.server) return this.url;

    await fs.mkdir(this.agentDir, { recursive: true });
    const logFile = debugLogPath(this.agentDir);

    this.server = http.createServer(async (req, res) => {
      // CORS for browser-side instrumentation
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: this.logCount }));
        return;
      }

      const expected = `/log/${this.token}`;
      if (req.method !== "POST" || req.url !== expected) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      try {
        const body = await readBody(req);
        let parsed: Record<string, unknown> = {};
        if (body.trim()) {
          parsed = JSON.parse(body) as Record<string, unknown>;
        }
        const entry: DebugLogEntry = {
          timestamp: new Date().toISOString(),
          hypothesisId: String(parsed.hypothesisId ?? parsed.hypothesis_id ?? "unknown"),
          location: parsed.location != null ? String(parsed.location) : undefined,
          message: parsed.message != null ? String(parsed.message) : undefined,
          data: parsed.data,
        };
        await fs.appendFile(logFile, JSON.stringify(entry) + "\n", "utf8");
        this.logCount += 1;
        this.onLog?.(entry);
        res.writeHead(204);
        res.end();
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = this.server.address() as AddressInfo;
    this.port = addr.port;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });
  }

  async clear(): Promise<void> {
    const logFile = debugLogPath(this.agentDir);
    await fs.writeFile(logFile, "", "utf8");
    this.logCount = 0;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Read NDJSON debug log with optional filters. */
export async function readDebugLogs(
  agentDir: string,
  options?: {
    hypothesisId?: string;
    since?: string;
    limit?: number;
    tail?: number;
  },
): Promise<DebugLogEntry[]> {
  const logFile = debugLogPath(agentDir);
  let raw = "";
  try {
    raw = await fs.readFile(logFile, "utf8");
  } catch {
    return [];
  }
  let entries: DebugLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as DebugLogEntry);
    } catch {
      // skip bad lines
    }
  }
  if (options?.hypothesisId) {
    entries = entries.filter((e) => e.hypothesisId === options.hypothesisId);
  }
  if (options?.since) {
    const since = options.since;
    entries = entries.filter((e) => e.timestamp >= since);
  }
  if (options?.tail && options.tail > 0) {
    entries = entries.slice(-options.tail);
  }
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }
  return entries;
}

export function summarizeByHypothesis(entries: DebugLogEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.hypothesisId] = (counts[e.hypothesisId] ?? 0) + 1;
  }
  return counts;
}
