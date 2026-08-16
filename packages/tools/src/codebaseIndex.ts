import fs from "node:fs/promises";
import path from "node:path";
// Static import so esbuild bundles `ignore` into the VS Code extension.
// (Dynamic createRequire from process.cwd() breaks VSIX / Extension Host loads.)
import ignorePkg from "ignore";
import type { CodebaseSearchHit } from "./types.js";
import { isSkippedDir } from "./ignore.js";

interface GitignoreLib {
  add(patterns: string | string[]): GitignoreLib;
  ignores(pathname: string): boolean;
}

const ignoreFactory = ignorePkg as unknown as (options?: {
  ignorecase?: boolean;
}) => GitignoreLib;


/** Extensions we bother reading content/symbols for. Everything else is
 * tracked as metadata-only (path/size/mtime) so binary assets don't bloat
 * the lexical index. */
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".c", ".h", ".cc", ".cpp", ".hpp",
  ".cs", ".php", ".swift", ".scala", ".sh", ".bash", ".zsh",
  ".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".html", ".css", ".scss", ".less", ".vue", ".svelte",
  ".sql", ".graphql", ".proto",
]);

const MAX_FILE_BYTES = 512 * 1024;

export interface SymbolEntry {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "method" | "struct" | "enum";
  line: number;
}

export interface IndexedFile {
  path: string;
  size: number;
  mtimeMs: number;
  symbols: SymbolEntry[];
  /** Term -> occurrence count within this file (built for text files only). */
  termFreq: Map<string, number>;
  totalTerms: number;
  /** Small cached excerpt used for search snippets. */
  firstLines: string;
  /** Search documents split on symbol boundaries. */
  chunks: IndexedChunk[];
}

export interface IndexedChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string;
  text: string;
  termFreq: Map<string, number>;
  totalTerms: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface CodebaseIndexOptions {
  /** Extra ignore glob-ish directory/file names, merged with the defaults. */
  extraIgnoreDirs?: string[];
  /** Cap on number of files scanned during a full build. */
  maxFiles?: number;
  /** Optional embeddings backend for `semanticSearch`. No-op / stub by default —
   * NinjaCode never requires an external embeddings service to function. */
  embeddingProvider?: EmbeddingProvider;
  /** Override the local JSON cache path. Defaults under .ninjacode/index. */
  cachePath?: string;
  /** Disable local persistence (primarily for ephemeral/test hosts). */
  persist?: boolean;
  /** Minimum delay between metadata rescans after the lazy first build. */
  rescanIntervalMs?: number;
}

async function loadGitignore(workspaceRoot: string): Promise<GitignoreLib | null> {
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    const ig = ignoreFactory();
    ig.add(raw.split("\n"));
    return ig;
  } catch {
    return null;
  }
}

function tokenize(text: string): string[] {
  return text
    .split(/[^a-z0-9_]+/i)
    .flatMap((word) => {
      // Split camelCase / snake_case / kebab-case into sub-tokens too, so
      // searching "codebase index" matches `CodebaseIndex`.
      const subParts = word
        .replace(/_/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const whole = word.toLowerCase();
      return subParts.length > 1 ? [whole, ...subParts] : [whole];
    })
    .filter((t) => t.length >= 2);
}

function buildTermFreq(tokens: string[]): { termFreq: Map<string, number>; totalTerms: number } {
  const termFreq = new Map<string, number>();
  for (const t of tokens) {
    termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
  }
  return { termFreq, totalTerms: tokens.length };
}

function computeDocumentFrequencies(
  terms: string[],
  documents: Iterable<{ termFreq: Map<string, number> }>,
): Map<string, number> {
  const df = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const document of documents) {
      if (document.termFreq.has(term)) count++;
    }
    df.set(term, count);
  }
  return df;
}

function scoreIndexedChunk(opts: {
  chunk: IndexedChunk;
  terms: string[];
  df: Map<string, number>;
  stats: { N: number; avgLen: number; k1: number; b: number };
  queryLower: string;
}): CodebaseSearchHit | null {
  const { chunk, terms, df, stats, queryLower } = opts;
  let score = 0;
  for (const term of terms) {
    const tf = chunk.termFreq.get(term) ?? 0;
    if (tf <= 0) continue;
    const docFreq = df.get(term) ?? 0;
    const idf = Math.log(1 + (stats.N - docFreq + 0.5) / (docFreq + 0.5));
    const denom = tf + stats.k1 * (1 - stats.b + stats.b * (chunk.totalTerms / stats.avgLen));
    score += idf * ((tf * (stats.k1 + 1)) / Math.max(denom, 1e-6));
  }
  if (chunk.path.toLowerCase().includes(queryLower)) score += 3;
  const symbolMatch =
    chunk.symbol && terms.some((term) => chunk.symbol!.toLowerCase().includes(term));
  if (symbolMatch) score += 5;
  if (score <= 0) return null;
  return {
    path: chunk.path,
    score,
    snippet: chunk.text.slice(0, 600) || undefined,
    symbols: symbolMatch && chunk.symbol ? [chunk.symbol] : undefined,
    symbol: chunk.symbol,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
  };
}

const SYMBOL_PATTERNS: Array<{ re: RegExp; kind: SymbolEntry["kind"] }> = [
  { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)/, kind: "type" },
  { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "const" },
  { re: /^\s*def\s+([A-Za-z_][\w]*)\s*\(/, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_][\w]*)/, kind: "class" },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/, kind: "function" },
  { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_][\w]*)\s*[(<]/, kind: "function" },
  { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/, kind: "struct" },
  { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/, kind: "enum" },
  { re: /^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>[\]]+\s+([A-Za-z_][\w]*)\s*\([^;]*\)\s*\{/, kind: "method" },
];

function extractSymbols(content: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && symbols.length < 500; i++) {
    const line = lines[i]!;
    for (const { re, kind } of SYMBOL_PATTERNS) {
      const m = re.exec(line);
      if (m?.[1]) {
        symbols.push({ name: m[1], kind, line: i + 1 });
        break;
      }
    }
  }
  return symbols;
}

const MAX_CHUNK_LINES = 160;
const INDEX_SCHEMA_VERSION = 2;

function chunkId(relPath: string, startLine: number, symbol?: string): string {
  return `${relPath}:${startLine}:${symbol ?? "<file>"}`;
}

function buildChunks(relPath: string, content: string, symbols: SymbolEntry[]): IndexedChunk[] {
  const lines = content.split("\n");
  const starts = new Map<number, string | undefined>();
  starts.set(1, symbols.find((symbol) => symbol.line === 1)?.name);
  for (const symbol of symbols) starts.set(symbol.line, symbol.name);
  const boundaries = [...starts.keys()].sort((a, b) => a - b);
  const chunks: IndexedChunk[] = [];

  for (let boundaryIndex = 0; boundaryIndex < boundaries.length; boundaryIndex++) {
    const boundaryStart = boundaries[boundaryIndex]!;
    const boundaryEnd = (boundaries[boundaryIndex + 1] ?? lines.length + 1) - 1;
    for (let start = boundaryStart; start <= boundaryEnd; start += MAX_CHUNK_LINES) {
      const end = Math.min(boundaryEnd, start + MAX_CHUNK_LINES - 1);
      const symbol = starts.get(boundaryStart);
      const text = lines.slice(start - 1, end).join("\n");
      const freq = buildTermFreq(tokenize(`${relPath}\n${symbol ?? ""}\n${text}`));
      chunks.push({
        id: chunkId(relPath, start, symbol),
        path: relPath,
        startLine: start,
        endLine: end,
        symbol,
        text,
        termFreq: freq.termFreq,
        totalTerms: freq.totalTerms,
      });
    }
  }
  return chunks;
}

interface SerializedChunk extends Omit<IndexedChunk, "termFreq"> {
  termFreq: Array<[string, number]>;
}

interface SerializedFile extends Omit<IndexedFile, "termFreq" | "chunks"> {
  termFreq: Array<[string, number]>;
  chunks: SerializedChunk[];
}

interface PersistedIndex {
  schemaVersion: typeof INDEX_SCHEMA_VERSION;
  root: string;
  embeddingProvider?: string;
  files: SerializedFile[];
  embeddings?: Array<[string, number[]]>;
}

/**
 * Incremental local codebase index: lexical (BM25-ish) search over file
 * contents plus lightweight heuristic symbol extraction, with an optional
 * pluggable semantic layer. Nothing here calls out to a network service
 * unless the caller supplies an `EmbeddingProvider`.
 */
export class CodebaseIndex {
  private readonly files = new Map<string, IndexedFile>();
  private readonly embeddings = new Map<string, number[]>();
  private gitignore: GitignoreLib | null = null;
  private built = false;
  private buildPromise: Promise<void> | undefined;
  private lastScanAt = 0;
  private persistencePending: Promise<void> = Promise.resolve();

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: CodebaseIndexOptions = {},
  ) {}

  get isBuilt(): boolean {
    return this.built;
  }

  private get cachePath(): string {
    return (
      this.options.cachePath ??
      path.join(this.workspaceRoot, ".ninjacode", "index", "codebase-index-v2.json")
    );
  }

  stats(): { files: number; symbols: number; totalTerms: number } {
    let symbols = 0;
    let totalTerms = 0;
    for (const f of this.files.values()) {
      symbols += f.symbols.length;
      totalTerms += f.totalTerms;
    }
    return { files: this.files.size, symbols, totalTerms };
  }

  private isIgnoredDir(name: string): boolean {
    if (isSkippedDir(name)) return true;
    if (this.options.extraIgnoreDirs?.includes(name)) return true;
    return false;
  }

  private isIgnoredByGit(relPath: string): boolean {
    return this.gitignore?.ignores(relPath) ?? false;
  }

  private isOwnCache(relPath: string): boolean {
    return path.resolve(this.workspaceRoot, relPath) === path.resolve(this.cachePath);
  }

  /** Returns true when the entry was handled (directory enqueued or skipped). */
  private handleDirectoryEntry(
    entry: { name: string; isDirectory(): boolean },
    relPath: string,
    queue: string[],
  ): boolean {
    if (!entry.isDirectory()) return false;
    if (this.isIgnoredDir(entry.name)) return true;
    if (this.isIgnoredByGit(`${relPath}/`)) return true;
    queue.push(relPath);
    return true;
  }

  /** Lazily initialize and periodically invalidate entries by size/mtime. */
  async ensureReady(): Promise<void> {
    if (!this.built) {
      await this.build();
      return;
    }
    const interval = this.options.rescanIntervalMs ?? 1_000;
    if (Date.now() - this.lastScanAt >= interval) await this.build();
  }

  /** Incremental workspace scan, reusing the persistent cache when metadata matches. */
  async build(): Promise<void> {
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.buildIncrementally();
    try {
      await this.buildPromise;
    } finally {
      this.buildPromise = undefined;
    }
  }

  private async buildIncrementally(): Promise<void> {
    this.gitignore = await loadGitignore(this.workspaceRoot);
    if (this.files.size === 0) await this.loadPersisted();
    const max = this.options.maxFiles ?? 20_000;
    const queue: string[] = [""];
    const seen = new Set<string>();
    let scanned = 0;

    while (queue.length > 0 && scanned < max) {
      const relDir = queue.shift()!;
      const absDir = path.join(this.workspaceRoot, relDir);
      let entries;
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (scanned >= max) break;
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (this.handleDirectoryEntry(entry, relPath, queue)) continue;
        if (!entry.isFile()) continue;
        if (this.isOwnCache(relPath)) continue;
        if (this.isIgnoredByGit(relPath)) continue;
        seen.add(relPath);
        await this.indexFile(relPath);
        scanned++;
      }
    }
    for (const relPath of this.files.keys()) {
      if (!seen.has(relPath)) this.removeFileInternal(relPath);
    }
    this.built = true;
    this.lastScanAt = Date.now();
    await this.persist();
  }

  /** Re-index a single file after a create/change event. No-ops silently on read failure. */
  async refreshFile(relPath: string): Promise<void> {
    const normalized = relPath.replace(/\\/g, "/");
    if (!this.gitignore) this.gitignore = await loadGitignore(this.workspaceRoot);
    if (this.isIgnoredByGit(normalized)) {
      this.removeFileInternal(normalized);
      await this.persist();
      return;
    }
    for (const part of normalized.split("/")) {
      if (this.isIgnoredDir(part)) {
        this.removeFileInternal(normalized);
        await this.persist();
        return;
      }
    }
    await this.indexFile(normalized);
    this.built = true;
    await this.persist();
  }

  /** Drop a file from the index after a delete event. */
  async removeFile(relPath: string): Promise<void> {
    this.removeFileInternal(relPath.replace(/\\/g, "/"));
    await this.persist();
  }

  private removeFileInternal(relPath: string): void {
    const previous = this.files.get(relPath);
    this.files.delete(relPath);
    for (const chunk of previous?.chunks ?? []) this.embeddings.delete(chunk.id);
  }

  private async indexFile(relPath: string): Promise<void> {
    const abs = path.join(this.workspaceRoot, relPath);
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      this.files.delete(relPath);
      return;
    }
    if (!st.isFile()) return;
    const previous = this.files.get(relPath);
    if (previous && previous.size === st.size && previous.mtimeMs === st.mtimeMs) return;

    const ext = path.extname(relPath).toLowerCase();
    const isText = TEXT_EXTENSIONS.has(ext);
    const entry: IndexedFile = {
      path: relPath,
      size: st.size,
      mtimeMs: st.mtimeMs,
      symbols: [],
      termFreq: new Map(),
      totalTerms: 0,
      firstLines: "",
      chunks: [],
    };

    if (isText && st.size <= MAX_FILE_BYTES) {
      try {
        const content = await fs.readFile(abs, "utf8");
        if (!content.includes("\0")) {
          entry.symbols = extractSymbols(content);
          entry.firstLines = content.split("\n").slice(0, 6).join("\n").slice(0, 400);
          entry.chunks = buildChunks(relPath, content, entry.symbols);
          const tokens = tokenize(`${relPath}\n${content}`);
          const freq = buildTermFreq(tokens);
          entry.termFreq = freq.termFreq;
          entry.totalTerms = freq.totalTerms;
        }
      } catch {
        // unreadable — keep metadata-only entry
      }
    }

    for (const chunk of previous?.chunks ?? []) this.embeddings.delete(chunk.id);
    this.files.set(relPath, entry);
  }

  private async loadPersisted(): Promise<void> {
    if (this.options.persist === false) return;
    try {
      const raw = JSON.parse(await fs.readFile(this.cachePath, "utf8")) as PersistedIndex;
      if (raw.schemaVersion !== INDEX_SCHEMA_VERSION || raw.root !== path.resolve(this.workspaceRoot)) {
        return;
      }
      for (const file of raw.files) {
        this.files.set(file.path, {
          ...file,
          termFreq: new Map(file.termFreq),
          chunks: file.chunks.map((chunk) => ({
            ...chunk,
            termFreq: new Map(chunk.termFreq),
          })),
        });
      }
      if (
        raw.embeddingProvider &&
        raw.embeddingProvider === this.options.embeddingProvider?.name
      ) {
        for (const [id, vector] of raw.embeddings ?? []) this.embeddings.set(id, vector);
      }
    } catch {
      // Missing, stale, or interrupted caches are rebuilt from source.
    }
  }

  private persist(): Promise<void> {
    if (this.options.persist === false) return Promise.resolve();
    const operation = this.persistencePending.then(async () => {
      const serialized: PersistedIndex = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        root: path.resolve(this.workspaceRoot),
        embeddingProvider: this.options.embeddingProvider?.name,
        files: [...this.files.values()].map((file) => ({
          ...file,
          termFreq: [...file.termFreq],
          chunks: file.chunks.map((chunk) => ({
            ...chunk,
            termFreq: [...chunk.termFreq],
          })),
        })),
        embeddings: this.options.embeddingProvider ? [...this.embeddings] : undefined,
      };
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      const temporary = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(serialized)}\n`, "utf8");
      await fs.rename(temporary, this.cachePath);
    });
    this.persistencePending = operation.catch(() => undefined);
    return this.persistencePending.then(() => undefined);
  }

  /**
   * BM25-ish lexical ranking: for each query term, score files by
   * TF * IDF with length normalization, plus a flat boost for symbol-name
   * and path matches (those are usually what the user actually meant).
   */
  async search(query: string, opts?: { limit?: number }): Promise<CodebaseSearchHit[]> {
    await this.ensureReady();
    const limit = opts?.limit ?? 20;
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.files.size === 0) return [];

    const chunks = [...this.files.values()].flatMap((file) => file.chunks);
    const N = chunks.length;
    const avgLen =
      chunks.reduce((sum, chunk) => sum + chunk.totalTerms, 0) / Math.max(1, N) || 1;
    const stats = { N, avgLen, k1: 1.5, b: 0.75 };
    const df = computeDocumentFrequencies(terms, chunks);
    const queryLower = query.toLowerCase();

    const scored = chunks
      .map((chunk) => scoreIndexedChunk({ chunk, terms, df, stats, queryLower }))
      .filter((hit): hit is CodebaseSearchHit => hit !== null);

    scored.sort((a, b2) => b2.score - a.score);
    const bestByFile = new Map<string, CodebaseSearchHit>();
    for (const hit of scored) {
      if (!bestByFile.has(hit.path)) bestByFile.set(hit.path, hit);
    }
    return [...bestByFile.values()].slice(0, limit);
  }

  /** True when a semantic backend has been supplied — otherwise `semanticSearch` is a no-op. */
  get hasSemanticLayer(): boolean {
    return Boolean(this.options.embeddingProvider);
  }

  /**
   * Optional embeddings-backed cosine-similarity search, entirely opt-in.
   * NinjaCode ships without a mandatory external embeddings service — this
   * only activates when the host explicitly configures an
   * `EmbeddingProvider` (e.g. a local model or a user's own API key).
   */
  async semanticSearch(query: string, opts?: { limit?: number }): Promise<CodebaseSearchHit[]> {
    const provider = this.options.embeddingProvider;
    if (!provider) return [];
    await this.ensureReady();
    const limit = opts?.limit ?? 20;
    const chunks = [...this.files.values()].flatMap((file) => file.chunks);

    const missing = chunks.filter((chunk) => !this.embeddings.has(chunk.id));
    if (missing.length > 0) {
      const texts = missing.map(
        (chunk) => `${chunk.path}\n${chunk.symbol ?? ""}\n${chunk.text}`,
      );
      const vectors = await provider.embed(texts);
      missing.forEach((chunk, i) => {
        const v = vectors[i];
        if (v) this.embeddings.set(chunk.id, v);
      });
      await this.persist();
    }

    const [queryVec] = await provider.embed([query]);
    if (!queryVec) return [];

    const scored: CodebaseSearchHit[] = [];
    for (const chunk of chunks) {
      const vec = this.embeddings.get(chunk.id);
      if (!vec) continue;
      const score = cosineSimilarity(queryVec, vec);
      if (score > 0) {
        scored.push({
          path: chunk.path,
          score,
          snippet: chunk.text.slice(0, 600),
          symbol: chunk.symbol,
          symbols: chunk.symbol ? [chunk.symbol] : undefined,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const bestByFile = new Map<string, CodebaseSearchHit>();
    for (const hit of scored) {
      if (!bestByFile.has(hit.path)) bestByFile.set(hit.path, hit);
    }
    return [...bestByFile.values()].slice(0, limit);
  }

  listFiles(): IndexedFile[] {
    return [...this.files.values()];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
