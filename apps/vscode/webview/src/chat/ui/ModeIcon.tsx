import { BotIcon, BugIcon, ChatIcon, PlanIcon } from "../../icons.js";
import type { Mode } from "../types.js";

export function ModeIcon({ mode, size = 14 }: { mode: Mode; size?: number }) {
  switch (mode) {
    case "agent":
      return <BotIcon size={size} />;
    case "plan":
      return <PlanIcon size={size} />;
    case "ask":
      return <ChatIcon size={size} />;
    case "debug":
      return <BugIcon size={size} />;
  }
}
