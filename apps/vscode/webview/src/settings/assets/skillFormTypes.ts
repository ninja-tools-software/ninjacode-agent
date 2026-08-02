export interface SkillDraft {
  path?: string;
  name: string;
  description: string;
  context: "inline" | "fork";
  allowedTools: string;
  body: string;
}
