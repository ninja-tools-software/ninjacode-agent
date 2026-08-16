import { t } from "./i18n.js";

function usage(): never {
  console.log(t("cli.usage"));
  process.exit(1);
}

export function parseArgs(argv: string[]) {
  const args = [...argv];
  const cmd = args.shift() ?? "help";
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  while (args.length) {
    const a = args.shift()!;
    if (a === "--yes" || a === "--no-checkpoints" || a === "--trust-workspace") {
      flags[a.slice(2)] = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args.shift();
      if (!val) usage();
      flags[key] = val;
    } else {
      positional.push(a);
    }
  }
  return { cmd, flags, positional };
}

export { usage };
