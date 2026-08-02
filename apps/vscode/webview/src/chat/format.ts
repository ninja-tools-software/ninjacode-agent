/** Pure formatting and file helpers shared across the chat UI. */

/** Compact context-window sizes: 128000 → "128k", 1000000 → "1M". */
export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Token counts, keeping one decimal when it carries information: 1500 → "1.5K". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return String(n);
}

interface SessionRecencySection<T extends { updatedAt: string }> {
  label: string;
  sessions: T[];
}

/** Buckets session rows for the history popover (Today / Previous 7 days / Older). */
export function groupSessionsByRecency<T extends { updatedAt: string }>(
  sessions: T[],
  now = Date.now(),
): SessionRecencySection<T>[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const sevenDaysAgo = todayMs - 7 * 24 * 60 * 60 * 1000;

  const today: T[] = [];
  const previous7days: T[] = [];
  const older: T[] = [];

  for (const session of sessions) {
    const t = Date.parse(session.updatedAt);
    if (!Number.isFinite(t)) {
      older.push(session);
      continue;
    }
    if (t >= todayMs) today.push(session);
    else if (t >= sevenDaysAgo) previous7days.push(session);
    else older.push(session);
  }

  const sections: SessionRecencySection<T>[] = [];
  if (today.length) sections.push({ label: "Today", sessions: today });
  if (previous7days.length) sections.push({ label: "Previous 7 days", sessions: previous7days });
  if (older.length) sections.push({ label: "Older", sessions: older });
  return sections;
}

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

export function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Last path segment, for badge labels. */
export function basename(p: string): string {
  const clean = p.replace(/[/\\]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return idx === -1 ? clean : clean.slice(idx + 1);
}

function readFile(file: File, as: "dataUrl" | "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    if (as === "dataUrl") reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return readFile(file, "dataUrl");
}

export function readFileAsText(file: File): Promise<string> {
  return readFile(file, "text");
}
