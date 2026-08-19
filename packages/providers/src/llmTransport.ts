import { Agent } from "undici";

/**
 * Undici caps time-to-headers and inter-chunk gaps at 300s, and a reasoning
 * model routinely streams for longer than that on a hard turn. Left at the
 * default the socket dies mid-thought and the turn is lost, so the ceiling has
 * to sit above anything the harness itself would allow: the request budget in
 * `llmTurnGuard` is what decides when to give up, not the transport.
 */
const LLM_STREAM_TIMEOUT_MS = 900_000;

/**
 * The `undici` dependency is pinned to the major that Node's bundled `fetch`
 * speaks. A newer major rejects the handler the bundled client passes
 * ("invalid onRequestStart method") and every request fails instantly, so
 * `llmTransport.test.ts` exercises a real loopback call to catch that skew.
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
