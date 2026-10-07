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
 * reconnects a dropped EventSource by itself, so the proxy closing its stream
 * before the platform limit needs no handling here. Returns an unsubscribe.
 */
export function subscribeServiceRecordCaseChanges(
    listener: (event: ServiceRecordCaseChangedEvent) => void,
): () => void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
        return () => undefined;
    }

    const source = new EventSource(SERVICE_RECORD_CASE_EVENTS_URL);
    const handleMessage = (event: Event) => {
        const parsed = parseCaseChanged((event as MessageEvent<unknown>).data);
        if (parsed) listener(parsed);
    };
    source.addEventListener(SERVICE_RECORD_CASE_CHANGED_EVENT, handleMessage);

    return () => {
        source.removeEventListener(SERVICE_RECORD_CASE_CHANGED_EVENT, handleMessage);
        source.close();
    };
}
