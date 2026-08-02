#!/usr/bin/env node
/**
 * NinjaCode ACP agent — JSON-RPC 2.0 over stdio.
 * Compatible with JetBrains IDEs, Zed, and community ACP clients.
 *
 * Spec reference: https://agentclientprotocol.com / https://zed.dev/acp
 */
import { createInterface } from "node:readline";
import { initLocale, t } from "./i18n.js";
import { handle, type JsonRpcRequest } from "./rpcHandlers.js";
import { respondError } from "./rpcTransport.js";

function main(): void {
  initLocale();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      return;
    }
    void handle(msg).catch((e) => {
      respondError(msg.id, -32000, (e as Error).message);
    });
  });
  console.error(t("acp.listening"));
}

main();
