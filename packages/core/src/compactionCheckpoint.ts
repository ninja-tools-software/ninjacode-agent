import type { Message } from "@ninjacode/providers";

const SECTION_ALIASES = {
  objective: ["Objective", "Task"],
  constraints: ["Constraints"],
  decisions: ["Decisions"],
  files: ["Files", "Files touched"],
  tests: ["Tests", "Validation"],
  errors: ["Errors"],
  nextAction: ["Next action", "Open work"],
  recovery: ["Recovery", "Archives"],
} as const;

const LIST_LIMIT = 8;
const ITEM_LIMIT = 320;
const ARTIFACT_ID = /\b[a-f0-9]{64}\b/g;
const PATH_LIKE = /(?:^|\s)([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9_-]+)/g;

export const CHECKPOINT_INSTRUCTIONS = [
  "You create a durable checkpoint for a coding-agent session.",
  "Output exactly these sections, in this order, with these headings and nothing else:",
  "## Objective",
  "## Constraints",
  "## Decisions",
  "## Files",
  "## Tests",
  "## Errors",
  "## Next action",
  "## Recovery",
  "Use concise bullet points except for Objective and Next action.",
  "Keep paths, symbols, commands, error strings, artifact IDs, and history references exact.",
  "Write None when a section has no known fact. Do not invent recovery references.",
].join("\n");

export interface CompactionRecoveryReferences {
  history?: string;
  artifacts?: readonly string[];
}

interface CompactionCheckpoint {
  objective?: string;
  constraints: string[];
  decisions: string[];
  files: string[];
  tests: string[];
  errors: string[];
  nextAction?: string;
  recovery: string[];
}

export function buildStructuredCheckpoint(opts: {
  messages: Message[];
  summary?: string;
  pinnedTask?: string;
  references?: CompactionRecoveryReferences;
}): string {
  const previous = opts.messages
    .filter((message) => message.content.startsWith("[Compacted earlier conversation]"))
    .map((message) => parseCheckpoint(message.content) ?? legacyCheckpoint(message.content));
  const fresh = parseCheckpoint(opts.summary ?? "") ?? heuristicCheckpoint(opts.messages);
  const merged = mergeCheckpoints([...previous, fresh], opts.pinnedTask);
  merged.recovery = bounded([
    ...merged.recovery,
    ...(opts.references?.history ? [`History: ${opts.references.history}`] : []),
    ...(opts.references?.artifacts ?? []).map((id) => `Artifact: ${id}`),
    ...artifactReferences(opts.messages),
  ]);
  return renderCheckpoint(merged);
}

function emptyCheckpoint(): CompactionCheckpoint {
  return {
    constraints: [],
    decisions: [],
    files: [],
    tests: [],
    errors: [],
    recovery: [],
  };
}

function legacyCheckpoint(content: string): CompactionCheckpoint {
  const checkpoint = emptyCheckpoint();
  const detail = content.replace("[Compacted earlier conversation]", "").trim();
  checkpoint.decisions = detail ? bounded([detail]) : [];
  return checkpoint;
}

function parseCheckpoint(text: string): CompactionCheckpoint | null {
  const headings = headingMatches(text);
  if (headings.length === 0) return null;
  const checkpoint = emptyCheckpoint();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const body = text.slice(heading.end, headings[index + 1]?.start ?? text.length);
    const key = sectionKey(heading.name);
    if (!key) continue;
    const values = sectionValues(body);
    if (key === "objective" || key === "nextAction") {
      checkpoint[key] = values.join(" ").trim() || undefined;
    } else {
      checkpoint[key] = bounded(values);
    }
  }
  return checkpoint;
}

function headingMatches(text: string): Array<{ name: string; start: number; end: number }> {
  const matches: Array<{ name: string; start: number; end: number }> = [];
  const pattern = /^##\s+(.+?)\s*$/gm;
  for (const match of text.matchAll(pattern)) {
    matches.push({
      name: match[1] ?? "",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function sectionKey(name: string): keyof CompactionCheckpoint | undefined {
  const normalized = name.trim().toLowerCase();
  return (Object.entries(SECTION_ALIASES) as Array<
    [keyof CompactionCheckpoint, readonly string[]]
  >).find(([, aliases]) => aliases.some((alias) => alias.toLowerCase() === normalized))?.[0];
}

function sectionValues(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length > 0 && line.toLowerCase() !== "none");
}

function heuristicCheckpoint(messages: Message[]): CompactionCheckpoint {
  const checkpoint = emptyCheckpoint();
  const content = messages.filter((message) => !message.content.startsWith("[Compacted")).map((m) => m.content);
  checkpoint.objective = content.at(0)?.slice(0, ITEM_LIMIT);
  checkpoint.nextAction = content.at(-1)?.slice(0, ITEM_LIMIT);
  checkpoint.constraints = matchingLines(content, /\b(must|never|required?|constraint|do not|without)\b/i);
  checkpoint.errors = matchingLines(content, /\b(error|failed|failure|exception|cannot)\b/i);
  checkpoint.files = bounded(
    content.flatMap((value) => [...value.matchAll(PATH_LIKE)].map((match) => match[1] ?? "")),
  );
  checkpoint.tests = messages
    .filter((message) => message.role === "tool" && /test|lint|typecheck|shell/i.test(message.name ?? ""))
    .map((message) => `${message.name ?? "tool"}: ${message.content}`);
  checkpoint.decisions = messages
    .filter((message) => message.role === "assistant" && message.content.trim())
    .map((message) => message.content);
  return mapBounded(checkpoint);
}

function matchingLines(contents: string[], pattern: RegExp): string[] {
  return bounded(
    contents.flatMap((content) =>
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => pattern.test(line)),
    ),
  );
}

function mergeCheckpoints(
  checkpoints: CompactionCheckpoint[],
  pinnedTask?: string,
): CompactionCheckpoint {
  const merged = emptyCheckpoint();
  const latestObjective = [...checkpoints].reverse().find((item) => item.objective)?.objective;
  const objective = pinnedTask?.trim() || latestObjective;
  merged.objective = objective?.slice(0, 1_000);
  merged.nextAction = [...checkpoints]
    .reverse()
    .find((item) => item.nextAction)
    ?.nextAction?.slice(0, 1_000);
  for (const key of ["constraints", "decisions", "files", "tests", "errors", "recovery"] as const) {
    merged[key] = bounded(checkpoints.flatMap((checkpoint) => checkpoint[key]));
  }
  return merged;
}

function mapBounded(checkpoint: CompactionCheckpoint): CompactionCheckpoint {
  for (const key of ["constraints", "decisions", "files", "tests", "errors", "recovery"] as const) {
    checkpoint[key] = bounded(checkpoint[key]);
  }
  return checkpoint;
}

function artifactReferences(messages: Message[]): string[] {
  const ids = messages.flatMap((message) => message.content.match(ARTIFACT_ID) ?? []);
  return ids.map((id) => `Artifact: ${id}`);
}

function bounded(values: readonly string[]): string[] {
  const unique = values
    .map((value) => value.trim().slice(0, ITEM_LIMIT))
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  if (unique.length <= LIST_LIMIT) return unique;
  return [...unique.slice(0, 3), ...unique.slice(-(LIST_LIMIT - 3))];
}

function renderCheckpoint(checkpoint: CompactionCheckpoint): string {
  return [
    "## Objective",
    checkpoint.objective || "None",
    "## Constraints",
    bullets(checkpoint.constraints),
    "## Decisions",
    bullets(checkpoint.decisions),
    "## Files",
    bullets(checkpoint.files),
    "## Tests",
    bullets(checkpoint.tests),
    "## Errors",
    bullets(checkpoint.errors),
    "## Next action",
    checkpoint.nextAction || "None",
    "## Recovery",
    bullets(checkpoint.recovery),
  ].join("\n");
}

function bullets(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "None";
}
