"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

import { redirectToLoginOnce } from "@/lib/api/client";
import {
    AuthSessionEndedError,
    createReconnectBackoff,
    openAuthenticatedEventSource,
} from "@/lib/realtime/authenticated-event-source";
import { allQueryKeyRoots, queryKeyRootsForKinds } from "@/lib/realtime/entity-query-keys";

const ENDPOINT = "/api/realtime/events";

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
 * The first connect is a plain EventSource (the middleware just issued fresh
 * cookies). Every reconnect goes through `openAuthenticatedEventSource`, which
 * refreshes an expired access token first — a bare EventSource can't read the
 * 401, so without it the stream would retry against an expired cookie forever.
 * Consecutive failures back off 3 s → 60 s; a refresh rejected with 401 ends
 * the session, so reconnecting stops and the user is sent to login.
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
        // The attempt currently awaiting its authenticated opener; null when idle.
        let attemptController: AbortController | null = null;
        let pendingKinds = new Set<unknown>();
        let disposed = false;
        // The session ended: no more reconnects, whatever triggers them.
        let stopped = false;
        // Set once a reconnect has been scheduled, so the next `open` catches up
        // on changes missed while the stream was down.
        let needsCatchUp = false;
        const backoff = createReconnectBackoff();

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
        // (open/ping/entity-changed) so a healthy stream never trips it.
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
                    invalidateRoots(allQueryKeyRoots());
                }
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
            // A probe may resolve after unmount, an identity change or a newer
            // attempt; only the attempt that still owns the connection may open
            // a source or touch this closure's state.
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
            clearTrailingTimer();
            attemptController?.abort();
            closeSource();
        };
    }, [enabled, identity, queryClient]);
}
