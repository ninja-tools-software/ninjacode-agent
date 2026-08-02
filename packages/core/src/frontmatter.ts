/**
 * Minimal YAML-frontmatter parser shared by rules/prompts/agents/skills loaders.
 * Supports the small subset of YAML actually used in these files: scalars,
 * quoted strings, booleans, numbers, inline arrays (`[a, b]`), and block
 * arrays (`- item` on following indented lines). No nested maps/anchors.
 */
interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = /^---\s*\r?\n/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const text = raw.replace(/^\uFEFF/, "");
  if (!FENCE.test(text)) return { data: {}, body: text };

  const withoutOpening = text.replace(FENCE, "");
  const closeMatch = withoutOpening.match(/\r?\n---\s*\r?\n?/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { data: {}, body: text };
  }

  const yamlBlock = withoutOpening.slice(0, closeMatch.index);
  const body = withoutOpening.slice(closeMatch.index + closeMatch[0].length);
  return { data: parseYamlBlock(yamlBlock), body };
}

/**
 * The verbatim frontmatter block of `raw` (fences included), or "" when there is
 * none. Lets a writer replace only the body of a file whose metadata uses YAML
 * features this module cannot represent.
 */
export function frontmatterBlock(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (!FENCE.test(text)) return "";
  const opening = text.match(FENCE)![0];
  const withoutOpening = text.slice(opening.length);
  const closeMatch = withoutOpening.match(/\r?\n---\s*\r?\n?/);
  if (!closeMatch || closeMatch.index === undefined) return "";
  return opening + withoutOpening.slice(0, closeMatch.index + closeMatch[0].length);
}

/**
 * Serialize frontmatter + body back into the exact YAML subset
 * `parseFrontmatter` understands, so anything written by the settings UI
 * round-trips through the parser. Keys whose value is `undefined`, `null` or an
 * empty string/array are omitted.
 */
function serializeArrayField(key: string, value: unknown[], lines: string[]): void {
  const items = value.map((v) => String(v).trim()).filter(Boolean);
  if (!items.length) return;
  if (items.some((i) => /[,[\]]/.test(i))) {
    lines.push(`${key}:`);
    for (const item of items) lines.push(`  - ${quoteScalar(item)}`);
    return;
  }
  lines.push(`${key}: [${items.map(quoteScalar).join(", ")}]`);
}

export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      serializeArrayField(key, value, lines);
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${value}`);
      continue;
    }
    lines.push(`${key}: ${quoteScalar(collapseWhitespace(String(value)))}`);
  }

  const trimmedBody = body.trim();
  if (!lines.length) return trimmedBody ? `${trimmedBody}\n` : "";
  return `---\n${lines.join("\n")}\n---\n\n${trimmedBody}\n`;
}

/** The parser has no multi-line scalar support, so fold them onto one line. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").trim();
}

function quoteScalar(value: string): string {
  const needsQuotes =
    value === "" ||
    value !== value.trim() ||
    value === "true" ||
    value === "false" ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    value.startsWith("[") ||
    value.startsWith("#");
  return needsQuotes ? `"${value}"` : value;
}

function parseYamlBlock(block: string): Record<string, unknown> {
  const lines = block.split(/\r?\n/);
  const data: Record<string, unknown> = {};
  let pendingKey: string | null = null;
  let pendingList: string[] | null = null;

  const flushPending = () => {
    if (pendingKey && pendingList) {
      data[pendingKey] = pendingList;
    }
    pendingKey = null;
    pendingList = null;
  };

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;

    const listItem = rawLine.match(/^\s+-\s*(.*)$/);
    if (listItem && pendingKey) {
      pendingList ??= [];
      pendingList.push(unquote(listItem[1]!.trim()));
      continue;
    }

    flushPending();

    const kv = rawLine.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!.trim();

    if (rest === "" || rest === "|" || rest === ">") {
      // Possibly a block array/scalar starts on following lines.
      pendingKey = key;
      pendingList = null;
      continue;
    }

    data[key] = parseScalarOrInline(rest);
  }
  flushPending();
  return data;
}

function parseScalarOrInline(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((v) => unquote(v.trim()));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return unquote(value);
}

function unquote(value: string): string {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Coerce a frontmatter value that may be a comma-separated string or an array into a string array. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

export function toOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
