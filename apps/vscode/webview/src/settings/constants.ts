import {
  AttachIcon,
  BotIcon,
  BugIcon,
  ChatIcon,
  CheckIcon,
  ForkIcon,
  PinIcon,
  PlanIcon,
  PlayIcon,
  SettingsIcon,
} from "../icons.js";
import type { ApprovalMode } from "../types.js";

export const SECTIONS = [
  { id: "account", label: "Account & credits", icon: BotIcon },
  { id: "providers", label: "Providers & keys", icon: CheckIcon },
  { id: "models", label: "Model & reasoning", icon: PlanIcon },
  { id: "agent", label: "Agent preferences", icon: SettingsIcon },
  { id: "chat", label: "Chat panel", icon: ChatIcon },
  { id: "mcp", label: "MCP servers", icon: AttachIcon },
  { id: "skills", label: "Skills", icon: PlayIcon },
  { id: "rules", label: "Rules & instructions", icon: PinIcon },
  { id: "agents", label: "Custom agents", icon: ForkIcon },
  { id: "logs", label: "Agent logs", icon: BugIcon },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const APPROVAL_MODES: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  { id: "strict", label: "Strict", hint: "Ask before every write or command" },
  { id: "balanced", label: "Balanced", hint: "Ask for destructive or risky actions" },
  { id: "autonomous", label: "Autonomous", hint: "Only ask when truly unsafe" },
];
