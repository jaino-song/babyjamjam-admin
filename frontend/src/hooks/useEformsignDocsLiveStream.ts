"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const ENDPOINT = "/api/eformsign-docs/events";

// After an error, wait this long before reopening — avoids a tight reconnect
// loop while the upstream is briefly unavailable.
const RECONNECT_DELAY_MS = 3000;
// Backend sends a `ping` every 30s. If we hear nothing (ping or docs-changed)
// for this long, the stream is silently dead (e.g. the Vercel function that
// proxies it hit its duration limit and was killed without firing `error`).
const HEARTBEAT_TIMEOUT_MS = 70_000;

const DOCS_QUERY_KEY = ["eformsign-documents"] as const;
const CLIENT_NAMES_QUERY_KEY = ["eformsign-client-names"] as const;

/**
 * Subscribes to the backend's SSE stream of eformsign-docs mutations.
 *
 * On every `docs-changed` event, invalidates the contracts list + client-name
 * caches so the list-panel refetches without a full page reload.
 *
 * Resilient by design — a single owned connection that re-establishes itself
 * when it drops, so a long-lived tab keeps receiving live updates:
 * - `error` → reopen after a short delay.
 * - no `ping`/data within {@link HEARTBEAT_TIMEOUT_MS} → treat as silently dead
 *   and reopen (catches proxy/function timeouts that never fire `error`).
 * - tab becomes visible again while not open → reopen immediately.
 * All three triggers funnel through one reconnect path, guarded so there is
 * only ever one connection and one pending timer — no overlapping sources or
 * reconnect storms. After a *re*open succeeds, caches are invalidated once to
 * catch up on any change missed while the stream was down.
 *
 * `enabled` should be the current authentication state — pass `false` to skip
 * connecting (e.g. before the user has logged in).
 */
export function useEformsignDocsLiveStream(enabled: boolean): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
            return;
        }

        let source: EventSource | null = null;
        let reconnectTimer: number | null = null;
        let heartbeatTimer: number | null = null;
        let disposed = false;
        let hasConnectedOnce = false;

        const invalidate = () => {
            void queryClient.invalidateQueries({ queryKey: DOCS_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: CLIENT_NAMES_QUERY_KEY });
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

        const closeSource = () => {
            if (source) {
                source.close();
                source = null;
            }
        };

        // Restart the dead-connection watchdog. Called on every inbound message
        // (open/ping/docs-changed) so a healthy stream never trips it.
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
                    invalidate();
                }
                hasConnectedOnce = true;
                resetHeartbeat();
            });

            next.addEventListener("docs-changed", () => {
                if (source !== next) return;
                resetHeartbeat();
                invalidate();
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
            closeSource();
        };
    }, [enabled, queryClient]);
}
