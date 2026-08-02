/**
 * Extract droppable context from a `DataTransfer`.
 *
 * Every source spells the same thing differently: the VS Code explorer sends
 * `resourceurls`, editor tabs send `codefiles` plus `text/uri-list`, the SCM view
 * sends only `text/uri-list`, the OS sends `File` objects, and a browser link
 * sends `text/plain`. This module flattens all of them into `DropItem[]`, which
 * the host resolves into badges. Unknown formats degrade to plain text rather
 * than being dropped on the floor.
 */
import type { DropItem } from "../types.js";
import { readFileAsDataUrl, readFileAsText } from "../format.js";

/** Largest non-image file we inline as a snippet when the OS gives us no path. */
const MAX_INLINE_FILE_BYTES = 2_000_000;

/** The subset of `DataTransfer` we rely on, so the parser stays testable. */
export interface DataTransferLike {
  types: readonly string[];
  getData: (format: string) => string;
  files?: ArrayLike<File>;
}

const URI_FORMATS = ["text/uri-list", "resourceurls", "codefiles", "codeeditors"] as const;

/** True when a drag carries something we can attach, checked during `dragover`. */
export function hasDroppableContent(types: readonly string[]): boolean {
  return types.some(
    (t) => t === "Files" || t === "text/plain" || (URI_FORMATS as readonly string[]).includes(t),
  );
}

function parseUriList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** `resourceurls` and `codefiles` are JSON arrays of strings (URIs or fs paths). */
function parseJsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry;
        // `codeeditors` entries are objects: { resource: "file:///…" }.
        if (entry && typeof entry === "object" && "resource" in entry) {
          const resource = (entry as { resource: unknown }).resource;
          return typeof resource === "string" ? resource : "";
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** VS Code percent-encodes explorer URIs; decode so the host sees a real path. */
function decodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function collectUris(dt: DataTransferLike): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const decoded = decodeUri(value.trim());
    if (decoded && !out.includes(decoded)) out.push(decoded);
  };

  for (const format of URI_FORMATS) {
    if (!dt.types.includes(format)) continue;
    const raw = dt.getData(format);
    if (!raw) continue;
    const values = format === "text/uri-list" ? parseUriList(raw) : parseJsonList(raw);
    values.forEach(push);
  }
  return out;
}

async function fileToItem(file: File): Promise<DropItem | null> {
  const mimeType = file.type || undefined;
  // Electron strips `File.path` in sandboxed webviews, so images travel as data
  // URLs and text files as inlined content; only the name survives either way.
  if (mimeType?.startsWith("image/")) {
    try {
      return { kind: "file", value: file.name, name: file.name, mimeType, dataUrl: await readFileAsDataUrl(file) };
    } catch {
      return null;
    }
  }
  if (file.size > MAX_INLINE_FILE_BYTES) {
    return { kind: "file", value: file.name, name: file.name, mimeType };
  }
  try {
    return { kind: "file", value: file.name, name: file.name, mimeType, text: await readFileAsText(file) };
  } catch {
    return { kind: "file", value: file.name, name: file.name, mimeType };
  }
}

/**
 * Flatten a drop into items for the host. URIs win over plain text: dragging a
 * file from the explorer carries both, and the path is the useful half.
 */
export async function parseDataTransfer(dt: DataTransferLike): Promise<DropItem[]> {
  const items: DropItem[] = [];

  for (const uri of collectUris(dt)) {
    items.push({ kind: "uri", value: uri });
  }

  const files = dt.files ? Array.from(dt.files) : [];
  for (const file of files) {
    const item = await fileToItem(file);
    if (item) items.push(item);
  }

  if (items.length === 0 && dt.types.includes("text/plain")) {
    const text = dt.getData("text/plain");
    if (text.trim()) items.push({ kind: "text", value: text });
  }

  return items;
}

/** Human label for the drop overlay, before anything is resolved. */
export function describeDrop(types: readonly string[]): string {
  if (types.includes("Files")) return "Drop files to attach";
  if (types.some((t) => (URI_FORMATS as readonly string[]).includes(t))) return "Drop to attach";
  return "Drop text to attach";
}
