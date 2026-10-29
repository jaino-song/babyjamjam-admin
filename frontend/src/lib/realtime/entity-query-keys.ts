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
    | "service-record"
    | "inquiry"
    | "call"
    | "file"
    | "holiday"
    | "settings"
    | "notification";

// Roots only (prefix match): every query under a root is stale when its kind
// changes. A root appearing under several kinds (`dashboard`, `data-source`) is
// de-duplicated when the union is built.
//
// Literals rather than imports of the key factories: those live in hook modules
// that pull in the API client and services, and this map is mounted from the
// app shell. `__tests__/entity-query-keys.test.ts` pins every root against the
// real factory output so a renamed key fails there instead of going stale silently.
export const ENTITY_QUERY_KEY_ROOTS: Readonly<Record<RealtimeEntityKind, readonly QueryKey[]>> = {
    client: [["clients"], ["dashboard"]],
    // `data-source`: dynamic-select option lists built from employee data.
    employee: [["employees"], ["data-source"]],
    document: [
        ["eformsign-documents"],
        ["eformsign-docs"],
        ["eformsign-client-names"],
        ["eformsign-status-counts"],
        ["eformsign-document-jobs"],
        ["dashboard"],
        ["eformsign-client-candidate"],
    ],
    message: [["message-triggers"], ["message-templates"], ["data-source"]],
    "service-record": [["service-records"]],
    inquiry: [["consultation-inquiries"]],
    // The desktop app has no call inbox; the kind is announced for mobile only.
    call: [],
    // The file library (`documents`), not the eformsign `document` kind above.
    file: [["documents"], ["document-categories"]],
    holiday: [
        ["holidays"],
        ["holiday-settings"],
        ["holiday-review-events"],
        ["holiday-review-items"],
        ["dashboard"],
    ],
    settings: [
        ["settings"],
        ["area-templates"],
        ["voucher-price-infos"],
        ["all-voucher-price-infos"],
        ["out-of-pocket-price-infos"],
        ["voucher-years"],
        ["bank-account-infos"],
        ["data-source"],
        ["system-templates"],
    ],
    notification: [["notifications"]],
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
