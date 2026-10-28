"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { openAuthenticatedEventSource } from "@/lib/api/authenticated-fetch";
import {
  allEntityQueryRoots,
  parseEntityChangedKinds,
  queryRootsForKinds,
} from "@/lib/realtime/entity-query-keys";

const ENDPOINT = "/api/realtime/events";

// After an error, wait this long before reopening — avoids a tight reconnect
// loop while the upstream is briefly unavailable.
const RECONNECT_DELAY_MS = 3000;
// Backend sends a `ping` every 30s. If we hear nothing (ping or entity-changed)
// for this long, the stream is silently dead (e.g. the function that proxies it
// hit its duration limit and was killed without firing `error`).
const HEARTBEAT_TIMEOUT_MS = 70_000;
// The auth bootstrap inside `openAuthenticatedEventSource` (a /api/auth/me fetch,
// possibly followed by a session refresh) normally takes milliseconds. The
// watchdog above only starts once a source exists, so a bootstrap that never
// settles would stall the hook forever; abort it after this long and retry.
const BOOTSTRAP_TIMEOUT_MS = 20_000;
// The backend emits right after its transaction commits, but a list refetch that
// lands before a read replica / cache catches up would store the old rows. One
// more pass shortly after settles that.
const FOLLOW_UP_INVALIDATE_MS = 1500;

/**
 * App-wide server push: refreshes cached lists when another staff member (or a
 * background job) changes a watched entity, so no screen waits for polling or a
 * manual reload.
 *
 * On every `entity-changed` event the query roots of the named kinds are
 * invalidated immediately and once more after {@link FOLLOW_UP_INVALIDATE_MS}.
 * The event carries kinds only, never row data, so nothing is read from it
 * beyond which roots to refetch; unknown kinds are ignored.
 *
 * Resilient by design — a single owned connection that re-establishes itself
 * when it drops (same shape as the eformsign docs stream on desktop):
 * - `error` → reopen after a short delay.
 * - no `ping`/data within {@link HEARTBEAT_TIMEOUT_MS} → treat as silently dead
 *   and reopen.
 * - tab becomes visible again while not open → reopen immediately.
 * All three funnel through one reconnect path guarded so there is only ever one
 * connection and one pending timer. After a *re*open succeeds every mapped root
 * is invalidated once to catch up on changes missed while the stream was down.
 *
 * The stream is opened through `openAuthenticatedEventSource`, which refreshes
 * an expired session first — a bare `EventSource` cannot do that.
 *
 * A bootstrap that never settles is aborted after {@link BOOTSTRAP_TIMEOUT_MS}
 * and retried on the normal reconnect delay; if the abandoned opener resolves
 * late, its source is closed on arrival so only one live source ever exists.
 *
 * `identity` names who the stream belongs to (user + branch) and is part of the
 * subscription: `null` skips connecting (e.g. before the user has logged in),
 * and a change closes the old stream and opens a new one for the new identity —
 * a stream is branch-scoped server-side, so it must never outlive a switch. The
 * first open after such a change refreshes every mapped root, because the cache
 * still holds the previous identity's rows.
 */
export function useRealtimeInvalidation(identity: string | null): void {
  const queryClient = useQueryClient();
  const lastIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    const previousIdentity = lastIdentityRef.current;
    lastIdentityRef.current = identity;

    if (identity === null || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let followUpTimer: number | null = null;
    let bootstrapTimer: number | null = null;
    // The attempt currently awaiting its authenticated opener; null when idle.
    let bootstrapController: AbortController | null = null;
    let disposed = false;
    let hasConnectedOnce = previousIdentity !== null && previousIdentity !== identity;
    // Roots from events still waiting for their follow-up pass.
    let pendingFollowUpRoots: QueryKey[] = [];

    const invalidateRoots = (roots: readonly QueryKey[]) => {
      for (const queryKey of roots) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const clearHeartbeatTimer = () => {
      if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const clearFollowUpTimer = () => {
      if (followUpTimer !== null) {
        window.clearTimeout(followUpTimer);
        followUpTimer = null;
      }
    };

    const clearBootstrapTimer = () => {
      if (bootstrapTimer !== null) {
        window.clearTimeout(bootstrapTimer);
        bootstrapTimer = null;
      }
    };

    const closeSource = () => {
      if (source) {
        source.close();
        source = null;
      }
    };

    // Restart the dead-connection watchdog. Called on every inbound message
    // (open/ping/entity-changed) so a healthy stream never trips it.
    const resetHeartbeat = () => {
      clearHeartbeatTimer();
      heartbeatTimer = window.setTimeout(() => {
        heartbeatTimer = null;
        scheduleReconnect(0);
      }, HEARTBEAT_TIMEOUT_MS);
    };

    // The single reconnect path. error / heartbeat / visibility all funnel
    // here; the `reconnectTimer` guard collapses concurrent triggers into one
    // reconnect, so we never end up with overlapping sources or timers.
    const scheduleReconnect = (delayMs: number) => {
      if (disposed || reconnectTimer !== null) return;
      closeSource();
      clearHeartbeatTimer();
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delayMs);
    };

    // Coalesced with a fixed window: the first event of a burst arms one
    // trailing pass FOLLOW_UP_INVALIDATE_MS later; further events inside the
    // window only add their roots (de-duplicated by root key) and never move the
    // timer, so a steady stream cannot postpone the pass indefinitely. Once it
    // fires, the next event starts a new window.
    const scheduleFollowUp = (roots: readonly QueryKey[]) => {
      for (const root of roots) {
        const id = JSON.stringify(root);
        if (!pendingFollowUpRoots.some((pending) => JSON.stringify(pending) === id)) {
          pendingFollowUpRoots.push(root);
        }
      }
      if (followUpTimer !== null) return;
      followUpTimer = window.setTimeout(() => {
        followUpTimer = null;
        const trailingRoots = pendingFollowUpRoots;
        pendingFollowUpRoots = [];
        invalidateRoots(trailingRoots);
      }, FOLLOW_UP_INVALIDATE_MS);
    };

    async function connect() {
      if (disposed || source || bootstrapController !== null) return;

      const controller = new AbortController();
      bootstrapController = controller;
      // An attempt may only touch the hook's shared state while it still owns
      // the connection. Once retired (timeout) or torn down (unmount) it is
      // inert: its late resolve or reject must not overwrite the replacement's
      // `source`, timers or controller.
      const owns = () =>
        !disposed && !controller.signal.aborted && bootstrapController === controller;
      bootstrapTimer = window.setTimeout(() => {
        if (!owns()) return;
        bootstrapTimer = null;
        // Retire the stalled attempt: aborting makes a late-resolving opener's
        // source get closed below, and freeing the slot lets the retry proceed.
        controller.abort();
        bootstrapController = null;
        scheduleReconnect(RECONNECT_DELAY_MS);
      }, BOOTSTRAP_TIMEOUT_MS);

      try {
        const next = await openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal });
        if (!owns()) {
          next.close();
          return;
        }
        source = next;

        next.addEventListener("open", () => {
          if (source !== next) return;
          if (hasConnectedOnce) {
            // Reopened after a gap — catch up on anything missed.
            invalidateRoots(allEntityQueryRoots());
          }
          hasConnectedOnce = true;
          resetHeartbeat();
        });

        next.addEventListener("entity-changed", (event) => {
          if (source !== next) return;
          resetHeartbeat();
          const roots = queryRootsForKinds(
            parseEntityChangedKinds((event as MessageEvent).data),
          );
          if (roots.length === 0) return;
          invalidateRoots(roots);
          scheduleFollowUp(roots);
        });

        next.addEventListener("ping", () => {
          if (source !== next) return;
          resetHeartbeat();
        });

        next.addEventListener("error", () => {
          if (source !== next) return;
          scheduleReconnect(RECONNECT_DELAY_MS);
        });

        // Arm the watchdog even before `open`, so a connection that never opens
        // still triggers a reconnect.
        resetHeartbeat();
      } catch {
        // A retired or torn-down attempt rejects when its abort propagates (or
        // its stalled refresh finally fails); the replacement already owns the
        // connection, so leave everything alone.
        if (!owns()) return;
        // Session refresh failed: drop any half-set-up source and retry.
        closeSource();
        scheduleReconnect(RECONNECT_DELAY_MS);
      } finally {
        if (bootstrapController === controller) {
          bootstrapController = null;
          clearBootstrapTimer();
        }
      }
    }

    const handleVisibilityChange = () => {
      if (disposed || document.visibilityState !== "visible") return;
      // A bootstrap is already in flight (bounded by its own timeout); starting
      // another would overlap it.
      if (bootstrapController !== null) return;
      if (source && source.readyState === EventSource.OPEN) return;
      // Back on the tab and the stream isn't open — reconnect now.
      scheduleReconnect(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void connect();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearReconnectTimer();
      clearHeartbeatTimer();
      clearFollowUpTimer();
      pendingFollowUpRoots = [];
      clearBootstrapTimer();
      bootstrapController?.abort();
      closeSource();
    };
  }, [identity, queryClient]);
}
