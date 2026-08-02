import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import type { ContextRef, DropItem } from "../protocol.js";
import { createRef } from "./contextRefs.js";

const MAX_SNIPPET_CHARS = 8_000;

export function toFsPath(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    if (raw.startsWith("file://") || raw.startsWith("vscode-file://")) {
      return vscode.Uri.parse(raw).fsPath;
    }
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return undefined;
  } catch {
    return undefined;
  }
  return path.isAbsolute(raw) ? raw : undefined;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

async function refForPath(absPath: string, root: string | undefined): Promise<ContextRef | undefined> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return undefined;
  }
  const rel = root ? path.relative(root, absPath) : absPath;
  const inside = Boolean(root) && !rel.startsWith("..") && !path.isAbsolute(rel);
  const target = inside ? rel.replace(/\\/g, "/") : absPath;
  const base = path.basename(absPath);

  if (stat.isDirectory()) {
    return createRef({ kind: "folder", target, label: `${base}/`, detail: target });
  }
  return createRef({ kind: "file", target, label: base, detail: target });
}

export async function resolveDropItems(
  items: readonly DropItem[],
  root: string | undefined,
): Promise<ContextRef[]> {
  const refs: ContextRef[] = [];
  for (const item of items) {
    const ref = await resolveDropItem(item, root);
    if (ref) refs.push(ref);
  }
  return refs;
}

async function resolveFileDrop(item: DropItem, root: string | undefined): Promise<ContextRef | undefined> {
  if (item.dataUrl && (item.mimeType ?? "").startsWith("image/")) {
    return createRef({
      kind: "image",
      target: item.name ?? "image",
      label: item.name ?? "image",
      dataUrl: item.dataUrl,
      mimeType: item.mimeType,
    });
  }
  const fsPath = toFsPath(item.value);
  if (fsPath) {
    const ref = await refForPath(fsPath, root);
    if (ref) return ref;
  }
  if (!item.text?.trim()) return undefined;
  const name = item.name ?? "file";
  const snippet = item.text.slice(0, MAX_SNIPPET_CHARS);
  return createRef({
    kind: "snippet",
    target: `dropped:${name}:${hashSnippet(snippet)}`,
    label: name,
    detail: `File ${name}:\n\`\`\`\n${snippet}\n\`\`\``,
  });
}

async function resolveUriDrop(item: DropItem, root: string | undefined): Promise<ContextRef | undefined> {
  if (isHttpUrl(item.value)) {
    return createRef({ kind: "url", target: item.value.trim(), label: hostOf(item.value) });
  }
  const fsPath = toFsPath(item.value);
  return fsPath ? refForPath(fsPath, root) : undefined;
}

async function resolveTextDrop(item: DropItem, root: string | undefined): Promise<ContextRef | undefined> {
  const text = item.value;
  if (!text.trim()) return undefined;
  if (isHttpUrl(text)) {
    return createRef({ kind: "url", target: text.trim(), label: hostOf(text) });
  }
  const fsPath = toFsPath(text) ?? (root ? path.join(root, text.trim()) : undefined);
  if (fsPath) {
    const ref = await refForPath(fsPath, root);
    if (ref) return ref;
  }
  const snippet = text.slice(0, MAX_SNIPPET_CHARS);
  if (!snippet.trim()) return undefined;
  return createRef({
    kind: "snippet",
    target: hashSnippet(snippet),
    label: firstLineLabel(snippet),
    detail: `Pasted snippet:\n\`\`\`\n${snippet}\n\`\`\``,
  });
}

async function resolveDropItem(item: DropItem, root: string | undefined): Promise<ContextRef | undefined> {
  if (item.kind === "file") return resolveFileDrop(item, root);
  if (item.kind === "uri") return resolveUriDrop(item, root);
  return resolveTextDrop(item, root);
}

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).host || url.trim();
  } catch {
    return url.trim();
  }
}

function firstLineLabel(text: string): string {
  const line = text.trim().split("\n")[0] ?? "snippet";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

function hashSnippet(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `snippet-${(h >>> 0).toString(36)}-${text.length}`;
}
