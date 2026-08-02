export function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function getFlagInt(args: string[], name: string, fallback: number): number {
  const raw = getFlag(args, name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getFlagList(args: string[], name: string): string[] | undefined {
  const raw = getFlag(args, name);
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
