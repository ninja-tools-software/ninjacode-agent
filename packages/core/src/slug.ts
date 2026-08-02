/** Filename-safe slug for a workspace asset: `My Rule!` -> `my-rule`. */
export function toSlug(name: string, fallback: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

/**
 * Sanitize a fragment for use inside a tool name, which providers restrict to
 * `[a-zA-Z0-9_]`. Case is preserved — lowercase at the call site when wanted.
 */
export function toToolNameFragment(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
