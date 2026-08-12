/**
 * Every string the welcome screen shows, as English i18n keys. Keeping the copy
 * out of the components means the marketing wording can be reworked without
 * touching layout, and the icon stays a name until the TSX resolves it.
 */

export type OnboardingIconId = "bolt" | "wand" | "chart" | "shuriken" | "modes" | "attach";

export interface OnboardingPoint {
  icon: OnboardingIconId;
  title: string;
  body: string;
}

/** A single-line item, for the secondary block that only needs to be scannable. */
interface OnboardingLine {
  icon: OnboardingIconId;
  text: string;
}

/**
 * Why a NinjaCode Pass beats juggling provider keys. Order is the sales order,
 * and each body stays one short sentence so the screen never needs scrolling.
 */
export const GATEWAY_BENEFITS: OnboardingPoint[] = [
  {
    icon: "bolt",
    title: "Every frontier model, one key",
    body: "Claude, GPT, Kimi, DeepSeek, Grok.",
  },
  {
    icon: "wand",
    title: "Auto-picks the cheapest model",
    body: "Big models only when needed.",
  },
  {
    icon: "chart",
    title: "A bill you can predict",
    body: "Monthly credits, your own cap.",
  },
];

/** The three things worth knowing before the first prompt. `{0}` is the shortcut. */
export const AGENT_BASICS: OnboardingLine[] = [
  { icon: "shuriken", text: "Toggle the chat in the status bar, or {0}." },
  { icon: "modes", text: "Four modes, Shift+Tab to cycle:" },
  { icon: "attach", text: "Add files with @, or drag them in (Shift+drop)." },
];

/** Platform-correct label for the chat toggle keybinding. */
export function chatToggleShortcut(platform: string): string {
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘⇧L" : "Ctrl+Shift+L";
}
