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
// A resuming reconnect waits this long after `open` for the backend's `ready`
// marker. A backend that never sends one (old version, rollback) can't have
// honoured the cursor, so silence means "catch up the slow way".
const READY_TIMEOUT_MS = 5000;
// Contract: an opaque cursor is at most 64 chars of [0-9A-Za-z:._-]. Anything
// else is never remembered, so it can never be echoed back.
const CURSOR_PATTERN = /^[0-9A-Za-z:._-]{1,64}$/;

function isValidCursor(id: unknown): id is string {
    return typeof id === "string" && CURSOR_PATTERN.test(id);
}

function parseResumed(data: unknown): boolean {
    if (typeof data !== "string") return false;
    try {
        const parsed: unknown = JSON.parse(data);
        return (parsed as { resumed?: unknown } | null)?.resumed === true;
    } catch {
        return false;
    }
}

// What one connection still owes the catch-up decision. A reopen that sent no
// cursor needs nothing here (it already invalidated everything on `open`).
interface Connection {
    // This connection has delivered `ready`: only then are its ids real cursors.
    ready: boolean;
    // Reopened with a cursor and not yet told whether the backend honoured it.
    awaitingResume: boolean;
}

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
 * visible again. A reconnect echoes the last cursor the backend gave us
 * (`?since=`); when the backend's `ready` says it resumed, the missed changes
 * arrive as ordinary `entity-changed` events and nothing else is refetched.
 * Every other reopen (no cursor, `resumed: false`, no `ready` — an old
 * backend — or a mid-stream `reset`) invalidates every known root once.
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
        // Last cursor handed to us by a `ready`-bearing connection. Lives in this
        // effect, so an identity change (logout, branch switch) starts clean.
        let cursor: string | null = null;
        let readyTimer: number | null = null;
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

        const clearReadyTimer = () => {
            if (readyTimer !== null) {
                window.clearTimeout(readyTimer);
                readyTimer = null;
            }
        };

        const clearTrailingTimer = () => {
            if (trailingTimer !== null) {
                window.clearTimeout(trailingTimer);
                trailingTimer = null;
            }
        };

        const closeSource = () => {
            clearReadyTimer();
            if (source) {
                source.close();
                source = null;
            }
        };

        // Resolves a resuming reconnect's pending catch-up decision, at most once
        // per connection: a full invalidation (backend could not resume) or none.
        const settleResume = (state: Connection, fullInvalidation: boolean) => {
            if (!state.awaitingResume) return;
            state.awaitingResume = false;
            clearReadyTimer();
            if (fullInvalidation) invalidateRoots(allQueryKeyRoots());
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

        // `sentCursor` is the `since` this connection was opened with (null for
        // the first connect and for reconnects that had nothing to resume from).
        function attach(next: EventSource, sentCursor: string | null) {
            source = next;
            const state: Connection = { ready: false, awaitingResume: false };

            // Only a connection that has delivered `ready` is a new backend; ids on
            // any other are Nest's per-connection auto ids (1, 2, 3…) and must
            // never become a cursor.
            const remember = (event: Event) => {
                if (!state.ready) return;
                const id = (event as MessageEvent).lastEventId;
                if (isValidCursor(id)) cursor = id;
            };

            next.addEventListener("open", () => {
                if (source !== next) return;
                backoff.reset();
                if (needsCatchUp) {
                    // Reopened after a gap. Without a cursor nothing can be
                    // replayed, so refresh everything now; with one, wait for the
                    // backend to say whether it resumed.
                    needsCatchUp = false;
                    if (sentCursor === null) {
                        invalidateRoots(allQueryKeyRoots());
                    } else {
                        state.awaitingResume = true;
                        clearReadyTimer();
                        readyTimer = window.setTimeout(() => {
                            readyTimer = null;
                            settleResume(state, true);
                        }, READY_TIMEOUT_MS);
                    }
                }
                resetHeartbeat();
            });

            next.addEventListener("ready", (event) => {
                if (source !== next) return;
                resetHeartbeat();
                state.ready = true;
                // `resumed: true` only when the cursor was honoured and the
                // missed batches follow as replayed `entity-changed` events.
                settleResume(state, !parseResumed((event as MessageEvent).data));
                remember(event);
            });

            next.addEventListener("entity-changed", (event) => {
                if (source !== next) return;
                resetHeartbeat();
                // A resuming connection whose first message isn't `ready` is an
                // old backend: it ignored the cursor.
                settleResume(state, true);
                remember(event);
                handleEntityChanged((event as MessageEvent).data);
            });

            next.addEventListener("ping", (event) => {
                if (source !== next) return;
                resetHeartbeat();
                settleResume(state, true);
                remember(event);
            });

            next.addEventListener("reset", (event) => {
                if (source !== next) return;
                resetHeartbeat();
                // Continuity is lost: one full invalidation, whether it settles a
                // pending resume or arrives mid-stream.
                if (state.awaitingResume) {
                    settleResume(state, true);
                } else {
                    invalidateRoots(allQueryKeyRoots());
                }
                remember(event);
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
            const sentCursor = cursor;
            // A probe may resolve after unmount, an identity change or a newer
            // attempt; only the attempt that still owns the connection may open
            // a source or touch this closure's state.
            const owns = () => !disposed && !controller.signal.aborted && attemptController === controller;

            try {
                const url = sentCursor === null ? ENDPOINT : `${ENDPOINT}?since=${encodeURIComponent(sentCursor)}`;
                const next = await openAuthenticatedEventSource(url, { signal: controller.signal });
                if (!owns()) {
                    next.close();
                    return;
                }
                attach(next, sentCursor);
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
        attach(new EventSource(ENDPOINT), null);

        return () => {
            disposed = true;
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            clearReconnectTimer();
            clearHeartbeatTimer();
            clearTrailingTimer();
            clearReadyTimer();
            attemptController?.abort();
            closeSource();
        };
    }, [enabled, identity, queryClient]);
}
