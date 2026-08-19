# Frontier tools and context

## Codebase search

`search_codebase` uses the host-agnostic `CodebaseIndex` in VS Code, the CLI,
and ACP. The first query lazily loads `.ninjacode/index/codebase-index-v2.json`
and scans file metadata. Unchanged files are reused by size and mtime; changed,
new, and deleted files are updated incrementally. Search documents are bounded
chunks split at detected symbol boundaries, so results include a symbol and
source range when available.

Lexical search is always local and requires no model or network. Semantic
search activates only when a host explicitly supplies an `EmbeddingProvider`.
Vectors use the same symbol chunks and are persisted only with the configured
provider name.

## Safe edits and patches

Unified diff hunks honor `@@ -oldStart,oldCount +newStart,newCount @@` offsets.
All files and hunk counts are validated before the first write. Context drift
is accepted only when a unique exact or whitespace-normalized location can be
selected; repeated candidates use the declared offset and reject equal ties.

Callers can distinguish:

- `StalePatch` / `stale_patch`: source context or hunk counts no longer match.
- `AmbiguousEdit` / `ambiguous_edit`: more than one safe target exists.

`edit_file` still prefers an exact unique match. Its fallback is deliberately
small: whole line windows, at most 8,000 requested characters and 80 lines,
at most 6%/24 character distance, and a unique best candidate with a safety
margin. Otherwise it fails instead of choosing an occurrence.

## First-turn context and recovery

Scoped rules are selected from the union of user-mentioned paths, tool-touched
paths, files modified by the run, host IDE tabs/selections, and working-tree,
staged, or untracked Git files. Hosts provide live files through
`activeFilesProvider`; CLI and ACP provide Git context, while VS Code adds its
visible and active editors.

The append-only `events.jsonl` plus immutable session artifacts are the
canonical recovery record. The model-facing history is a compacted view.
Observation bodies are masked only when the message contains a valid artifact
reference recoverable through `read_session_artifact`; sessions without
artifact persistence retain the original observation instead of receiving an
irreversible placeholder.

## The summarizer is a model call too

Compaction's last resort asks a model to compress a transcript, so that transcript
must fit the summarizer's own context window. It is bounded by
`compactionTranscriptBudget`, which reserves room for the checkpoint instructions
and the summary itself. When the segment is larger than the budget, the oldest
messages are dropped and the omission is stated in the transcript; prior
checkpoints are never the part sacrificed, since they are the densest thing in the
segment.

An unbounded transcript did not fail loudly — it came back as a provider error and
landed in the local heuristic, producing a plausible summary that hid the loss.
`CompactionInfo` therefore carries `fallbackReason` and `droppedFromTranscript`,
and the harness logs both. A silent fallback is indistinguishable from success,
which is the only outcome worse than a visible failure.

## Waiting is a loop

`llmTurnGuard` bounds one LLM request: a ceiling derived from the remaining run
budget rather than a constant, a stream-idle watchdog, and an end to the run after
consecutive stalls. A stalled turn streamed nothing, so history is untouched and
the retry is both safe and cache-friendly — and it passes back through the turn
preconditions, which re-check budget, run timeout and abort before waiting again.
