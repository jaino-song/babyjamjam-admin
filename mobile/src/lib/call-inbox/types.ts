export type CallCategory = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";
export type ProcessingStatus = "RECEIVED" | "EXTRACTED" | "FAILED";
export type DraftType = "NEW_CLIENT" | "CLIENT_UPDATE";
export type DraftStatus = "PENDING" | "CONFIRMED" | "DISCARDED";
export type Confidence = "high" | "low";

export interface TranscriptTurn {
    speaker: string;
    text: string;
}

export interface Proposal {
    field: string;
    value: string | number | boolean | null;
    evidence: string;
    confidence: Confidence;
}

export interface ClientRef {
    id: number;
    name: string;
    phone: string | null;
}

export interface Paginated<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface CallRecordListItem {
    id: string;
    category: CallCategory | null;
    processingStatus: ProcessingStatus;
    callerName: string | null;
    callerPhone: string | null;
    fileName: string;
    recordedAt: string | null;
    createdAt: string;
    matchedClient: ClientRef | null;
    draft: { id: string; type: DraftType; status: DraftStatus; requestSummary: string } | null;
    summaryLine: string | null;
}

export interface CallRecordDetail extends CallRecordListItem {
    transcript: TranscriptTurn[];
    summary: Record<string, string> | null;
    driveFileId: string;
    driveUrl: string;
    failureReason: string | null;
}

export interface ClientDraftListItem {
    id: string;
    type: DraftType;
    status: DraftStatus;
    requestSummary: string;
    callerName: string | null;
    callerPhone: string | null;
    recordedAt: string | null;
    createdAt: string;
    callRecordId: string;
    client: ClientRef | null;
    hasLowConfidence: boolean;
    possibleDuplicate: boolean;
    phoneMatchesExistingClient: boolean;
}

export interface ClientDraftDetail {
    id: string;
    type: DraftType;
    status: DraftStatus;
    clientId: number | null;
    proposals: Proposal[];
    requestSummary: string;
    callRecord: CallRecordDetail;
    client: (ClientRef & Record<string, unknown>) | null;
    reviewedBy: { id: string; name: string } | null;
    reviewedAt: string | null;
    discardReason: string | null;
}

export interface ConfirmDraftBody {
    fields: {
        name: string;
        careCenter: boolean;
        voucherClient: boolean;
        breastPump: boolean;
        [key: string]: unknown;
    };
    suppressGreetingSms?: boolean;
}
