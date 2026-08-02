import type { Message } from "@ninjacode/providers";

export interface ReadRangeSpec {
  path: string;
  full: boolean;
  start: number;
  end: number | null;
}

interface ListDirSpec {
  path: string;
  recursive: boolean;
}

const PATH_HEADER = /^\[path:([^\]]+)\]\n/;

/** Build a read-range spec from the range the tool actually served. */
export function readRangeFromMeta(
  path: string,
  meta?: Record<string, unknown>,
): ReadRangeSpec {
  const start = typeof meta?.startLine === "number" ? meta.startLine : null;
  const end = typeof meta?.endLine === "number" ? meta.endLine : null;
  const total = typeof meta?.totalLines === "number" ? meta.totalLines : null;
  if (start === null || end === null) {
    // Incomplete meta must not claim full-file coverage.
    return { path, full: false, start: 1, end: 0 };
  }
  const full =
    total !== null &&
    ((total === 0 && end === 0) || (start === 1 && end === total && end >= start));
  return { path, full, start: Math.max(1, start), end };
}

export function readRangeCovers(later: ReadRangeSpec, earlier: ReadRangeSpec): boolean {
  if (later.path !== earlier.path) return false;
  if (later.full) return true;
  if (earlier.full) return false;
  const laterEnd = later.end ?? Number.POSITIVE_INFINITY;
  const earlierEnd = earlier.end ?? Number.POSITIVE_INFINITY;
  return later.start <= earlier.start && laterEnd >= earlierEnd;
}

/** True when the union of later ranges covers earlier (complementary pages count). */
export function readRangesCover(laterRanges: ReadRangeSpec[], earlier: ReadRangeSpec): boolean {
  const samePath = laterRanges.filter((r) => r.path === earlier.path);
  if (samePath.length === 0) return false;
  if (samePath.some((r) => r.full)) return true;
  if (earlier.full) return false;

  const intervals = samePath
    .map((r) => ({ start: r.start, end: r.end ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end + 1) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }

  const earlierEnd = earlier.end ?? Number.POSITIVE_INFINITY;
  return merged.some((m) => m.start <= earlier.start && m.end >= earlierEnd);
}

export function listDirCovers(later: ListDirSpec, earlier: ListDirSpec): boolean {
  if (later.path !== earlier.path) return false;
  if (later.recursive) return true;
  return !earlier.recursive;
}

function formatReadHeader(pathRel: string, range: ReadRangeSpec): string {
  if (range.full) return pathRel;
  if (range.end === null) return `${pathRel}#L${range.start}-`;
  if (range.end < range.start) return `${pathRel}#L0-0`;
  return `${pathRel}#L${range.start}-${range.end}`;
}

function formatListDirHeader(pathRel: string, recursive: boolean): string {
  return recursive ? `${pathRel} recursive` : pathRel;
}

export function annotateReadFile(
  pathRel: string,
  output: string,
  meta?: Record<string, unknown>,
): string {
  const range = readRangeFromMeta(pathRel, meta);
  return `[path:${formatReadHeader(pathRel, range)}]\n${output}`;
}

export function annotateListDir(pathRel: string, output: string, recursive: boolean): string {
  return `[path:${formatListDirHeader(pathRel, recursive)}]\n${output}`;
}

function parseReadHeader(raw: string): ReadRangeSpec {
  const lineMatch = raw.match(/^(.+)#L(\d+)(?:-(\d+))?$/);
  if (!lineMatch) return { path: raw, full: true, start: 1, end: null };
  return {
    path: lineMatch[1]!,
    full: false,
    start: Number(lineMatch[2]),
    end: lineMatch[3] ? Number(lineMatch[3]) : null,
  };
}

function parseListDirHeader(raw: string): ListDirSpec {
  const suffix = " recursive";
  if (raw.endsWith(suffix)) {
    return { path: raw.slice(0, -suffix.length), recursive: true };
  }
  return { path: raw, recursive: false };
}

function parseReadAnnotation(message: Message): ReadRangeSpec | null {
  if (message.role !== "tool" || message.name !== "read_file") return null;
  const match = message.content.match(PATH_HEADER);
  if (!match?.[1]) return null;
  return parseReadHeader(match[1]);
}

function parseListDirAnnotation(message: Message): ListDirSpec | null {
  if (message.role !== "tool" || message.name !== "list_dir") return null;
  const match = message.content.match(PATH_HEADER);
  if (!match?.[1]) return null;
  return parseListDirHeader(match[1]);
}

function supersededReadContent(path: string): string {
  return `[superseded] Earlier read_file of ${path} — see later result.`;
}

function supersededListDirContent(path: string): string {
  return `[superseded] Earlier list_dir of ${path} — see later result.`;
}

/**
 * Soft-dedupe superseded reads/listings by coverage, not path alone.
 * Complementary later ranges that together cover an earlier range also supersede it.
 */
export function softenSupersededReads(history: Message[]): Message[] {
  const reads: Array<{ index: number; spec: ReadRangeSpec }> = [];
  const listings: Array<{ index: number; spec: ListDirSpec }> = [];

  history.forEach((m, index) => {
    const read = parseReadAnnotation(m);
    if (read) reads.push({ index, spec: read });
    const listing = parseListDirAnnotation(m);
    if (listing) listings.push({ index, spec: listing });
  });

  return history.map((m, index) => {
    if (m.role !== "tool") return m;

    if (m.name === "read_file") {
      const spec = parseReadAnnotation(m);
      if (!spec) return m;
      const laterSpecs = reads.filter((later) => later.index > index).map((later) => later.spec);
      return readRangesCover(laterSpecs, spec)
        ? { ...m, content: supersededReadContent(spec.path) }
        : m;
    }

    if (m.name === "list_dir") {
      const spec = parseListDirAnnotation(m);
      if (!spec) return m;
      const covered = listings.some(
        (later) => later.index > index && listDirCovers(later.spec, spec),
      );
      return covered ? { ...m, content: supersededListDirContent(spec.path) } : m;
    }

    return m;
  });
}
