import { QueryClient, type QueryKey } from "@tanstack/react-query";

import { queryRootsForKinds } from "@/lib/realtime/entity-query-keys";
import { clientKeys } from "@/features/clients/hooks/keys";

/**
 * SI-CONTRACT-08 — contract state → client list refresh on mobile.
 *
 * The backend announces contract writes as the realtime kind `document`; the
 * mobile client list renders that state (`documentStatus`, `hasSigned` on the
 * client type). These tests assert which roots a `document` entity-changed
 * event refreshes, with a real QueryClient.
 */

const INTEGRITY_ID_PATTERN = /^SI-[A-Z]+-[0-9]{2}$/;

type IntegrityTestBody = () => Promise<void>;

function qualified(id: string, title: string): string {
  if (!INTEGRITY_ID_PATTERN.test(id)) {
    throw new Error(`integrity test id must match SI-<AREA>-<NN>, got "${id}"`);
  }
  return `${id} ${title}`;
}

/** An invariant that must hold today: a plain `it` with the id prefix. */
function invariant(id: string, title: string, body: IntegrityTestBody): void {
  it(qualified(id, title), body);
}

describe("SI-CONTRACT-08 contract state → client view refresh (mobile)", () => {
  invariant(
    "SI-CONTRACT-08",
    "a `document` entity-changed event refreshes the mobile client list that renders contract state",
    async () => {
      const queryClient = new QueryClient();
      // What `useRealtimeInvalidation` does for the backend hint
      // `{ entities: ["document"] }` — invalidate the mapped roots.
      const roots = queryRootsForKinds(["document"]);

      queryClient.setQueryData(clientKeys.list({ page: 1, limit: 20 }), "cached");
      for (const root of roots) {
        void queryClient.invalidateQueries({ queryKey: root });
      }

      const state = queryClient.getQueryState(clientKeys.list({ page: 1, limit: 20 }) as QueryKey);
      if (state === undefined) {
        throw new Error("SI-CONTRACT-08: the mobile clients list cache entry disappeared entirely");
      }
      if (!state.isInvalidated) {
        throw new Error(
          "SI-CONTRACT-08: the mobile clients list query was NOT invalidated by a `document` entity-changed event (its contract state went stale)",
        );
      }
    },
  );

  invariant(
    "SI-CONTRACT-08",
    "(control) the `client` entity-changed kind still refreshes the mobile clients root",
    async () => {
      const roots = queryRootsForKinds(["client"]);
      expect(roots.some((root) => root[0] === "clients")).toBe(true);
    },
  );
});
