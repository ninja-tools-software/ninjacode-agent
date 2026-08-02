/**
 * The single source of truth for how agent modes are presented. Both the
 * composer's mode menu and the Settings tab render from this list, so a mode
 * never shows up with a different label or hint depending on where you look.
 */
import type { Mode } from "./types.js";

interface ModeMeta {
  id: Mode;
  label: string;
  /** One line, user-facing: what the agent is allowed to do in this mode. */
  hint: string;
}

export const MODE_META: ModeMeta[] = [
  { id: "agent", label: "Agent", hint: "Edits files and runs commands" },
  { id: "plan", label: "Plan", hint: "Designs an approach, read-only" },
  { id: "ask", label: "Ask", hint: "Answers questions, read-only" },
  { id: "debug", label: "Debug", hint: "Investigates with runtime evidence" },
];

export function modeMeta(mode: Mode): ModeMeta {
  return MODE_META.find((m) => m.id === mode) ?? MODE_META[0]!;
}

/** Cycle through MODE_META order (agent → plan → ask → debug). */
export function nextMode(mode: Mode, backward = false): Mode {
  const i = MODE_META.findIndex((m) => m.id === mode);
  const step = backward ? -1 : 1;
  return MODE_META[(i + step + MODE_META.length) % MODE_META.length]!.id;
}
