# VS Code extension-host E2E

The default Vitest suite runs `extensionTrajectory.test.ts` entirely offline
against the real core agent loop. `extensionHost.ts` adds a minimal activation
smoke test inside a real VS Code extension host.

Run the extension-host test with an existing VS Code binary:

```bash
VSCODE_EXECUTABLE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Electron" \
  pnpm --filter ninjacode test:e2e
```

The runner intentionally does not use `@vscode/test-electron`: that package
downloads a VS Code build when one is not already available. The current
environment does not provide a dedicated VS Code test executable and live
downloads are out of scope, so the extension-host smoke test cannot run there.
`test:e2e` fails with a precise setup error when `VSCODE_EXECUTABLE_PATH` is
missing; it never falls back to a network download.
