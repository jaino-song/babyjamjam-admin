export interface StandaloneReceiptSnapshot {
    readonly customerName: string;
    readonly serviceStartDate: string;
    readonly endDate: string;
    readonly receivedDate: string;
    readonly issueDate: string;
    readonly fullPrice: number;
    readonly grant: number;
    readonly actualPrice: number;
}

export interface StandaloneReceiptRequest {
    readonly version: 1;
    readonly requestId: string;
    readonly jobId: string;
    readonly branchId: string;
    readonly issuerName: string;
    readonly clientId: number;
    readonly recipientPhone: string;
    readonly expectedBirthdayHash: string;
    readonly acceptedBy: string;
    readonly acceptedAt: string;
    readonly nonce: string;
    readonly artifactId: string;
    readonly receipt: StandaloneReceiptSnapshot;
}

export const STANDALONE_RECEIPT_HISTORY_PLACEHOLDER = "[영수증 링크]";
export const STANDALONE_RECEIPT_LOG_REFERENCE = "standaloneReceiptLinkReference";

export function standaloneReceiptReference(jobId: string): string {
    return `standalone-receipt:v1:${jobId}`;
}

export function hasStandaloneReceipt(job: { standaloneRequestId?: string | null; payload: object }): boolean {
    return job.standaloneRequestId != null || Object.prototype.hasOwnProperty.call(job.payload, "standaloneReceipt");
}
