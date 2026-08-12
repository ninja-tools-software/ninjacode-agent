import path from "node:path";
import { scaffoldVerifyConfig } from "@ninjacode/core";
import { t } from "./i18n.js";

/**
 * Scaffold `.ninjacode/verify.json` from the shape of the workspace, so the
 * completion verification loop has something to run.
 */
export async function initVerify(flags: Record<string, string | boolean>): Promise<void> {
  const workspace = path.resolve(String(flags.workspace ?? process.cwd()));
  const result = await scaffoldVerifyConfig(workspace, path.join(workspace, ".ninjacode"));

  if (result.status === "exists") {
    console.error(t("cli.verifyExists", { file: result.file }));
    return;
  }
  if (result.commands.length === 0) {
    console.error(t("cli.verifyEmpty", { file: result.file }));
    return;
  }
  console.error(
    t("cli.verifyCreated", { file: result.file, commands: result.commands.join(", ") }),
  );
}
