import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { isManualMessageTriggerJob } from "domain/constants/message-trigger-job-ownership";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

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

export function isStandaloneReceiptJob(job: {
    standaloneRequestId?: string | null;
    payload: object;
    ruleId: string;
    templateKey: string;
    dedupeKey: string;
}): boolean {
    // The persisted binding is authoritative for routing. A marker on the
    // dedicated manual route without that binding must also fail preparation.
    return job.standaloneRequestId != null
        || (job.ruleId === SERVICE_END_NOTICE_RULE_ID
            && job.templateKey === MessageTriggerTemplateKey.SERVICE_END_NOTICE
            && isManualMessageTriggerJob(job)
            && Object.prototype.hasOwnProperty.call(job.payload, "standaloneReceipt"));
}
