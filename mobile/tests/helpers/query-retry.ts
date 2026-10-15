// The query client retries a failing read (network drop, 408, 5xx) 3 times with
// a 1s/2s/4s backoff before a screen may show its "불러오지 못했습니다" state
// (mobile/src/lib/queryClient.ts: MAX_QUERY_RETRIES, getQueryRetryDelay). A
// mocked 5xx therefore reads as "loading" for ~7s, so an assertion on the error
// state needs more than the 5s default expect timeout.
export const QUERY_RETRY_SETTLE_MS = 15_000;
