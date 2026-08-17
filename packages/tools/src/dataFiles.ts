import path from "node:path";

/** Assets whose raw bytes do not belong in the model context. */
export const DATA_FILE_EXTENSIONS = new Set([
  ".ppm",
  ".pgm",
  ".pbm",
  ".pnm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".wav",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".7z",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".o",
  ".a",
  ".npy",
  ".npz",
  ".h5",
  ".parquet",
  ".sqlite",
  ".db",
]);

const CODE_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".h",
  ".hh",
  ".hpp",
  ".cs",
  ".css",
  ".go",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".kts",
  ".md",
  ".mjs",
  ".cjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const PEEK_BYTES = 8_192;
const LARGE_FILE_BYTES = 256 * 1024;

export interface PpmHeader {
  magic: string;
  width: number;
  height: number;
  maxVal?: number;
}

export interface DataFileSummary {
  kind: "image" | "binary" | "data";
  extension: string;
  bytes: number;
  encoding: string;
  ppm?: PpmHeader;
  hint: string;
}

export function isDataFilePath(rel: string): boolean {
  return DATA_FILE_EXTENSIONS.has(path.extname(rel).toLowerCase());
}

export function looksLikeBinaryBuffer(sample: Buffer): boolean {
  const slice = sample.subarray(0, PEEK_BYTES);
  if (slice.includes(0)) return true;
  let weird = 0;
  const n = Math.min(slice.length, PEEK_BYTES);
  for (let i = 0; i < n; i++) {
    const b = slice[i]!;
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b > 126) weird += 1;
  }
  return n > 0 && weird / n > 0.3;
}

export function parsePpmHeader(sample: Buffer | string): PpmHeader | undefined {
  const text = typeof sample === "string" ? sample : sample.toString("latin1");
  const tokens: string[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (!line) continue;
    tokens.push(...line.split(/\s+/u));
    if (tokens.length >= 4) break;
  }
  const magic = tokens[0];
  if (!magic || !/^P[1-6]$/u.test(magic)) return undefined;
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { magic, width: 0, height: 0 };
  }
  const maxVal = magic === "P1" || magic === "P4" ? undefined : Number(tokens[3]);
  return {
    magic,
    width,
    height,
    maxVal: Number.isFinite(maxVal) ? maxVal : undefined,
  };
}

export function looksLikeDataDumpContent(content: string): boolean {
  if (content.length < 400) return false;
  if (content.includes("\0")) return true;
  if (parsePpmHeader(content.slice(0, 512))) return true;
  const sample = content.slice(0, 4_000);
  const numbers = sample.match(/\d+/g)?.length ?? 0;
  const lines = Math.max(sample.split("\n").length, 1);
  return numbers > 200 && sample.length / lines > 40;
}

export function classifyDataFile(rel: string, sample: Buffer, byteLength: number): DataFileSummary | undefined {
  const extension = path.extname(rel).toLowerCase();
  const ppm = parsePpmHeader(sample);
  const binary = looksLikeBinaryBuffer(sample);
  const dataPath = isDataFilePath(rel);
  const hugeNonCode = byteLength >= LARGE_FILE_BYTES && !CODE_FILE_EXTENSIONS.has(extension);
  if (!dataPath && !binary && !ppm && !hugeNonCode) return undefined;

  const kind = ppm || extension === ".ppm" || extension === ".png" || extension === ".jpg" || extension === ".jpeg"
    ? "image"
    : binary
      ? "binary"
      : "data";
  return {
    kind,
    extension: extension || "(none)",
    bytes: byteLength,
    encoding: binary ? "binary" : ppm ? `netpbm ${ppm.magic}` : "text-data",
    ppm,
    hint:
      "Do not page this file into context. Analyze it with a short run_shell command that prints compact stats (shape, dtype, unique colors, header), not the raw payload.",
  };
}

export function formatDataFileSummary(rel: string, summary: DataFileSummary): string {
  const lines = [
    `[data file] ${rel}: ${summary.bytes} bytes, ${summary.kind}, ${summary.encoding}, ext=${summary.extension}`,
  ];
  if (summary.ppm && summary.ppm.width > 0) {
    const max = summary.ppm.maxVal !== undefined ? `, maxval=${summary.ppm.maxVal}` : "";
    lines.push(`Netpbm ${summary.ppm.magic} ${summary.ppm.width}x${summary.ppm.height}${max}.`);
  }
  lines.push(summary.hint);
  return lines.join("\n");
}
