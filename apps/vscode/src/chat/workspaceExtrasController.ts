import path from "node:path";
import {
  discoverRules,
  discoverSkills,
  loadCustomAgents,
  loadMcpConfigFile,
  type CustomAgentDefinition,
  type RuleDiagnostic,
  type SkillDefinition,
} from "@ninjacode/core";
import type { SettingsExtras } from "../settingsService.js";
import type { McpService } from "./mcpService.js";

interface WorkspaceExtrasDeps {
  workspaceRoot: () => string | undefined;
  mcp: McpService;
}

/** Loads workspace-scoped Settings tab extras (MCP, skills, rules, agents). */
export class WorkspaceExtrasController {
  constructor(private readonly deps: WorkspaceExtrasDeps) {}

  async load(): Promise<SettingsExtras> {
    const root = this.deps.workspaceRoot();
    if (!root) {
      return { mcpServers: [], skills: [], customAgents: [], rules: [], mcpConfigFile: null };
    }
    const [skills, customAgents, rules, mcpFile, mcp] = await Promise.all([
      discoverSkills(root).catch(() => [] as SkillDefinition[]),
      loadCustomAgents(root).catch(() => [] as CustomAgentDefinition[]),
      discoverRules(root)
        .then((r) => r.diagnostics)
        .catch(() => [] as RuleDiagnostic[]),
      loadMcpConfigFile(root).catch(() => ({ file: null as string | null, servers: [] })),
      this.deps.mcp.ensure(root).catch(() => ({ clients: [], statuses: [] })),
    ]);
    return {
      mcpServers: mcp.statuses,
      skills,
      customAgents,
      rules,
      mcpConfigFile: mcpFile.file ? path.relative(root, mcpFile.file) : null,
    };
  }

  async reloadMcp(): Promise<void> {
    const root = this.deps.workspaceRoot();
    if (!root) return;
    await this.deps.mcp.close(root);
    await this.deps.mcp.ensure(root).catch(() => undefined);
  }
}
