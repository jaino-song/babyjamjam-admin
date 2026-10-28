"use client";

import { useEffect } from "react";
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
 * `enabled` should be the current authentication state — pass `false` to skip
 * connecting (e.g. before the user has logged in).
 */
export function useRealtimeInvalidation(enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let followUpTimer: number | null = null;
    let bootstrapController: AbortController | null = null;
    let disposed = false;
    let connecting = false;
    let hasConnectedOnce = false;
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

    // Coalesced: a burst of events yields one trailing pass over the union of
    // their roots, measured from the last event.
    const scheduleFollowUp = (roots: readonly QueryKey[]) => {
      pendingFollowUpRoots = [...pendingFollowUpRoots, ...roots];
      clearFollowUpTimer();
      followUpTimer = window.setTimeout(() => {
        followUpTimer = null;
        const roots = pendingFollowUpRoots;
        pendingFollowUpRoots = [];
        invalidateRoots(roots);
      }, FOLLOW_UP_INVALIDATE_MS);
    };

    async function connect() {
      if (disposed || source || connecting) return;

      connecting = true;
      const controller = new AbortController();
      bootstrapController = controller;

      try {
        const next = await openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal });
        if (disposed || controller.signal.aborted) {
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
        source = null;
        // Session refresh failed or the request was aborted; retry unless we
        // were torn down.
        if (!disposed && !controller.signal.aborted) {
          scheduleReconnect(RECONNECT_DELAY_MS);
        }
      } finally {
        connecting = false;
        if (bootstrapController === controller) {
          bootstrapController = null;
        }
      }
    }

    const handleVisibilityChange = () => {
      if (disposed || document.visibilityState !== "visible") return;
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
      bootstrapController?.abort();
      closeSource();
    };
  }, [enabled, queryClient]);
}
