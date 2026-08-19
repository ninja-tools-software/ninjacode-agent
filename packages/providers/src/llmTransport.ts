import { Agent } from "undici";

/**
 * Undici caps time-to-headers and inter-chunk gaps at 300s. A reasoning model
 * routinely thinks longer than that before the first byte, so the default cuts
 * the connection mid-thought and the turn is lost. The caller's abort signal
 * (run timeout, user cancel) stays the real bound; this is only a backstop
 * against a genuinely dead socket.
 */
const LLM_STREAM_TIMEOUT_MS = 900_000;

/**
 * `fetch` types `dispatcher` against the undici bundled with `@types/node`,
 * which is a different copy from the `undici` package used to build the agent.
 * The two are structurally compatible at runtime — global fetch only calls
 * `dispatch` — so the skew is resolved here once instead of at every call site.
 */
type FetchDispatcher = NonNullable<RequestInit["dispatcher"]>;

let dispatcher: FetchDispatcher | undefined;

/** Attach the long-lived streaming dispatcher to a provider fetch call. */
export function llmFetchInit(init: RequestInit): RequestInit {
  dispatcher ??= new Agent({
    headersTimeout: LLM_STREAM_TIMEOUT_MS,
    bodyTimeout: LLM_STREAM_TIMEOUT_MS,
  }) as unknown as FetchDispatcher;
  return { ...init, dispatcher };
}
