import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const PLANS_DIR = "plans";
export const PLAN_FILE_SUFFIX = ".plan.md";
const PLAN_HEADER_PREFIX = "<!-- ninjacode:plan ";
const PLAN_HEADER_SUFFIX = " -->";

export interface PlanRecord {
  id: string;
  title: string;
  file: string;
  relPath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
}

export interface PlanSummary {
  id: string;
  title: string;
  relPath: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
}

export interface WritePlanInput {
  planId: string;
  sessionId: string;
  title: string;
  content: string;
}

/** Stable 8-char plan id derived from the session UUID. */
export function planIdForSession(sessionId: string): string {
  return createHash("sha1").update(sessionId).digest("hex").slice(0, 8);
}

/** Slug for filenames: lowercase, diacritics stripped, non-alnum → hyphen. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "plan";
}

export function plansDir(agentDir: string): string {
  return path.join(agentDir, PLANS_DIR);
}

function encodeHeaderTitle(title: string): string {
  return encodeURIComponent(title.trim());
}

function decodeHeaderTitle(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export interface ParsedPlanHeader {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
}

export function parsePlanHeader(raw: string): ParsedPlanHeader | null {
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(PLAN_HEADER_PREFIX));
  if (!line) return null;
  const inner = line.slice(PLAN_HEADER_PREFIX.length, line.endsWith(PLAN_HEADER_SUFFIX) ? -PLAN_HEADER_SUFFIX.length : undefined);
  const parts = inner.trim().split(/\s+/);
  const fields: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!fields.id || !fields.session || !fields.created || !fields.updated) return null;
  return {
    id: fields.id,
    sessionId: fields.session,
    createdAt: fields.created,
    updatedAt: fields.updated,
    title: fields.title ? decodeHeaderTitle(fields.title) : "",
  };
}

function renderPlanHeader(meta: ParsedPlanHeader): string {
  const title = encodeHeaderTitle(meta.title);
  return `${PLAN_HEADER_PREFIX}id=${meta.id} session=${meta.sessionId} created=${meta.createdAt} updated=${meta.updatedAt} title=${title}${PLAN_HEADER_SUFFIX}`;
}

/** Strip the metadata header line from plan file content. */
export function stripPlanHeader(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.startsWith(PLAN_HEADER_PREFIX)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return content;
}

const TASKS_START = "<!-- ninjacode:tasks:start -->";
const TASKS_END = "<!-- ninjacode:tasks:end -->";

/** Remove machine-readable task sync markers; keeps the rendered checklist. */
export function stripTasksMarkers(content: string): string {
  return content
    .replace(new RegExp(`${TASKS_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`, "g"), "")
    .replace(new RegExp(`\\r?\\n?${TASKS_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), "");
}

/** Plan markdown safe to show in UI (no file metadata or sync markers). */
export function planContentForDisplay(content: string): string {
  return stripTasksMarkers(stripPlanHeader(content));
}

function planPreview(content: string): string {
  const body = planContentForDisplay(content)
    .replace(/^#+\s+[^\n]+\n+/m, "")
    .replace(/## Tasks[\s\S]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, 140);
}

function planFileName(slug: string, planId: string): string {
  return `${slug}_${planId}${PLAN_FILE_SUFFIX}`;
}

/** Find the on-disk plan file for a stable plan id, if any. */
export async function resolvePlanFile(agentDir: string, planId: string): Promise<string | null> {
  const dir = plansDir(agentDir);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return null;
  }
  const suffix = `_${planId}${PLAN_FILE_SUFFIX}`;
  const match = files.find((f) => f.endsWith(suffix));
  return match ? path.join(dir, match) : null;
}

async function writePlanFileAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

function extractTitleFromContent(content: string, fallback: string): string {
  const body = stripPlanHeader(content);
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

/** Create or overwrite the session plan (one file per stable plan id). */
export async function writePlan(agentDir: string, input: WritePlanInput): Promise<PlanRecord> {
  const now = new Date().toISOString();
  const title = input.title.trim() || "Untitled plan";
  const body = stripPlanHeader(input.content.trim());
  const existingFile = await resolvePlanFile(agentDir, input.planId);

  let createdAt = now;
  let filename: string;
  if (existingFile) {
    const existingRaw = await fs.readFile(existingFile, "utf8");
    const header = parsePlanHeader(existingRaw);
    if (header) createdAt = header.createdAt;
    filename = path.basename(existingFile);
  } else {
    filename = planFileName(slugifyTitle(title), input.planId);
  }

  const header = renderPlanHeader({
    id: input.planId,
    sessionId: input.sessionId,
    createdAt,
    updatedAt: now,
    title,
  });
  const next = `${header}\n${body.startsWith("#") ? body : `# ${title}\n\n${body}`}\n`;
  const file = path.join(plansDir(agentDir), filename);
  await writePlanFileAtomic(file, next);

  return {
    id: input.planId,
    title,
    file,
    relPath: path.join(".ninjacode", PLANS_DIR, filename).replace(/\\/g, "/"),
    content: next,
    createdAt,
    updatedAt: now,
    sessionId: input.sessionId,
  };
}

export async function readPlan(agentDir: string, planId: string): Promise<PlanRecord | null> {
  const file = await resolvePlanFile(agentDir, planId);
  if (!file) return null;
  try {
    const content = await fs.readFile(file, "utf8");
    const header = parsePlanHeader(content);
    const title = header?.title || extractTitleFromContent(content, "Untitled plan");
    return {
      id: planId,
      title,
      file,
      relPath: path.join(".ninjacode", PLANS_DIR, path.basename(file)).replace(/\\/g, "/"),
      content,
      createdAt: header?.createdAt ?? new Date(0).toISOString(),
      updatedAt: header?.updatedAt ?? new Date(0).toISOString(),
      sessionId: header?.sessionId ?? "",
    };
  } catch {
    return null;
  }
}

export async function listPlans(agentDir: string): Promise<PlanSummary[]> {
  const dir = plansDir(agentDir);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const summaries = await Promise.all(files.map((f) => readPlanSummary(dir, f)));
  return summaries
    .filter((summary): summary is PlanSummary => summary !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readPlanSummary(dir: string, filename: string): Promise<PlanSummary | null> {
  if (!filename.endsWith(PLAN_FILE_SUFFIX)) return null;
  const idMatch = filename.match(/_([a-f0-9]{8})\.plan\.md$/);
  if (!idMatch) return null;
  const file = path.join(dir, filename);
  try {
    const content = await fs.readFile(file, "utf8");
    const header = parsePlanHeader(content);
    const id = header?.id ?? idMatch[1]!;
    const title = header?.title || extractTitleFromContent(content, "Untitled plan");
    return {
      id,
      title,
      relPath: path.join(".ninjacode", PLANS_DIR, filename).replace(/\\/g, "/"),
      preview: planPreview(content),
      createdAt: header?.createdAt ?? new Date(0).toISOString(),
      updatedAt: header?.updatedAt ?? new Date(0).toISOString(),
      sessionId: header?.sessionId ?? "",
    };
  } catch {
    return null;
  }
}

export async function deletePlan(agentDir: string, planId: string): Promise<boolean> {
  const file = await resolvePlanFile(agentDir, planId);
  if (!file) return false;
  await fs.unlink(file).catch(() => undefined);
  return true;
}

/** Update display title in header and first H1 without renaming the file. */
export async function renamePlanTitle(
  agentDir: string,
  planId: string,
  title: string,
): Promise<PlanRecord | null> {
  const file = await resolvePlanFile(agentDir, planId);
  if (!file) return null;
  const trimmed = title.trim().slice(0, 120) || "Untitled plan";
  const raw = await fs.readFile(file, "utf8");
  const header = parsePlanHeader(raw);
  if (!header) return null;
  const now = new Date().toISOString();
  const nextHeader = renderPlanHeader({ ...header, title: trimmed, updatedAt: now });
  let body = stripPlanHeader(raw);
  if (/^#\s+/m.test(body)) {
    body = body.replace(/^#\s+[^\n]+/m, `# ${trimmed}`);
  } else {
    body = `# ${trimmed}\n\n${body}`;
  }
  const next = `${nextHeader}\n${body.trimEnd()}\n`;
  await writePlanFileAtomic(file, next);
  return readPlan(agentDir, planId);
}
