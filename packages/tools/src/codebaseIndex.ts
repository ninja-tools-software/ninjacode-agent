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
    .toLowerCase()
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
      return subParts.length > 1 ? [word, ...subParts] : [word];
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
  files: Iterable<IndexedFile>,
): Map<string, number> {
  const df = new Map<string, number>();
  for (const term of terms) {
    let count = 0;
    for (const f of files) {
      if (f.termFreq.has(term)) count++;
    }
    df.set(term, count);
  }
  return df;
}

function matchedSymbolNames(file: IndexedFile, terms: string[]): string[] {
  const matched: string[] = [];
  for (const sym of file.symbols) {
    if (terms.some((t) => sym.name.toLowerCase().includes(t))) matched.push(sym.name);
  }
  return matched;
}

function scoreIndexedFile(opts: {
  file: IndexedFile;
  terms: string[];
  df: Map<string, number>;
  stats: { N: number; avgLen: number; k1: number; b: number };
  queryLower: string;
}): CodebaseSearchHit | null {
  const { file, terms, df, stats, queryLower } = opts;
  let score = 0;
  for (const term of terms) {
    const tf = file.termFreq.get(term) ?? 0;
    if (tf <= 0) continue;
    const docFreq = df.get(term) ?? 0;
    const idf = Math.log(1 + (stats.N - docFreq + 0.5) / (docFreq + 0.5));
    const denom = tf + stats.k1 * (1 - stats.b + stats.b * (file.totalTerms / stats.avgLen));
    score += idf * ((tf * (stats.k1 + 1)) / Math.max(denom, 1e-6));
  }
  if (file.path.toLowerCase().includes(queryLower)) score += 3;
  const matchedSymbols = matchedSymbolNames(file, terms);
  score += matchedSymbols.length * 4;
  if (score <= 0) return null;
  return {
    path: file.path,
    score,
    snippet: file.firstLines || undefined,
    symbols: matchedSymbols.length ? matchedSymbols.slice(0, 8) : undefined,
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

  constructor(
    private readonly workspaceRoot: string,
    private readonly options: CodebaseIndexOptions = {},
  ) {}

  get isBuilt(): boolean {
    return this.built;
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

  /** Full (re)scan of the workspace. Safe to call again later to rebuild from scratch. */
  async build(): Promise<void> {
    this.gitignore = await loadGitignore(this.workspaceRoot);
    this.files.clear();
    const max = this.options.maxFiles ?? 20_000;
    const queue: string[] = [""];
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
        if (this.isIgnoredByGit(relPath)) continue;
        await this.indexFile(relPath);
        scanned++;
      }
    }
    this.built = true;
  }

  /** Re-index a single file after a create/change event. No-ops silently on read failure. */
  async refreshFile(relPath: string): Promise<void> {
    const normalized = relPath.replace(/\\/g, "/");
    if (this.isIgnoredByGit(normalized)) {
      this.files.delete(normalized);
      return;
    }
    for (const part of normalized.split("/")) {
      if (this.isIgnoredDir(part)) {
        this.files.delete(normalized);
        return;
      }
    }
    await this.indexFile(normalized);
  }

  /** Drop a file from the index after a delete event. */
  removeFile(relPath: string): void {
    this.files.delete(relPath.replace(/\\/g, "/"));
    this.embeddings.delete(relPath.replace(/\\/g, "/"));
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
    };

    if (isText && st.size <= MAX_FILE_BYTES) {
      try {
        const content = await fs.readFile(abs, "utf8");
        if (!content.includes("\0")) {
          entry.symbols = extractSymbols(content);
          entry.firstLines = content.split("\n").slice(0, 6).join("\n").slice(0, 400);
          const tokens = tokenize(`${relPath}\n${content}`);
          const freq = buildTermFreq(tokens);
          entry.termFreq = freq.termFreq;
          entry.totalTerms = freq.totalTerms;
        }
      } catch {
        // unreadable — keep metadata-only entry
      }
    }

    this.files.set(relPath, entry);
  }

  /**
   * BM25-ish lexical ranking: for each query term, score files by
   * TF * IDF with length normalization, plus a flat boost for symbol-name
   * and path matches (those are usually what the user actually meant).
   */
  search(query: string, opts?: { limit?: number }): CodebaseSearchHit[] {
    const limit = opts?.limit ?? 20;
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.files.size === 0) return [];

    const fileList = [...this.files.values()];
    const N = fileList.length;
    const avgLen =
      fileList.reduce((s, f) => s + f.totalTerms, 0) / Math.max(1, N) || 1;
    const stats = { N, avgLen, k1: 1.5, b: 0.75 };
    const df = computeDocumentFrequencies(terms, fileList);
    const queryLower = query.toLowerCase();

    const scored = fileList
      .map((f) => scoreIndexedFile({ file: f, terms, df, stats, queryLower }))
      .filter((hit): hit is CodebaseSearchHit => hit !== null);

    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, limit);
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
    const limit = opts?.limit ?? 20;

    const missing = [...this.files.keys()].filter((p) => !this.embeddings.has(p));
    if (missing.length > 0) {
      const texts = missing.map((p) => {
        const f = this.files.get(p)!;
        return `${p}\n${f.firstLines}`;
      });
      const vectors = await provider.embed(texts);
      missing.forEach((p, i) => {
        const v = vectors[i];
        if (v) this.embeddings.set(p, v);
      });
    }

    const [queryVec] = await provider.embed([query]);
    if (!queryVec) return [];

    const scored: CodebaseSearchHit[] = [];
    for (const [p, vec] of this.embeddings) {
      const score = cosineSimilarity(queryVec, vec);
      if (score > 0) scored.push({ path: p, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
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
