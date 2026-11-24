export const RECEIPT_RECOVERY_PREFIX = "receipt-retry:";
export const RECEIPT_RECOVERY_REASONS = [
    "live_unsigned_contract",
    "missing_birthday",
    "missing_current_contract",
    "current_contract_pdf_pending",
] as const;

export type ReceiptRecoveryReason = typeof RECEIPT_RECOVERY_REASONS[number];
export const RECEIPT_RECOVERY_REFUSED = "receipt_recovery_not_proven";
export const RECEIPT_RECOVERY_RECHECK_MS = 60_000;

export interface ReceiptRecoveryProof {
    reason: ReceiptRecoveryReason;
    documentId: number | null;
}

export function isReceiptRecoveryReason(reason: string | null): reason is ReceiptRecoveryReason {
    return (RECEIPT_RECOVERY_REASONS as readonly (string | null)[]).includes(reason);
}

export interface ReceiptObservation {
    event: string;
    slot: string;
    documentId: number | null;
    admittedDocumentId?: number;
}

export function readReceiptObservation(payload: unknown): ReceiptObservation | null {
    const value = (payload as Record<string, unknown> | null)?.["receiptRecovery"] as Partial<ReceiptObservation> | undefined;
    if (!value || typeof value.event !== "string" || typeof value.slot !== "string"
        || (value.documentId !== null && !Number.isSafeInteger(value.documentId))
        || (value.admittedDocumentId !== undefined && !Number.isSafeInteger(value.admittedDocumentId))) return null;
    return value as ReceiptObservation;
}

export function receiptRuleSlot(rule: { id: string; groupId: string | null }): string {
    return rule.groupId ? `group:${rule.groupId}` : `rule:${rule.id}`;
}

