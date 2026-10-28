import type { QueryKey } from "@tanstack/react-query";

/**
 * Kinds carried by the backend's `entity-changed` event (closed set — the
 * wire contract in `backend/.../realtime`). Anything else is ignored so a
 * newer backend can add a kind without breaking an older client.
 */
export const REALTIME_ENTITY_KINDS = [
  "client",
  "employee",
  "document",
  "message",
  "service-record",
] as const;

export type RealtimeEntityKind = (typeof REALTIME_ENTITY_KINDS)[number];

// Roots, not leaves: invalidating a root also refetches every list/detail/
// filter variant under it. Literals (not the hook modules' key factories) keep
// this file free of hook imports; entity-query-keys.test.ts pins them to the
// factories so a renamed root cannot silently stop refreshing.
export const ENTITY_QUERY_ROOTS: Record<RealtimeEntityKind, readonly QueryKey[]> = {
  client: [["clients"], ["dashboard"]],
  employee: [["employees"]],
  document: [
    ["eformsign-documents"],
    ["eformsign-docs"],
    ["eformsign-doc-client-names"],
    ["eformsign-document-detail"],
    ["dashboard"],
  ],
  message: [["message-triggers"], ["messages"]],
  "service-record": [["service-records"]],
};

function isRealtimeEntityKind(value: unknown): value is RealtimeEntityKind {
  return (
    typeof value === "string" &&
    (REALTIME_ENTITY_KINDS as readonly string[]).includes(value)
  );
}

function dedupeRoots(roots: readonly QueryKey[]): QueryKey[] {
  const seen = new Set<string>();
  const unique: QueryKey[] = [];
  for (const root of roots) {
    const id = JSON.stringify(root);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(root);
  }
  return unique;
}

/** Union of query roots for the given kinds, in first-seen order. */
export function queryRootsForKinds(kinds: Iterable<RealtimeEntityKind>): QueryKey[] {
  const roots: QueryKey[] = [];
  for (const kind of kinds) {
    roots.push(...ENTITY_QUERY_ROOTS[kind]);
  }
  return dedupeRoots(roots);
}

/** Every root in the map — what a reconnect refreshes to catch up on missed events. */
export function allEntityQueryRoots(): QueryKey[] {
  return queryRootsForKinds(REALTIME_ENTITY_KINDS);
}

/** Known kinds from an `entity-changed` payload; malformed data yields none. */
export function parseEntityChangedKinds(data: unknown): RealtimeEntityKind[] {
  if (typeof data !== "string") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }

  const entities = (parsed as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(entities)) return [];

  return [...new Set(entities.filter(isRealtimeEntityKind))];
}
