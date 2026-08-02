export interface AgentDraft {
  path?: string;
  name: string;
  description: string;
  model: string;
  tools: string;
  systemPrompt: string;
}
