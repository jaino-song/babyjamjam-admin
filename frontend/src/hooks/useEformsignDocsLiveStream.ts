"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { redirectToLoginOnce } from "@/lib/api/client";
import {
    AuthSessionEndedError,
    createReconnectBackoff,
    openAuthenticatedEventSource,
} from "@/lib/realtime/authenticated-event-source";

const ENDPOINT = "/api/eformsign-docs/events";

// Backend sends a `ping` every 30s. If we hear nothing (ping or docs-changed)
// for this long, the stream is silently dead (e.g. the Vercel function that
// proxies it hit its duration limit and was killed without firing `error`).
const HEARTBEAT_TIMEOUT_MS = 70_000;

const DOCS_QUERY_KEY = ["eformsign-documents"] as const;
const CLIENT_NAMES_QUERY_KEY = ["eformsign-client-names"] as const;
const STATUS_COUNTS_QUERY_KEY = ["eformsign-status-counts"] as const;

/**
 * Subscribes to the backend's SSE stream of eformsign-docs mutations.
 *
 * On every `docs-changed` event, invalidates the contracts list + client-name
 * caches so the list-panel refetches without a full page reload.
 *
 * Resilient by design — a single owned connection that re-establishes itself
 * when it drops, so a long-lived tab keeps receiving live updates:
 * - `error` → reopen after a short delay (3 s, doubling to 60 s while it keeps failing).
 * - no `ping`/data within {@link HEARTBEAT_TIMEOUT_MS} → treat as silently dead
 *   and reopen (catches proxy/function timeouts that never fire `error`).
 * - tab becomes visible again while not open → reopen immediately.
 * All three triggers funnel through one reconnect path, guarded so there is
 * only ever one connection and one pending timer — no overlapping sources or
 * reconnect storms. After a *re*open succeeds, caches are invalidated once to
 * catch up on any change missed while the stream was down.
 *
 * The first connect is a plain EventSource; every reconnect goes through
 * `openAuthenticatedEventSource`, which refreshes an expired access token first
 * (a bare EventSource can't read the 401). A refresh rejected with 401 ends the
 * session: reconnecting stops and the user is sent to login.
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
        // The attempt currently awaiting its authenticated opener; null when idle.
        let attemptController: AbortController | null = null;
        let disposed = false;
        // The session ended: no more reconnects, whatever triggers them.
        let stopped = false;
        // Set once a reconnect has been scheduled, so the next `open` catches up
        // on changes missed while the stream was down.
        let needsCatchUp = false;
        const backoff = createReconnectBackoff();

        const invalidate = () => {
            void queryClient.invalidateQueries({ queryKey: DOCS_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: CLIENT_NAMES_QUERY_KEY });
            void queryClient.invalidateQueries({ queryKey: STATUS_COUNTS_QUERY_KEY });
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

        // The single reconnect path. error / heartbeat / visibility all funnel
        // here; the `reconnectTimer` guard collapses concurrent triggers into
        // one reconnect, so we never end up with overlapping sources or timers.
        // `backoff` is for failures (error, probe trouble); `immediate` skips the
        // delay and leaves the backoff untouched — it also pre-empts a pending
        // backoff timer, so a tab coming back to the foreground doesn't wait out
        // a delay that has grown to a minute.
        const scheduleReconnect = (mode: "backoff" | "immediate") => {
            if (disposed || stopped) return;
            if (reconnectTimer !== null) {
                if (mode === "backoff") return;
                clearReconnectTimer();
            }
            closeSource();
            clearHeartbeatTimer();
            needsCatchUp = true;
            const delayMs = mode === "backoff" ? backoff.nextDelay() : 0;
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                void reconnect();
            }, delayMs);
        };

        // Restart the dead-connection watchdog. Called on every inbound message
        // (open/ping/docs-changed) so a healthy stream never trips it.
        function resetHeartbeat() {
            clearHeartbeatTimer();
            heartbeatTimer = window.setTimeout(() => {
                heartbeatTimer = null;
                scheduleReconnect("immediate");
            }, HEARTBEAT_TIMEOUT_MS);
        }

        function attach(next: EventSource) {
            source = next;

            next.addEventListener("open", () => {
                if (source !== next) return;
                backoff.reset();
                if (needsCatchUp) {
                    // Reopened after a gap — catch up on anything missed.
                    needsCatchUp = false;
                    invalidate();
                }
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
                scheduleReconnect("backoff");
            });

            // Arm the watchdog even before `open`, so a connection that never
            // opens still triggers a reconnect.
            resetHeartbeat();
        }

        async function reconnect() {
            if (disposed || stopped || source || attemptController !== null) return;

            const controller = new AbortController();
            attemptController = controller;
            // A probe may resolve after unmount or a newer attempt; only the
            // attempt that still owns the connection may open a source or touch
            // this closure's state.
            const owns = () => !disposed && !controller.signal.aborted && attemptController === controller;

            try {
                const next = await openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal });
                if (!owns()) {
                    next.close();
                    return;
                }
                attach(next);
            } catch (error) {
                if (!owns()) return;
                if (error instanceof AuthSessionEndedError) {
                    stopped = true;
                    clearHeartbeatTimer();
                    void redirectToLoginOnce();
                    return;
                }
                scheduleReconnect("backoff");
            } finally {
                if (attemptController === controller) attemptController = null;
            }
        }

        const handleVisibilityChange = () => {
            if (disposed || stopped || document.visibilityState !== "visible") return;
            // A probe is already in flight (bounded by its own timeout); starting
            // another would overlap it.
            if (attemptController !== null) return;
            if (source && source.readyState === EventSource.OPEN) return;
            // Back on the tab and the stream isn't open — reconnect now.
            scheduleReconnect("immediate");
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        // Fresh page load: the middleware just issued current cookies, so open
        // directly. Only reconnects pay for the auth probe.
        attach(new EventSource(ENDPOINT));

        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearReconnectTimer();
            clearHeartbeatTimer();
            attemptController?.abort();
            closeSource();
        };
    }, [enabled, queryClient]);
}
