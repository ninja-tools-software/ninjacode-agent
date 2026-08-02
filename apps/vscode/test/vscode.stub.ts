/**
 * Minimal stand-in for the `vscode` module, aliased in `vitest.config.ts`.
 *
 * The extension host API only exists inside VS Code, so any host module under
 * test would fail to import otherwise. Tests that need behaviour (not just a
 * resolvable import) should override the pieces they use with `vi.spyOn`.
 */

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fsPath: string,
  ) {}

  static file(fsPath: string): Uri {
    return new Uri("file", fsPath, fsPath);
  }

  static parse(value: string): Uri {
    const match = /^([a-z][a-z\d+.-]*):\/\/(.*)$/i.exec(value);
    if (!match) return Uri.file(value);
    return new Uri(match[1]!.toLowerCase(), `/${match[2]!.replace(/^\/+/, "")}`, decodeURIComponent(`/${match[2]!.replace(/^\/+/, "")}`));
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export const window = {
  activeTextEditor: undefined as unknown,
  activeTerminal: undefined as unknown,
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

export const workspace = {
  workspaceFolders: undefined as unknown,
  getConfiguration: () => ({ get: () => undefined }),
  asRelativePath: (value: unknown) => String(value),
};

export const languages = {
  getDiagnostics: (() => []) as (uri?: unknown) => unknown[],
};

export const commands = {
  registerCommand: () => ({ dispose() {} }),
  executeCommand: () => Promise.resolve(undefined),
};

export const env = {
  language: "en",
  clipboard: {
    readText: () => Promise.resolve(""),
    writeText: () => Promise.resolve(),
  },
};

export const l10n = {
  t: (message: string, ...args: Array<string | number | boolean>) =>
    message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? "")),
};
