import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Size and complexity budgets are `warn` while the refactoring campaign runs, then
 * become `error` to stop regressions. Correctness rules are `error` from the start.
 */
const CLEAN_CODE_BUDGETS = {
  "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true }],
  "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
  "max-params": ["warn", 4],
  "max-depth": ["warn", 3],
  complexity: ["warn", 15],
  "no-else-return": ["warn", { allowElseIf: false }],
};

/**
 * Files that are declarative data or type contracts: no branching to untangle, so the
 * size budgets would only push toward artificial splits.
 */
const DATA_AND_CONTRACT_FILES = [
  "packages/providers/src/catalog.ts",
  "packages/providers/src/gatewayModels.ts",
  "packages/providers/src/gatewayPlans.ts",
  "apps/vscode/src/protocol.ts",
  "apps/vscode/webview/src/icons.tsx",
  "apps/vscode/webview/src/mermaidTheme.ts",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "apps/bench/tasks/**",
      "**/*.d.ts",
      // Config/stub files outside package tsconfigs — projectService cannot resolve them.
      "**/vitest.config.ts",
      "**/vite.config.ts",
      "apps/vscode/test/**",
      ".dependency-cruiser.cjs",
      "eslint.config.mjs",
      "knip.json",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...CLEAN_CODE_BUDGETS,

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },

  {
    files: ["apps/vscode/webview/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
  },

  {
    files: DATA_AND_CONTRACT_FILES,
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-params": "off",
    },
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
);
