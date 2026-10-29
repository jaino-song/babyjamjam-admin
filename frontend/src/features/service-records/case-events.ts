import { redirectToLoginOnce } from "@/lib/api/client";
import {
    AuthSessionEndedError,
    createReconnectBackoff,
    openAuthenticatedEventSource,
} from "@/lib/realtime/authenticated-event-source";

import type { ServiceRecordRevisionSyncEvent } from "./revision-sync";

export const SERVICE_RECORD_CASE_EVENTS_URL = "/api/admin/service-records/events";
export const SERVICE_RECORD_CASE_CHANGED_EVENT = "case-changed";

/** Payload of a `case-changed` server event (`clientId` is not needed by the editor). */
export type ServiceRecordCaseChangedEvent = ServiceRecordRevisionSyncEvent;

function parseCaseChanged(data: unknown): ServiceRecordCaseChangedEvent | null {
    if (typeof data !== "string") return null;
    let payload: unknown;
    try {
        payload = JSON.parse(data);
    } catch {
        return null;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
    const { caseId, caseVersion } = payload as { caseId?: unknown; caseVersion?: unknown };
    if (typeof caseId !== "string" || caseId.length === 0) return null;
    if (typeof caseVersion !== "number" || !Number.isSafeInteger(caseVersion) || caseVersion < 0) return null;
    return { caseId, caseVersion };
}

/**
 * Subscribe to "a service-record case was confirmed" server events. The proxy
 * closes its stream before the platform limit and the server keeps no history,
 * so a change emitted while the stream is down is lost. `onOpen` fires on the
 * first open and on every reconnect, letting the caller catch up on what it
 * missed.
 *
 * Reconnecting is managed here, not left to the browser: a native EventSource
 * that hits a 401 (expired access token) goes CLOSED and never retries. On an
 * `error` the source is closed and reopened through
 * `openAuthenticatedEventSource`, which refreshes the session first, with
 * 3 s → 60 s backoff while it keeps failing. A refresh rejected with 401 ends
 * the session: reconnecting stops and the user is sent to login.
 * Returns an unsubscribe.
 */
export function subscribeServiceRecordCaseChanges(
    listener: (event: ServiceRecordCaseChangedEvent) => void,
    onOpen?: () => void,
): () => void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
        return () => undefined;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // The attempt currently awaiting its authenticated opener; null when idle.
    let attemptController: AbortController | null = null;
    let disposed = false;
    const backoff = createReconnectBackoff();

    const closeSource = () => {
        if (source) {
            source.close();
            source = null;
        }
    };

    const scheduleReconnect = () => {
        if (disposed || reconnectTimer !== null) return;
        closeSource();
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void reconnect();
        }, backoff.nextDelay());
    };

    const attach = (next: EventSource) => {
        source = next;
        next.addEventListener(SERVICE_RECORD_CASE_CHANGED_EVENT, (event: Event) => {
            if (source !== next) return;
            const parsed = parseCaseChanged((event as MessageEvent<unknown>).data);
            if (parsed) listener(parsed);
        });
        next.addEventListener("open", () => {
            if (source !== next) return;
            backoff.reset();
            onOpen?.();
        });
        next.addEventListener("error", () => {
            if (source !== next) return;
            scheduleReconnect();
        });
    };

    const reconnect = async () => {
        if (disposed || source || attemptController !== null) return;

        const controller = new AbortController();
        attemptController = controller;
        // A probe may resolve after unsubscribe; only an attempt that still owns
        // the connection may open a source.
        const owns = () => !disposed && !controller.signal.aborted && attemptController === controller;

        try {
            const next = await openAuthenticatedEventSource(SERVICE_RECORD_CASE_EVENTS_URL, {
                signal: controller.signal,
            });
            if (!owns()) {
                next.close();
                return;
            }
            attach(next);
        } catch (error) {
            if (!owns()) return;
            if (error instanceof AuthSessionEndedError) {
                void redirectToLoginOnce();
                return;
            }
            scheduleReconnect();
        } finally {
            if (attemptController === controller) attemptController = null;
        }
    };

    // First connect: the page was just served with current cookies, so open directly.
    attach(new EventSource(SERVICE_RECORD_CASE_EVENTS_URL));

    return () => {
        disposed = true;
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        attemptController?.abort();
        closeSource();
    };
}
