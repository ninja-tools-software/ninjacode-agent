import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Tool, ToolResult } from "@ninjacode/tools";
import { ToolError } from "@ninjacode/tools";
import { toToolNameFragment } from "./slug.js";
import type { McpServerConfig } from "./mcpConfig.js";
import { expandEnvRefs } from "./mcpConfig.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

type McpToolDef = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
};

/** MCP client supporting stdio and HTTP streamable transports. */
export class McpClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private tools: McpToolDef[] = [];
  private readonly transport: "stdio" | "http";
  private readonly config: McpServerConfig;
  private closed = false;

  constructor(config: McpServerConfig) {
    this.config = {
      ...config,
      env: expandEnvRefs(config.env),
      headers: expandEnvRefs(config.headers),
    };
    this.transport = config.transport ?? (config.url ? "http" : "stdio");
  }

  async connect(): Promise<void> {
    if (this.transport === "http") {
      await this.initializeSession();
      return;
    }
    await this.connectStdio();
  }

  listTools() {
    return this.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = (await this.request(
      "tools/call",
      { name, arguments: args },
      signal,
    )) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text =
      result.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n") ?? JSON.stringify(result);
    if (result.isError) throw new ToolError(text, "runtime");
    return text;
  }

  async listResources(): Promise<Array<{ uri: string; name?: string }>> {
    try {
      const res = (await this.request("resources/list", {})) as {
        resources?: Array<{ uri: string; name?: string }>;
      };
      return res.resources ?? [];
    } catch {
      return [];
    }
  }

  async listPrompts(): Promise<Array<{ name: string; description?: string }>> {
    try {
      const res = (await this.request("prompts/list", {})) as {
        prompts?: Array<{ name: string; description?: string }>;
      };
      return res.prompts ?? [];
    } catch {
      return [];
    }
  }

  getConfig(): McpServerConfig {
    return this.config;
  }

  asNinjaTools(): Tool[] {
    return this.tools.map((t) => {
      const serverName = this.config.name;
      const toolName = toToolNameFragment(`mcp_${serverName}_${t.name}`);
      return {
        name: toolName,
        description: `[MCP:${serverName}] ${t.description ?? t.name}`,
        risk: "network" as const,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        target(args: Record<string, unknown>) {
          return `${serverName}:${t.name}:${JSON.stringify(args).slice(0, 60)}`;
        },
        execute: async (ctx, args): Promise<ToolResult> => {
          const output = await this.callTool(t.name, args, ctx.signal);
          return { output };
        },
      } satisfies Tool;
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.proc?.kill();
    this.proc = null;
  }

  private async initializeSession(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ninjacode", version: "0.1.0" },
    });
    await this.notify("notifications/initialized", {});
    await this.refreshTools();
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error(`MCP server ${this.config.name}: command required for stdio`);
    }

    this.proc = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.config.env },
    });

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this.handleLine(line));

    this.proc.on("exit", () => {
      this.closed = true;
      for (const [, p] of this.pending) {
        p.reject(new Error("MCP process exited"));
      }
      this.pending.clear();
    });

    await this.initializeSession();
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.method === "notifications/tools/list_changed") {
        void this.refreshTools();
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    } catch {
      // ignore
    }
  }

  private async refreshTools(): Promise<void> {
    try {
      const listed = (await this.request("tools/list", {})) as { tools?: McpToolDef[] };
      this.tools = listed.tools ?? [];
    } catch {
      // ignore
    }
  }

  private request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    if (this.transport === "http") {
      return this.httpRequest(req, signal);
    }

    return this.stdioRequest(req, id, method, signal);
  }

  private stdioRequest(
    req: JsonRpcRequest,
    id: number,
    method: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("MCP request aborted"));
        return;
      }
      if (!this.proc?.stdin || this.closed) {
        reject(new Error("MCP process not started"));
        return;
      }

      const onAbort = () => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("MCP request aborted"));
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(id, {
        resolve: (v) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
      });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`MCP timeout: ${method}`));
      }, 30_000);
    });
  }

  private async httpRequest(req: JsonRpcRequest, signal?: AbortSignal): Promise<unknown> {
    if (!this.config.url) throw new Error("MCP HTTP url required");
    const timeoutSignal = AbortSignal.timeout(30_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...this.config.headers,
      },
      body: JSON.stringify(req),
      signal: combinedSignal,
    });
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream") && res.body) {
      return readSseJsonRpcResult(res.body, req.id);
    }

    const msg = (await res.json()) as JsonRpcResponse;
    if (msg.error) throw new Error(msg.error.message);
    return msg.result;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (this.transport === "http") {
      if (!this.config.url) return;
      await fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      }).catch(() => undefined);
      return;
    }
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
}

async function readSseJsonRpcResult(body: ReadableStream<Uint8Array>, requestId: number): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = findSseJsonRpcResult(buffer, requestId);
    if (match.found) return match.result;
  }

  throw new Error("MCP HTTP stream ended without result");
}

function findSseJsonRpcResult(
  buffer: string,
  requestId: number,
): { found: true; result: unknown } | { found: false } {
  for (const line of buffer.split("\n")) {
    const parsed = tryParseSseJsonRpcLine(line, requestId);
    if (parsed.matched) return { found: true, result: parsed.result };
  }
  return { found: false };
}

function tryParseSseJsonRpcLine(
  line: string,
  requestId: number,
): { matched: true; result: unknown } | { matched: false } {
  if (!line.startsWith("data:")) return { matched: false };
  try {
    const msg = JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
    if (msg.id !== requestId) return { matched: false };
    if (msg.error) throw new Error(msg.error.message);
    return { matched: true, result: msg.result };
  } catch (e) {
    if (e instanceof Error && e.message && !e.message.includes("JSON")) throw e;
    return { matched: false };
  }
}
