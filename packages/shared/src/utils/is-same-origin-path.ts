const SAME_ORIGIN_SENTINEL = "https://same-origin.invalid";

/**
 * True only when `value` is a same-origin path the way a browser actually
 * resolves it, not merely one that looks like one under a bare prefix
 * check. A prefix check such as `startsWith("/") && !startsWith("//")`
 * cannot see that a browser (and Next.js's own router) treats a backslash
 * as a path separator for special schemes: `/\evil.test` and its decoded
 * form resolve to the host `evil.test`, exactly like `//evil.test` does,
 * even though both pass that prefix check. Resolving the value against a
 * sentinel origin with `new URL` — the same algorithm the location bar and
 * `router.push` use — surfaces every such origin-escaping form (protocol
 * relative, backslash-as-separator, control characters in the host, a full
 * absolute URL with a different scheme or host, etc.) as a changed origin.
 *
 * No DOM dependency: `URL` is a global in both Node and the browser, so
 * this is safe to import from `packages/shared` (server code, isomorphic
 * schemas) as well as from frontend/mobile client components.
 */
export function isSameOriginPath(value: unknown): boolean {
    if (typeof value !== "string" || value.length === 0) return false;
    if (!value.startsWith("/") || value.startsWith("//")) return false;
    try {
        const resolved = new URL(value, SAME_ORIGIN_SENTINEL);
        // A same-origin value whose *normalised* path starts with "//"
        // ("/..//evil.test", "/.%2e//evil.test") is re-serialised by routers
        // as "//evil.test…", which a browser reads as protocol-relative.
        return resolved.origin === SAME_ORIGIN_SENTINEL && !resolved.pathname.startsWith("//");
    } catch {
        return false;
    }
}
