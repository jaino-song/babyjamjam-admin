import type { QueryKey } from "@tanstack/react-query";

/**
 * Entity kinds the backend announces on `GET /realtime/events` (`entity-changed`).
 * The set is closed on the wire; anything else is ignored so a newer backend
 * never breaks an older cached frontend bundle.
 */
export type RealtimeEntityKind =
    | "client"
    | "employee"
    | "document"
    | "message"
    | "service-record";

// Roots only (prefix match): every query under a root is stale when its kind
// changes. A root appearing under two kinds (`dashboard`) is de-duplicated when
// the union is built.
export const ENTITY_QUERY_KEY_ROOTS: Readonly<Record<RealtimeEntityKind, readonly QueryKey[]>> = {
    client: [["clients"], ["dashboard"]],
    employee: [["employees"]],
    document: [
        ["eformsign-documents"],
        ["eformsign-docs"],
        ["eformsign-client-names"],
        ["eformsign-status-counts"],
        ["eformsign-document-jobs"],
        ["dashboard"],
    ],
    message: [["message-triggers"]],
    "service-record": [["service-records"]],
};

const isKnownKind = (kind: unknown): kind is RealtimeEntityKind =>
    typeof kind === "string" && Object.hasOwn(ENTITY_QUERY_KEY_ROOTS, kind);

/** Union of the query roots for the given kinds, in first-seen order, unknown kinds dropped. */
export function queryKeyRootsForKinds(kinds: Iterable<unknown>): QueryKey[] {
    const seen = new Set<string>();
    const roots: QueryKey[] = [];
    for (const kind of kinds) {
        if (!isKnownKind(kind)) continue;
        for (const root of ENTITY_QUERY_KEY_ROOTS[kind]) {
            const id = JSON.stringify(root);
            if (seen.has(id)) continue;
            seen.add(id);
            roots.push(root);
        }
    }
    return roots;
}

/** Every root in the map — what a reconnect refreshes, instead of an unfiltered invalidate. */
export function allQueryKeyRoots(): QueryKey[] {
    return queryKeyRootsForKinds(Object.keys(ENTITY_QUERY_KEY_ROOTS));
}
