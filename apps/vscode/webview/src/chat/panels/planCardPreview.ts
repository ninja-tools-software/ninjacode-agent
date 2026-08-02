/** Strip the leading markdown H1 so the plan card header is the sole title. */
export function stripLeadingH1(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("# ")) return content;
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return "";
  return trimmed.slice(newline + 1).replace(/^\n+/, "");
}
