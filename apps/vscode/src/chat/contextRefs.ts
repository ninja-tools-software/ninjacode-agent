import fs from "node:fs/promises";
import path from "node:path";
import type { ContentPart } from "@ninjacode/providers";
import type { ComposerNode, ContextRef, RefKind } from "../protocol.js";
import { providerForRefKind, type ContextEnv } from "./context/index.js";

/** Total budget for all attached context blocks in one prompt. Past this, later
 * blocks are truncated (with a visible note) rather than silently dropped. */
const TOTAL_CONTEXT_BUDGET = 60_000;

/** Rough token estimate — same 4-chars-per-token heuristic the core uses. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Stable dedup key for a reference. Two badges pointing at the same target
 * (and range) resolve once and are sent once. */
export function makeRefId(kind: RefKind, target: string, range?: { start: number; end: number }): string {
  return range ? `${kind}:${target}#${range.start}-${range.end}` : `${kind}:${target}`;
}

export function createRef(init: {
  kind: RefKind;
  target: string;
  label: string;
  detail?: string;
  range?: { start: number; end: number };
  dataUrl?: string;
  mimeType?: string;
}): ContextRef {
  return {
    id: makeRefId(init.kind, init.target, init.range),
    kind: init.kind,
    label: init.label,
    detail: init.detail,
    target: init.target,
    range: init.range,
    dataUrl: init.dataUrl,
    mimeType: init.mimeType,
    status: "resolved",
  };
}

/** How a badge appears inside the prompt sentence, so the model can tie the
 * attached block back to the exact spot the user referenced it. */
export function refMention(ref: ContextRef): string {
  switch (ref.kind) {
    case "url":
      return ref.target;
    case "diagnostics":
      return `@${ref.target} (problems)`;
    case "scm_diff":
      return ref.label;
    case "image":
      return `[image: ${ref.label}]`;
    case "terminal":
      return `[terminal: ${ref.label}]`;
    case "selection":
    case "snippet":
      return `@${ref.label}`;
    default:
      return `@${ref.target}`;
  }
}

/** Drop duplicates, keeping the first occurrence's position. */
export function dedupeRefs(refs: readonly ContextRef[]): ContextRef[] {
  const seen = new Set<string>();
  const out: ContextRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

interface ResolvedRefs {
  /** One prompt block per unique reference, already budget-trimmed. */
  blocks: string[];
  /** Multimodal image parts, for models that support vision. */
  images: ContentPart[];
  /** Input refs with `tokens` filled in and `status` updated. */
  refs: ContextRef[];
}

/**
 * Expand references into prompt blocks and image parts. Self-contained refs
 * (selection snippets, images, terminal output) carry their own payload; the rest
 * are resolved through the context provider registry.
 */
export async function resolveRefs(
  refs: readonly ContextRef[],
  env: ContextEnv,
): Promise<ResolvedRefs> {
  const unique = dedupeRefs(refs);
  const blocks: string[] = [];
  const images: ContentPart[] = [];
  const resolved: ContextRef[] = [];
  let used = 0;

  for (const ref of unique) {
    if (ref.kind === "image") {
      const match = ref.dataUrl ? /^data:([^;]+);base64,(.+)$/.exec(ref.dataUrl) : null;
      if (match) images.push({ type: "image", mimeType: ref.mimeType || match[1]!, data: match[2]! });
      resolved.push({ ...ref, status: "resolved" });
      continue;
    }

    let text: string;
    let status: ContextRef["status"] = "resolved";
    let error: string | undefined;
    const provider = providerForRefKind(ref.kind);
    if (provider) {
      try {
        text = (await provider.resolve(ref.target, env)).text;
      } catch (e) {
        error = (e as Error).message;
        text = `[Could not resolve ${ref.kind} "${ref.target}": ${error}]`;
        status = "error";
      }
    } else {
      // Self-contained kinds (selection, snippet, terminal) were captured at insert time.
      text = ref.detail ?? "";
      if (!text) {
        status = "error";
        error = "no captured content";
        text = `[Missing content for ${ref.label}]`;
      }
    }

    const remaining = TOTAL_CONTEXT_BUDGET - used;
    if (remaining <= 0) {
      blocks.push(`### ${ref.label}\n[omitted — attached context budget exhausted]`);
      resolved.push({ ...ref, status, error, tokens: 0 });
      continue;
    }
    if (text.length > remaining) {
      text = `${text.slice(0, remaining)}\n[truncated — attached context budget reached]`;
    }
    used += text.length;
    blocks.push(`### ${ref.label}\n${text}`);
    resolved.push({ ...ref, status, error, tokens: estimateTokens(text) });
  }

  return { blocks, images, refs: resolved };
}

/** Plain-text rendering of a composer document, with badges as inline mentions. */
export function nodesToPromptText(nodes: readonly ComposerNode[]): string {
  return nodes
    .map((node) => (node.kind === "text" ? node.text : refMention(node.ref)))
    .join("")
    .trim();
}

/**
 * Legacy fallback: `@path` typed by hand (no badge) still pulls the file in.
 * Anything already attached as a badge is skipped so it isn't sent twice.
 */
export async function expandBareMentions(
  text: string,
  env: ContextEnv,
  alreadyAttached: ReadonlySet<string>,
): Promise<string[]> {
  const re = /@([\w./-]+)/g;
  const blocks: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const rel = match[1]!;
    if (seen.has(rel) || alreadyAttached.has(rel)) continue;
    seen.add(rel);
    try {
      const content = await fs.readFile(path.join(env.root, rel), "utf8");
      blocks.push(`### @${rel}\n\`\`\`\n${content.slice(0, 8_000)}\n\`\`\``);
    } catch {
      // Not a real file — leave the text as the user typed it.
    }
  }
  return blocks;
}

/** Separator between the user's sentence and the blocks we attach to it. */
const ATTACHED_CONTEXT_HEADER = "---\nAttached context:";

/**
 * The sentence the user actually typed, without the attached blocks. Persisted
 * history only keeps the assembled prompt, so re-opening a session would
 * otherwise replay whole files inside the chat bubble.
 */
export function stripAttachedContext(text: string): string {
  const index = text.indexOf(`\n\n${ATTACHED_CONTEXT_HEADER}`);
  return index === -1 ? text : text.slice(0, index).trimEnd();
}

interface BuiltTask {
  /** Final prompt text handed to the agent. */
  text: string;
  /** The user's sentence alone (badges as inline mentions), for the chat bubble. */
  body: string;
  images: ContentPart[];
  /** Refs with resolution status and token counts, echoed back to the webview. */
  refs: ContextRef[];
}

/**
 * Assemble the prompt: the user's sentence keeps its inline mentions, and every
 * attached reference is appended once as its own block.
 */
export async function buildTask(
  input: { text: string; nodes?: readonly ComposerNode[]; refs?: readonly ContextRef[] },
  env: ContextEnv,
  extraSections: readonly string[] = [],
): Promise<BuiltTask> {
  const body = input.nodes?.length ? nodesToPromptText(input.nodes) : input.text.trim();
  const { blocks, images, refs } = await resolveRefs(input.refs ?? [], env);

  const attachedTargets = new Set(refs.map((r) => r.target));
  const bareBlocks = await expandBareMentions(body, env, attachedTargets);

  const contextBlocks = [...blocks, ...bareBlocks];
  const sections = [body];
  if (contextBlocks.length > 0) {
    sections.push(`${ATTACHED_CONTEXT_HEADER}\n\n${contextBlocks.join("\n\n")}`);
  }
  sections.push(...extraSections.filter(Boolean));

  return { text: sections.filter(Boolean).join("\n\n"), body, images, refs };
}

/** Shown on image badges, and in the prompt, when the model is text-only. */
const NO_VISION_ERROR = "The selected model has no vision support";

/** Mark image badges the current model cannot read, so the composer says so before sending. */
export function flagUnsupportedImages(refs: readonly ContextRef[], vision: boolean): ContextRef[] {
  if (vision) return [...refs];
  return refs.map((r) =>
    r.kind === "image" ? { ...r, status: "error" as const, error: NO_VISION_ERROR, tokens: 0 } : r,
  );
}

/**
 * Text-only models reject image parts, so a dropped screenshot would fail the
 * whole run. Degrade instead: keep the sentence, tell the model an image was
 * left out, and surface the reason on the badge.
 */
export function withoutImages(task: BuiltTask): BuiltTask {
  if (task.images.length === 0) return task;

  const dropped = task.refs.filter((r) => r.kind === "image");
  const note = dropped
    .map((r) => `### ${r.label}\n[image omitted — ${NO_VISION_ERROR.toLowerCase()}]`)
    .join("\n\n");
  const text = note
    ? task.text.includes(ATTACHED_CONTEXT_HEADER)
      ? `${task.text}\n\n${note}`
      : `${task.text}\n\n${ATTACHED_CONTEXT_HEADER}\n\n${note}`
    : task.text;

  return {
    ...task,
    text,
    images: [],
    refs: flagUnsupportedImages(task.refs, false),
  };
}
