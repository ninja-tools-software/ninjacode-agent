import fs from "node:fs/promises";
import path from "node:path";
import type { SweBenchInstance } from "./types.js";

export const SWE_BENCH_LITE = "princeton-nlp/SWE-bench_Lite";

interface HfRowsResponse {
  rows: Array<{ row: SweBenchInstance }>;
  num_rows_total: number;
}

interface LoadOptions {
  cacheDir?: string;
  instanceIds?: string[];
  limit?: number;
}

/** Loads SWE-bench Lite test split via HuggingFace datasets-server (cached locally). */
export async function loadSweBenchLite(opts: LoadOptions = {}): Promise<SweBenchInstance[]> {
  const cachePath = path.join(opts.cacheDir ?? path.join(process.cwd(), ".cache"), "swebench-lite-test.json");
  let instances = await readCache(cachePath);
  if (!instances) {
    instances = await fetchAllRows(SWE_BENCH_LITE, "test");
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(instances, null, 2));
  }

  if (opts.instanceIds?.length) {
    const wanted = new Set(opts.instanceIds);
    instances = instances.filter((i) => wanted.has(i.instance_id));
  }
  if (opts.limit !== undefined && opts.limit >= 0) {
    instances = instances.slice(0, opts.limit);
  }
  return instances;
}

async function readCache(cachePath: string): Promise<SweBenchInstance[] | undefined> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return JSON.parse(raw) as SweBenchInstance[];
  } catch {
    return undefined;
  }
}

async function fetchAllRows(dataset: string, split: string): Promise<SweBenchInstance[]> {
  const pageSize = 100;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const rows: SweBenchInstance[] = [];

  while (offset < total) {
    const url =
      `https://datasets-server.huggingface.co/rows` +
      `?dataset=${encodeURIComponent(dataset)}` +
      `&config=default&split=${encodeURIComponent(split)}` +
      `&offset=${offset}&length=${pageSize}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load ${dataset} from HuggingFace (${res.status}): ${await res.text()}`);
    }
    const body = (await res.json()) as HfRowsResponse;
    total = body.num_rows_total;
    for (const entry of body.rows) rows.push(entry.row);
    offset += body.rows.length;
    if (body.rows.length === 0) break;
  }
  return rows;
}
