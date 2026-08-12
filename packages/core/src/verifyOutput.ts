/**
 * Condenses the output of a failed verify command into something the model can
 * act on.
 *
 * Verification failures feed a retry loop, so what reaches the model is not a
 * log — it is the instruction for the next turn. Build tools bury their
 * diagnostics: `tsc` prints them among progress lines, `vitest` puts the
 * failure summary at the very end. Handing over the first few thousand
 * characters therefore spends tokens on noise and leaves the agent to retry
 * without ever having seen the error.
 */

/** Lines that carry an actual diagnostic rather than progress or decoration. */
const DIAGNOSTIC_PATTERNS: RegExp[] = [
  // A source location: file.ts:12:3, file.ts(12,3), possibly behind a runner
  // marker such as vitest's "❯". This is the line the agent can act on.
  /[\w./\\@-]+\.\w+[:(]\d+[:,]\d+\)?/,
  /\berror\s+TS\d+\b/i, // tsc
  /^\s*(FAIL|✕|×|✗)\s/, // vitest / jest failures
  /^\s*(AssertionError|TypeError|ReferenceError|SyntaxError|Error):/,
  /^\s*\d+\)\s/, // mocha-style numbered failures
  /\b\d+\s+(problems?|errors?)\b/i, // eslint / tsc summary counts
  /^\s*(Tests|Test Files)\s+\d+\s+failed/,
];

const MAX_DIAGNOSTIC_LINES = 20;
const MAX_LINE_LENGTH = 400;
/** Characters kept from each end when nothing recognisable was found. */
const HEAD_CHARS = 800;
const TAIL_CHARS = 2400;

function isDiagnostic(line: string): boolean {
  return DIAGNOSTIC_PATTERNS.some((re) => re.test(line));
}

function clampLine(line: string): string {
  const trimmed = line.trimEnd();
  return trimmed.length > MAX_LINE_LENGTH ? `${trimmed.slice(0, MAX_LINE_LENGTH)}…` : trimmed;
}

/**
 * Head and tail with the middle elided. Tools that report nothing we recognise
 * still put their conclusion last, so the tail gets the larger share.
 */
function headAndTail(text: string): string {
  if (text.length <= HEAD_CHARS + TAIL_CHARS) return text;
  const omitted = text.length - HEAD_CHARS - TAIL_CHARS;
  return [
    text.slice(0, HEAD_CHARS),
    `\n… ${omitted} characters omitted …\n`,
    text.slice(text.length - TAIL_CHARS),
  ].join("");
}

/**
 * Pick the diagnostic lines out of a command's output, falling back to head and
 * tail when the format is not one we recognise. Returns the empty string for
 * empty output.
 */
export function condenseVerifyOutput(stdout: string, stderr: string): string {
  const combined = `${stdout}${stdout && stderr ? "\n" : ""}${stderr}`.trim();
  if (!combined) return "";

  const lines = combined.split("\n");
  const diagnostics = lines.filter(isDiagnostic).map(clampLine);
  if (diagnostics.length === 0) return headAndTail(combined);

  const kept = diagnostics.slice(0, MAX_DIAGNOSTIC_LINES);
  const dropped = diagnostics.length - kept.length;
  const suffix = dropped > 0 ? `\n… ${dropped} more diagnostic line(s) …` : "";
  return `${kept.join("\n")}${suffix}`;
}
