import * as vscode from "vscode";
import type { ProviderKind } from "@ninjacode/providers";

function secretKeyFor(kind: ProviderKind): string {
  return `ninjacode.apiKey.${kind}`;
}

export async function getSecretApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<string | undefined> {
  return context.secrets.get(secretKeyFor(kind));
}

export async function setSecretApiKey(
  context: vscode.ExtensionContext,
  key: string,
  kind: ProviderKind,
): Promise<void> {
  await context.secrets.store(secretKeyFor(kind), key);
}

export async function deleteSecretApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<void> {
  await context.secrets.delete(secretKeyFor(kind));
}

export async function hasSecretApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<boolean> {
  const v = await getSecretApiKey(context, kind);
  return Boolean(v && v.length > 0);
}

export async function listConfiguredProviderKeys(
  context: vscode.ExtensionContext,
  kinds: ProviderKind[],
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const kind of kinds) {
    out[kind] = await hasSecretApiKey(context, kind);
  }
  return out;
}
