import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchMockScript, BenchTask } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Default task directory: apps/bench/tasks (works from dist/ and src/). */
const defaultTasksDir = path.resolve(here, "..", "tasks");

interface TaskFilter {
  /** Restrict to these task ids (from `--tasks a,b`). */
  ids?: string[];
  /** Restrict to tasks that list this suite tag (from `--suite NAME`). */
  suite?: string;
}

/** Pure filter used by loadTasks — exported for unit tests. */
export function matchesTaskFilter(task: BenchTask, filter?: TaskFilter): boolean {
  if (!filter) return true;
  if (filter.ids && !filter.ids.includes(task.id)) return false;
  if (filter.suite && !(task.suites ?? []).includes(filter.suite)) return false;
  return true;
}

export async function loadTasks(
  tasksDir = defaultTasksDir,
  filter?: string[] | TaskFilter,
): Promise<BenchTask[]> {
  const normalized: TaskFilter | undefined = Array.isArray(filter)
    ? { ids: filter }
    : filter;
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const tasks: BenchTask[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskFile = path.join(tasksDir, entry.name, "task.json");
    let raw: string;
    try {
      raw = await fs.readFile(taskFile, "utf8");
    } catch {
      continue;
    }
    const task = JSON.parse(raw) as BenchTask;
    task.id = task.id || entry.name;
    const fixture = path.join(tasksDir, entry.name, "fixture");
    try {
      await fs.access(fixture);
      task.fixtureDir = fixture;
    } catch {
      task.fixtureDir = undefined;
    }
    const scriptsPath = path.join(tasksDir, entry.name, "scripts.json");
    try {
      const scriptsRaw = await fs.readFile(scriptsPath, "utf8");
      task.scripts = JSON.parse(scriptsRaw) as BenchMockScript[];
      task.scriptsFile = scriptsPath;
    } catch {
      task.scripts = undefined;
      task.scriptsFile = undefined;
    }
    if (matchesTaskFilter(task, normalized)) tasks.push(task);
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}
