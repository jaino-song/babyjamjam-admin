import type { StatusBadgeVariant } from "../tokens/status-badge";

/**
 * Coarse per-client contract-document status the backend stores on the client
 * record (Client.documentStatus). One canonical Korean label + badge variant
 * per status, shared by every surface that renders it — the desktop client
 * panel/dialogs and the mobile client detail previously each kept their own
 * (drifted) mappings.
 */
export type ClientDocumentStatus =
    | "created"
    | "opened"
    | "requested"
    | "completed"
    | "rejected"
    | "revoked"
    | "deleted";

export interface ClientDocumentStatusMeta {
    label: string;
    variant: StatusBadgeVariant;
}

export const CLIENT_DOCUMENT_STATUS_META = {
    created: { label: "발송 대기", variant: "info" },
    requested: { label: "서명 요청됨", variant: "warning" },
    opened: { label: "열람됨", variant: "warning" },
    completed: { label: "계약 완료", variant: "success" },
    rejected: { label: "거부됨", variant: "danger" },
    revoked: { label: "철회됨", variant: "danger" },
    deleted: { label: "삭제됨", variant: "danger" },
} as const satisfies Record<ClientDocumentStatus, ClientDocumentStatusMeta>;

/** Meta for a client that has no contract document at all. */
export const CLIENT_DOCUMENT_STATUS_NONE_META: ClientDocumentStatusMeta = {
    label: "미발급",
    variant: "neutral",
};

/** Shown when the customer has signed but the document is not yet finalized (provider review). */
export const CLIENT_DOCUMENT_STATUS_SIGNED_META: ClientDocumentStatusMeta = {
    label: "서명 완료",
    variant: "info",
};

/** Statuses that read as "still waiting for the customer's signature" unless the customer already signed. */
const PRE_SIGNATURE_STATUSES: ReadonlySet<string> = new Set(["created", "opened", "requested"]);

/** What a client's contract reads as on screen: a stored status, the derived "signed" step, or no document. */
export type ClientDocumentDisplayStatus = ClientDocumentStatus | "signed" | "none";

/**
 * documentStatus is a lossy liveness summary: provider review (070, customer already signed) and
 * unsigned (060) both arrive as "requested". `hasSigned` (step-aware, from the same latest contract
 * row) is therefore required, so a signed-but-not-finalized contract never reads as 서명 요청됨.
 * When `hasSigned` is not true nothing is inferred from the status alone.
 */
export function resolveClientDocumentDisplayStatus(
    status: string | null | undefined,
    { hasSigned }: { hasSigned: boolean | null | undefined },
): ClientDocumentDisplayStatus {
    if (!status || !(status in CLIENT_DOCUMENT_STATUS_META)) return "none";
    if (hasSigned === true && PRE_SIGNATURE_STATUSES.has(status)) return "signed";
    return status as ClientDocumentStatus;
}

/** Resolve the display meta for any stored documentStatus value (null/unknown → 미발급). */
export function getClientDocumentStatusMeta(
    status: string | null | undefined,
    flags: { hasSigned: boolean | null | undefined },
): ClientDocumentStatusMeta {
    const display = resolveClientDocumentDisplayStatus(status, flags);
    if (display === "none") return CLIENT_DOCUMENT_STATUS_NONE_META;
    if (display === "signed") return CLIENT_DOCUMENT_STATUS_SIGNED_META;
    return CLIENT_DOCUMENT_STATUS_META[display];
}
