/** Quote bracket labels that contain characters which break Mermaid parsers. */
export function sanitizeMermaidSource(source: string): string {
  return source.replace(/(\b[\w-]+)\[([^\]"\n]+)\]/g, (match, nodeId: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return match;
    if (!/[@#]|\/|\s-\s/.test(trimmed)) return match;
    const escaped = trimmed.replace(/"/g, '\\"');
    return `${nodeId}["${escaped}"]`;
  });
}
