export const SERVICE_RECORD_REVISION_SYNC_CHANNEL = "babyjamjam:service-record-revision";

export interface ServiceRecordRevisionSyncEvent {
    caseId: string;
    caseVersion: number;
}

function normalizeEvent(value: unknown): ServiceRecordRevisionSyncEvent | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const candidate = value as { caseId?: unknown; caseVersion?: unknown };
    if (typeof candidate.caseId !== "string" || candidate.caseId.length === 0) return null;
    if (typeof candidate.caseVersion !== "number"
        || !Number.isSafeInteger(candidate.caseVersion)
        || candidate.caseVersion < 0) {
        return null;
    }
    return {
        caseId: candidate.caseId,
        caseVersion: candidate.caseVersion,
    };
}

/** Broadcast a successful server confirmation to other same-origin tabs. */
export function publishServiceRecordRevisionSync(event: ServiceRecordRevisionSyncEvent): void {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const normalized = normalizeEvent(event);
    if (!normalized) return;

    const channel = new BroadcastChannel(SERVICE_RECORD_REVISION_SYNC_CHANNEL);
    try {
        channel.postMessage(normalized);
    } finally {
        channel.close();
    }
}

/** Subscribe to server-confirmation events and close the channel on cleanup. */
export function subscribeServiceRecordRevisionSync(
    listener: (event: ServiceRecordRevisionSyncEvent) => void,
): () => void {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
        return () => undefined;
    }

    const channel = new BroadcastChannel(SERVICE_RECORD_REVISION_SYNC_CHANNEL);
    const handleMessage = (event: MessageEvent<unknown>) => {
        const normalized = normalizeEvent(event.data);
        if (normalized) listener(normalized);
    };
    channel.addEventListener("message", handleMessage);

    return () => {
        channel.removeEventListener("message", handleMessage);
        channel.close();
    };
}
