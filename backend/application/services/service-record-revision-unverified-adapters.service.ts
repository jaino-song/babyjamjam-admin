import { Injectable } from "@nestjs/common";

import type {
    ReceiptLinkRevisionPdfSource,
} from "application/services/receipt-link-revision-refresh.service";
import type {
    ServiceRecordContractRevisionDispatchClaim,
    ServiceRecordContractRevisionDispatchClaimInput,
    ServiceRecordContractRevisionDispatchPort,
    ServiceRecordContractRevisionDocumentObservation,
    ServiceRecordContractRevisionProviderPort,
} from "application/services/service-record-contract-revision.service";
import type { ServiceRecordContractRevisionWorkflowScope } from "application/services/service-record-contract-revision.service";

/** Stable reason exposed by production-safe placeholder adapters. */
export const REVISION_OPERATION_CAPABILITY_UNVERIFIED =
    "REVISION_OPERATION_CAPABILITY_UNVERIFIED";

function unavailable(): never {
    throw new Error(REVISION_OPERATION_CAPABILITY_UNVERIFIED);
}

/**
 * No Phase0 capability evidence exists for revised contract operations yet.
 * Keep this binding explicit and fail closed so a placeholder cannot reach the
 * vendor SDK through a mistakenly verified caller flag.
 */
@Injectable()
export class UnverifiedServiceRecordContractRevisionProvider
    implements ServiceRecordContractRevisionProviderPort {
    async inspectDocument(_input: {
        documentId: string;
        branchId: string;
        clientId: number;
        revisionId: string;
    }): Promise<ServiceRecordContractRevisionDocumentObservation> {
        void _input;
        return unavailable();
    }

    async requestReviewRejection(_input: {
        documentId: string;
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
        comment: string;
    }): Promise<void> {
        void _input;
        return unavailable();
    }

    async updateParticipantFields(_input: {
        documentId: string;
        fields: Record<string, string>;
        preservedReceipt: { receivedDate: string; receivedAmount: string };
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
    }): Promise<void> {
        void _input;
        return unavailable();
    }

    async createReplacementDocument(_input: {
        sourceDocumentId: string;
        templateId: string;
        templateVersion: string;
        fields: Record<string, string>;
        preservedReceipt: { receivedDate: string; receivedAmount: string };
        recipient: { id: string; name: string; phone: string | null };
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
        operationFingerprint: string;
    }): Promise<{ documentId: string }> {
        void _input;
        return unavailable();
    }

    async findReplacementDocument(_input: {
        sourceDocumentId: string;
        operationFingerprint: string;
        branchId: string;
        clientId: number;
    }): Promise<{ documentId: string } | null> {
        void _input;
        return unavailable();
    }
}

/** Durable dispatch must also fail closed until a verified capability exists. */
@Injectable()
export class UnverifiedServiceRecordContractRevisionDispatch
    implements ServiceRecordContractRevisionDispatchPort {
    async claim(
        _input: ServiceRecordContractRevisionDispatchClaimInput,
    ): Promise<ServiceRecordContractRevisionDispatchClaim> {
        void _input;
        return unavailable();
    }

    async markAccepted(_claimToken: string, _providerDocumentId?: string | null): Promise<void> {
        void _claimToken;
        void _providerDocumentId;
        return unavailable();
    }

    async markUncertain(_claimToken: string, _reason: string): Promise<void> {
        void _claimToken;
        void _reason;
        return unavailable();
    }
}

/**
 * Receipt refresh requires authoritative PDF bytes. Until a verified provider
 * capability is registered, this adapter prevents the service from invoking a
 * download path and leaves the durable operation state retryable/manual.
 */
@Injectable()
export class UnverifiedReceiptLinkRevisionPdfSource implements ReceiptLinkRevisionPdfSource {
    async download(_input: Parameters<ReceiptLinkRevisionPdfSource["download"]>[0]): ReturnType<ReceiptLinkRevisionPdfSource["download"]> {
        void _input;
        return unavailable();
    }
}
