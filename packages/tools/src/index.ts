import type { ToolRegistry } from "./types.js";
import { ToolRegistry as Registry } from "./types.js";
import { editFileTool, deleteFileTool, listDirTool, readFileTool, writeFileTool } from "./fs.js";
import { globTool, grepTool, searchCodebaseTool } from "./search.js";
import { shellTool } from "./shell.js";
import { applyPatchTool } from "./patch.js";
import { readLintsTool } from "./diagnostics.js";
import { webSearchTool } from "./webSearch.js";
import {
  askUserTool,
  fetchUrlTool,
  requestUserActionTool,
  todoWriteTool,
  writeScratchpadTool,
} from "./interactive.js";
import { writePlanTool } from "./plan.js";
import {
  clearDebugLogsTool,
  cleanupInstrumentationTool,
  readDebugLogsTool,
  recordHypothesesTool,
} from "./debug.js";
import { readSessionArtifactTool } from "./sessionArtifacts.js";

export function createDefaultToolRegistry(options?: {
  includeNetwork?: boolean;
  includeDebug?: boolean;
}): ToolRegistry {
  const reg = new Registry();
  reg
    .register(readFileTool)
    .register(writeFileTool)
    .register(editFileTool)
    .register(applyPatchTool)
    .register(listDirTool)
    .register(globTool)
    .register(grepTool)
    .register(searchCodebaseTool)
    .register(readLintsTool)
    .register(readSessionArtifactTool)
    .register(shellTool)
    .register(todoWriteTool)
    .register(writeScratchpadTool)
    .register(writePlanTool)
    .register(askUserTool)
    .register(requestUserActionTool)
    .register(deleteFileTool);

  if (options?.includeNetwork !== false) {
    reg.register(fetchUrlTool).register(webSearchTool);
  }
  if (options?.includeDebug !== false) {
    reg
      .register(recordHypothesesTool)
      .register(readDebugLogsTool)
      .register(clearDebugLogsTool)
      .register(cleanupInstrumentationTool);
  }
  return reg;
}

export * from "./types.js";
export * from "./paths.js";
export * from "./fs.js";
export * from "./search.js";
export * from "./shell.js";
export * from "./shellScope.js";
export * from "./shellDanger.js";
export * from "./shellParse.js";
export * from "./sandbox.js";
export * from "./sandboxExecutor.js";
export * from "./safeHttp.js";
export * from "./sessionArtifacts.js";
export * from "./plan.js";
export * from "./plans.js";
export * from "./interactive.js";
export * from "./patch.js";
export * from "./debug.js";
export * from "./codebaseIndex.js";
export * from "./diagnostics.js";
export * from "./webSearch.js";
