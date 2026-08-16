/**
 * Structural boundaries ESLint cannot see: dependency direction between workspace
 * packages, cycles and orphans.
 */
module.exports = {
  forbidden: [
    {
      name: "leaf-packages-stay-leaves",
      comment:
        "packages/tools and packages/providers are leaves: core depends on them, never the reverse.",
      severity: "error",
      from: { path: "^packages/(tools|providers)/" },
      to: { path: "^packages/core/" },
    },
    {
      name: "no-app-to-app",
      comment: "Apps share code through packages/, not by reaching into each other.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/([^/]+)/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-circular",
      comment: "A cycle means two modules are one module with an arbitrary split.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "A module nothing imports is dead code. Delete it.",
      severity: "error",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.[^/]+$",
          "(^|/)(eslint|vitest|vite|drizzle)\\.config\\.[^/]+$",
          "(^|/)(index|extension|main)\\.tsx?$",
          "(^|/)(migrate|eval)\\.ts$",
          "(^|/).+\\.(test|spec)\\.tsx?$",
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "(^|/)(dist|\\.turbo|coverage)/",
        "^apps/bench/tasks/",
        "^apps/vscode/test/",
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
