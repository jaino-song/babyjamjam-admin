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
 * Subscribe to "a service-record case was confirmed" server events. The browser
 * reconnects a dropped EventSource by itself (the proxy closes its stream
 * before the platform limit), but the server keeps no history, so a change
 * emitted during the reconnect gap is lost. `onOpen` fires on the first open
 * and on every reconnect, letting the caller catch up on what it missed.
 * Returns an unsubscribe.
 */
export function subscribeServiceRecordCaseChanges(
    listener: (event: ServiceRecordCaseChangedEvent) => void,
    onOpen?: () => void,
): () => void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
        return () => undefined;
    }

    const source = new EventSource(SERVICE_RECORD_CASE_EVENTS_URL);
    const handleMessage = (event: Event) => {
        const parsed = parseCaseChanged((event as MessageEvent<unknown>).data);
        if (parsed) listener(parsed);
    };
    const handleOpen = () => onOpen?.();
    source.addEventListener(SERVICE_RECORD_CASE_CHANGED_EVENT, handleMessage);
    source.addEventListener("open", handleOpen);

    return () => {
        source.removeEventListener("open", handleOpen);
        source.removeEventListener(SERVICE_RECORD_CASE_CHANGED_EVENT, handleMessage);
        source.close();
    };
}
