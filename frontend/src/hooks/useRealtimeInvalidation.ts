"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { allQueryKeyRoots, queryKeyRootsForKinds } from "@/lib/realtime/entity-query-keys";

const ENDPOINT = "/api/realtime/events";

// After an error, wait this long before reopening — avoids a tight reconnect
// loop while the upstream is briefly unavailable.
const RECONNECT_DELAY_MS = 3000;
// Backend sends a `ping` every 30s. If we hear nothing for this long, the
// stream is silently dead (e.g. the Vercel function proxying it hit its
// duration limit and was killed without firing `error`).
const HEARTBEAT_TIMEOUT_MS = 70_000;
// The server coalesces changes for ~300 ms, but a transaction can still commit
// after that window. One more refresh this long after an event picks those up.
const TRAILING_REFRESH_DELAY_MS = 1500;

function parseKinds(data: unknown): unknown[] {
    if (typeof data !== "string") return [];
    try {
        const parsed: unknown = JSON.parse(data);
        const entities = (parsed as { entities?: unknown } | null)?.entities;
        return Array.isArray(entities) ? entities : [];
    } catch {
        return [];
    }
}

/**
 * Subscribes to the backend's branch-scoped `entity-changed` stream and
 * invalidates the TanStack Query roots that belong to the changed entity kinds,
 * so every list refreshes without a reload — whoever made the change.
 *
 * Mirrors {@link useEformsignDocsLiveStream}'s resilience: one owned connection
 * that reopens on error, on a silent ~70 s stall, and when the tab becomes
 * visible again; after any *re*open every known root is invalidated once to
 * catch up on changes missed while the stream was down.
 *
 * `identity` is the authenticated user + selected branch. The stream is scoped
 * to that identity on the server, so a change (in-app branch switch keeps the
 * layout mounted) closes the old source and opens a new one immediately instead
 * of staying subscribed to the previous branch until the proxy deadline.
 *
 * Each event invalidates immediately and again after
 * {@link TRAILING_REFRESH_DELAY_MS}; events arriving inside that window share
 * one trailing refresh covering the union of their kinds.
 */
export function useRealtimeInvalidation(enabled = true, identity: string | null = null): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
            return;
        }

        let source: EventSource | null = null;
        let reconnectTimer: number | null = null;
        let heartbeatTimer: number | null = null;
        let trailingTimer: number | null = null;
        let pendingKinds = new Set<unknown>();
        let disposed = false;
        let hasConnectedOnce = false;

        const invalidateRoots = (roots: QueryKey[]) => {
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

        const clearTrailingTimer = () => {
            if (trailingTimer !== null) {
                window.clearTimeout(trailingTimer);
                trailingTimer = null;
            }
        };

        const closeSource = () => {
            if (source) {
                source.close();
                source = null;
            }
        };

        const handleEntityChanged = (data: unknown) => {
            const kinds = parseKinds(data);
            const roots = queryKeyRootsForKinds(kinds);
            if (roots.length === 0) return;

            invalidateRoots(roots);

            for (const kind of kinds) pendingKinds.add(kind);
            if (trailingTimer !== null) return;
            trailingTimer = window.setTimeout(() => {
                trailingTimer = null;
                const trailingRoots = queryKeyRootsForKinds(pendingKinds);
                pendingKinds = new Set();
                invalidateRoots(trailingRoots);
            }, TRAILING_REFRESH_DELAY_MS);
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
        // here; the `reconnectTimer` guard collapses concurrent triggers into
        // one reconnect, so we never end up with overlapping sources or timers.
        const scheduleReconnect = (delayMs: number) => {
            if (disposed || reconnectTimer !== null) return;
            closeSource();
            clearHeartbeatTimer();
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, delayMs);
        };

        function connect() {
            if (disposed || source) return;

            const next = new EventSource(ENDPOINT);
            source = next;

            next.addEventListener("open", () => {
                if (source !== next) return;
                if (hasConnectedOnce) {
                    // Reopened after a gap — catch up on anything missed.
                    invalidateRoots(allQueryKeyRoots());
                }
                hasConnectedOnce = true;
                resetHeartbeat();
            });

            next.addEventListener("entity-changed", (event) => {
                if (source !== next) return;
                resetHeartbeat();
                handleEntityChanged((event as MessageEvent).data);
            });

            next.addEventListener("ping", () => {
                if (source !== next) return;
                resetHeartbeat();
            });

            next.addEventListener("error", () => {
                if (source !== next) return;
                scheduleReconnect(RECONNECT_DELAY_MS);
            });

            // Arm the watchdog even before `open`, so a connection that never
            // opens still triggers a reconnect.
            resetHeartbeat();
        }

        const handleVisibilityChange = () => {
            if (disposed || document.visibilityState !== "visible") return;
            if (source && source.readyState === EventSource.OPEN) return;
            // Back on the tab and the stream isn't open — reconnect now.
            scheduleReconnect(0);
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        connect();

        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearReconnectTimer();
            clearHeartbeatTimer();
            clearTrailingTimer();
            closeSource();
        };
    }, [enabled, identity, queryClient]);
}
