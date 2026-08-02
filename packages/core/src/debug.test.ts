import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DebugLogServer,
  DebugSession,
  readDebugLogs,
  summarizeByHypothesis,
  debugLogPath,
} from "./debug.js";
import { buildSystemPrompt } from "./rules.js";

describe("DebugLogServer", () => {
  it("accepts POSTs with a valid token and writes NDJSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-debug-"));
    const agentDir = path.join(dir, ".ninjacode");
    const server = new DebugLogServer(agentDir);
    try {
      const url = await server.start();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/log\/[a-f0-9]+$/);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesisId: "H1",
          location: "app.ts:10",
          message: "[DEBUG H1] value",
          data: { n: 42 },
        }),
      });
      expect(res.status).toBe(204);
      expect(server.count).toBe(1);

      const entries = await readDebugLogs(agentDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.hypothesisId).toBe("H1");
      expect(entries[0]!.data).toEqual({ n: 42 });
      expect(summarizeByHypothesis(entries)).toEqual({ H1: 1 });

      const raw = await fs.readFile(debugLogPath(agentDir), "utf8");
      expect(raw.trim().split("\n")).toHaveLength(1);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects POSTs without a valid token", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-debug-"));
    const agentDir = path.join(dir, ".ninjacode");
    const server = new DebugLogServer(agentDir);
    try {
      const url = await server.start();
      const bad = url.replace(/\/log\/.+$/, "/log/notatoken");
      const res = await fetch(bad, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesisId: "H1" }),
      });
      expect(res.status).toBe(404);
      expect(server.count).toBe(0);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("clears the log file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-debug-"));
    const agentDir = path.join(dir, ".ninjacode");
    const server = new DebugLogServer(agentDir);
    try {
      const url = await server.start();
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hypothesisId: "H2", message: "x" }),
      });
      await server.clear();
      expect(server.count).toBe(0);
      const entries = await readDebugLogs(agentDir);
      expect(entries).toHaveLength(0);
    } finally {
      await server.stop();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("DebugSession", () => {
  it("persists and loads hypotheses", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-hyp-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      const session = new DebugSession(agentDir);
      session.set([
        { id: "H1", description: "null deref", status: "pending" },
        { id: "H2", description: "race", status: "inconclusive" },
      ]);
      session.updateStatus("H1", "confirmed");
      await session.persist();

      const loaded = new DebugSession(agentDir);
      await loaded.load();
      expect(loaded.list()).toEqual([
        { id: "H1", description: "null deref", status: "confirmed" },
        { id: "H2", description: "race", status: "inconclusive" },
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildSystemPrompt debug mode", () => {
  it("includes the evidence-driven loop and log URL", () => {
    const prompt = buildSystemPrompt({
      mode: "debug",
      workspaceRoot: "/tmp/ws",
      debugLogUrl: "http://127.0.0.1:9999/log/abc",
      agentDir: "/tmp/ws/.ninjacode",
    });
    expect(prompt).toContain("DEBUG mode");
    expect(prompt).toContain("record_hypotheses");
    expect(prompt).toContain("NINJACODE-DEBUG-START");
    expect(prompt).toContain("http://127.0.0.1:9999/log/abc");
    expect(prompt).toContain("cleanup_instrumentation");
  });
});
