import { Inject, Injectable } from "@nestjs/common";

import type {
    ServiceRecordRevisionDocumentStatus,
} from "@babyjamjam/shared/types/service-record";
import {
    ReceiptLinkRevisionRefreshService,
    type ReceiptLinkRevisionRefreshProcessInput,
    type ReceiptLinkRevisionRefreshProcessResult,
} from "application/services/receipt-link-revision-refresh.service";
import {
    ServiceRecordContractRevisionService,
    type ServiceRecordContractRevisionCapabilityEvidence,
    type ServiceRecordContractRevisionProcessInput,
    type ServiceRecordContractRevisionProcessResult,
    type ServiceRecordContractRevisionSnapshot,
    type ServiceRecordContractRevisionWorkflowScope,
    type ServiceRecordContractRevisionWorkflowStage,
} from "application/services/service-record-contract-revision.service";

/**
 * Nest token used by the document-job worker and reconciliation entrypoints.
 * The core module owns registration and invocation; this coordinator only
 * composes the two operation services below.
 */
export const SERVICE_RECORD_REVISION_OPERATION_COORDINATOR = Symbol(
    "SERVICE_RECORD_REVISION_OPERATION_COORDINATOR",
);

/** A locked, server-derived contract operation input. */
export interface ServiceRecordRevisionContractOperationInput {
    /** Generation pinned to this contract-period state. */
    generation: string;
    /** Existing operation state for retry/resume. */
    documentStateId?: string;
    /** Only supplied when the core transaction created the first state. */
    snapshot?: ServiceRecordContractRevisionSnapshot;
    /**
     * Locked source/target facts from the core repository adapter. This is
     * converted to `snapshot` exactly once for first-state creation; a
     * persisted `documentStateId` always wins on resume.
     */
    lockedFacts?: ServiceRecordRevisionContractLockedFacts;
    /** Capability evidence must be server-owned; omission is fail-closed. */
    capability?: ServiceRecordContractRevisionCapabilityEvidence;
    retry?: boolean;
}

/** A locked, server-derived receipt operation input. */
export interface ServiceRecordRevisionReceiptOperationInput {
    /** Generation pinned to this receipt-refresh state. */
    expectedGeneration: string;
    /** Receipt refresh always resumes an already-created immutable state. */
    documentStateId?: string;
    retry?: boolean;
}

/**
 * Context shared by each operation generation. The core caller must derive
 * every value from the locked revision/document rows; these fields are never
 * resolved from a public DTO or a live provider response.
 */
export interface ServiceRecordRevisionDocumentCoordinatorProcessInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    /** Optional trace value for the parent revision; never passed to either operation. */
    revisionGeneration?: string;
    retry?: boolean;
    contract?: ServiceRecordRevisionContractOperationInput;
    receipt?: ServiceRecordRevisionReceiptOperationInput;
}

export interface ServiceRecordRevisionDocumentCoordinatorProcessResult {
    revisionGeneration: string | null;
    status: ServiceRecordRevisionDocumentStatus;
    reason: string | null;
    contract: ServiceRecordContractRevisionProcessResult | null;
    receipt: ReceiptLinkRevisionRefreshProcessResult | null;
}

/**
 * Explicit facts the core transaction must capture before contract state
 * creation. Nullable fields represent a missing or malformed authoritative
 * row; the builder below reports the field instead of guessing a value.
 */
export interface ServiceRecordRevisionContractLockedFacts {
    sourceDocument: {
        documentId: string | null;
        documentVersion: number | null;
        templateId: string | null;
        templateVersion: string | null;
        workflowScope: ServiceRecordContractRevisionWorkflowScope | null;
        mirrorGeneration: string | null;
        stage: ServiceRecordContractRevisionWorkflowStage | null;
        participant: {
            id: string | null;
            name: string | null;
            phone: string | null;
        } | null;
        receivedDate: string | null;
        receivedAmount: string | null;
        startDate: string | null;
        endDate: string | null;
        allowedFieldIds: readonly string[] | null;
        fields: Readonly<Record<string, string>> | null;
    };
    targetPeriod: {
        startDate: string | null;
        endDate: string | null;
        receiptPeriod: string | null;
        fields: Readonly<Record<string, string>> | null;
    };
}

export interface ServiceRecordRevisionContractSnapshotBuildResult {
    snapshot: ServiceRecordContractRevisionSnapshot | null;
    reason: string | null;
}

/** Narrow service seams keep the coordinator independent of persistence. */
export type ServiceRecordContractRevisionOperationPort = Pick<
    ServiceRecordContractRevisionService,
    "processOperation"
>;
export type ReceiptLinkRevisionRefreshOperationPort = Pick<
    ReceiptLinkRevisionRefreshService,
    "processOperation"
>;

const REASON_INPUT_INVALID = "REVISION_DOCUMENT_COORDINATOR_INPUT_INVALID";
const REASON_IMMUTABLE_FACTS_MISSING = "REVISION_DOCUMENT_IMMUTABLE_FACTS_MISSING";
const REASON_OPERATION_FAILED = "REVISION_DOCUMENT_COORDINATOR_OPERATION_FAILED";
const REASON_SNAPSHOT_FACT_MISSING = "CONTRACT_REVISION_SNAPSHOT_MISSING_FACT";

const STATUS_PRIORITY: Record<ServiceRecordRevisionDocumentStatus, number> = {
    not_required: 10,
    completed: 20,
    waiting_for_signature: 30,
    waiting_for_completion: 40,
    pending: 50,
    processing: 60,
    capability_unverified: 70,
    failed: 80,
    manual_review: 90,
    unknown: 100,
};

function emptyContractResult(
    reason: string,
    status: ServiceRecordRevisionDocumentStatus = "manual_review",
): ServiceRecordContractRevisionProcessResult {
    return {
        status,
        state: null,
        reason,
        providerDocumentId: null,
    };
}

function emptyReceiptResult(
    reason: string,
    status: ServiceRecordRevisionDocumentStatus = "manual_review",
): ReceiptLinkRevisionRefreshProcessResult {
    return {
        status,
        state: null,
        reason,
        promotedTokenIds: [],
    };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDateOnly(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN));
    return Number.isFinite(date.getTime())
        && date.getUTCFullYear() === year
        && date.getUTCMonth() === (month ?? Number.NaN) - 1
        && date.getUTCDate() === day;
}

function isWorkflowScope(value: unknown): value is ServiceRecordContractRevisionWorkflowScope {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((entry) => (
        entry === null
        || typeof entry === "string"
        || typeof entry === "number"
        || typeof entry === "boolean"
    ));
}

function isStage(value: unknown): value is ServiceRecordContractRevisionWorkflowStage {
    return value === "provider_review"
        || value === "provider_participant"
        || value === "signature_pending"
        || value === "completed"
        || value === "unsupported";
}

function isStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === "object"
        && value !== null
        && !Array.isArray(value)
        && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

function missingSnapshotFact(field: string): ServiceRecordRevisionContractSnapshotBuildResult {
    return {
        snapshot: null,
        reason: `${REASON_SNAPSHOT_FACT_MISSING}:${field}`,
    };
}

/**
 * Build the contract service's immutable input from facts captured by a
 * locked repository transaction. Every required provider identity, receipt
 * value, and target field must be present explicitly; this function never
 * derives defaults from the caller, current time, or another document.
 */
export function buildServiceRecordContractRevisionSnapshot(
    facts: ServiceRecordRevisionContractLockedFacts,
): ServiceRecordRevisionContractSnapshotBuildResult {
    const source = facts?.sourceDocument;
    const target = facts?.targetPeriod;
    if (!source) return missingSnapshotFact("sourceDocument");
    if (!target) return missingSnapshotFact("targetPeriod");
    if (!isNonEmptyString(source.documentId)) return missingSnapshotFact("sourceDocument.documentId");
    if (!isPositiveInteger(source.documentVersion)) return missingSnapshotFact("sourceDocument.documentVersion");
    if (!isNonEmptyString(source.templateId)) return missingSnapshotFact("sourceDocument.templateId");
    if (!isNonEmptyString(source.templateVersion)) return missingSnapshotFact("sourceDocument.templateVersion");
    if (!isWorkflowScope(source.workflowScope)) return missingSnapshotFact("sourceDocument.workflowScope");
    if (!isNonEmptyString(source.mirrorGeneration)) return missingSnapshotFact("sourceDocument.mirrorGeneration");
    if (!isStage(source.stage)) return missingSnapshotFact("sourceDocument.stage");
    if (!source.participant
        || !isNonEmptyString(source.participant.id)
        || !isNonEmptyString(source.participant.name)) {
        return missingSnapshotFact("sourceDocument.participant");
    }
    if (!isDateOnly(source.receivedDate)) return missingSnapshotFact("sourceDocument.receivedDate");
    if (!isNonEmptyString(source.receivedAmount)) return missingSnapshotFact("sourceDocument.receivedAmount");
    if (!isDateOnly(source.startDate)) return missingSnapshotFact("sourceDocument.startDate");
    if (!isDateOnly(source.endDate)) return missingSnapshotFact("sourceDocument.endDate");
    if (source.startDate > source.endDate) return missingSnapshotFact("sourceDocument.period");
    if (!source.allowedFieldIds
        || source.allowedFieldIds.length === 0
        || !source.allowedFieldIds.every(isNonEmptyString)) {
        return missingSnapshotFact("sourceDocument.allowedFieldIds");
    }
    if (!isStringRecord(source.fields)) return missingSnapshotFact("sourceDocument.fields");
    if (!isDateOnly(target.startDate)) return missingSnapshotFact("targetPeriod.startDate");
    if (!isDateOnly(target.endDate)) return missingSnapshotFact("targetPeriod.endDate");
    if (target.startDate > target.endDate) return missingSnapshotFact("targetPeriod.period");
    if (!isNonEmptyString(target.receiptPeriod)
        || target.receiptPeriod !== `${target.startDate}~${target.endDate}`) {
        return missingSnapshotFact("targetPeriod.receiptPeriod");
    }
    if (!isStringRecord(target.fields)) return missingSnapshotFact("targetPeriod.fields");

    return {
        snapshot: {
            original: {
                documentId: source.documentId,
                documentVersion: source.documentVersion,
                templateId: source.templateId,
                templateVersion: source.templateVersion,
                workflowScope: { ...source.workflowScope },
                mirrorGeneration: source.mirrorGeneration,
                stage: source.stage,
                participant: {
                    id: source.participant.id,
                    name: source.participant.name,
                    phone: source.participant.phone,
                },
                receivedDate: source.receivedDate,
                receivedAmount: source.receivedAmount,
                startDate: source.startDate,
                endDate: source.endDate,
                allowedFieldIds: [...source.allowedFieldIds],
                fields: { ...source.fields },
            },
            target: {
                startDate: target.startDate,
                endDate: target.endDate,
                receiptPeriod: target.receiptPeriod,
                fields: { ...target.fields },
            },
        },
        reason: null,
    };
}

function isValidBaseInput(
    input: ServiceRecordRevisionDocumentCoordinatorProcessInput,
): boolean {
    return isNonEmptyString(input.branchId)
        && isPositiveInteger(input.clientId)
        && isNonEmptyString(input.serviceRecordCaseId)
        && isNonEmptyString(input.revisionId);
}

function aggregateStatus(
    contract: ServiceRecordContractRevisionProcessResult | null,
    receipt: ReceiptLinkRevisionRefreshProcessResult | null,
): ServiceRecordRevisionDocumentStatus {
    const statuses = [contract?.status, receipt?.status].filter(
        (status): status is ServiceRecordRevisionDocumentStatus => status !== undefined,
    );
    if (statuses.length === 0) return "not_required";
    return statuses.reduce((highest, status) => (
        STATUS_PRIORITY[status] > STATUS_PRIORITY[highest] ? status : highest
    ));
}

function aggregateReason(
    contract: ServiceRecordContractRevisionProcessResult | null,
    receipt: ReceiptLinkRevisionRefreshProcessResult | null,
): string | null {
    const reasons: string[] = [];
    if (contract?.reason) reasons.push(`contract:${contract.reason}`);
    if (receipt?.reason) reasons.push(`receipt:${receipt.reason}`);
    return reasons.length > 0 ? reasons.join("|") : null;
}

@Injectable()
export class ServiceRecordRevisionDocumentCoordinator {
    constructor(
        @Inject(ServiceRecordContractRevisionService)
        private readonly contractService: ServiceRecordContractRevisionOperationPort,
        @Inject(ReceiptLinkRevisionRefreshService)
        private readonly receiptService: ReceiptLinkRevisionRefreshOperationPort,
    ) {}

    /**
     * Run each requested revision operation through its existing durable state
     * and reconciliation service. Operations remain independent: a contract
     * result does not suppress receipt processing, and vice versa.
     */
    async process(
        input: ServiceRecordRevisionDocumentCoordinatorProcessInput,
    ): Promise<ServiceRecordRevisionDocumentCoordinatorProcessResult> {
        const revisionGeneration = typeof input.revisionGeneration === "string"
            ? input.revisionGeneration
            : null;
        if (!isValidBaseInput(input)) {
            const contract = input.contract ? emptyContractResult(REASON_INPUT_INVALID) : null;
            const receipt = input.receipt ? emptyReceiptResult(REASON_INPUT_INVALID) : null;
            return {
                revisionGeneration,
                status: aggregateStatus(contract, receipt),
                reason: aggregateReason(contract, receipt) ?? REASON_INPUT_INVALID,
                contract,
                receipt,
            };
        }

        const contract = input.contract === undefined
            ? null
            : await this.processContract(input, input.contract);
        const receipt = input.receipt === undefined
            ? null
            : await this.processReceipt(input, input.receipt);

        return {
            revisionGeneration,
            status: aggregateStatus(contract, receipt),
            reason: aggregateReason(contract, receipt),
            contract,
            receipt,
        };
    }

    private async processContract(
        input: ServiceRecordRevisionDocumentCoordinatorProcessInput,
        operation: ServiceRecordRevisionContractOperationInput,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        if (operation.documentStateId !== undefined && !isNonEmptyString(operation.documentStateId)) {
            return emptyContractResult(REASON_INPUT_INVALID);
        }

        // A persisted state is authoritative. Ignore any duplicate caller
        // snapshot/facts when resuming so an expected payload cannot replace
        // the immutable input already stored for this generation.
        if (!isNonEmptyString(operation.generation)) {
            return emptyContractResult(REASON_INPUT_INVALID);
        }
        const stateId = operation.documentStateId;
        let snapshot = stateId === undefined ? operation.snapshot : undefined;
        if (stateId === undefined && operation.snapshot !== undefined && operation.lockedFacts !== undefined) {
            return emptyContractResult(`${REASON_IMMUTABLE_FACTS_MISSING}:ambiguous_snapshot_source`);
        }
        if (stateId === undefined && snapshot === undefined && operation.lockedFacts !== undefined) {
            const built = buildServiceRecordContractRevisionSnapshot(operation.lockedFacts);
            if (!built.snapshot) return emptyContractResult(built.reason ?? REASON_IMMUTABLE_FACTS_MISSING);
            snapshot = built.snapshot;
        }

        // A contract service can create its first state only from a complete
        // locked snapshot. Without either a persisted state ID or that
        // snapshot, report manual review and do not invoke any dependency.
        if (stateId === undefined && snapshot === undefined) {
            return emptyContractResult(REASON_IMMUTABLE_FACTS_MISSING);
        }

        const processInput: ServiceRecordContractRevisionProcessInput = {
            branchId: input.branchId,
            clientId: input.clientId,
            serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId: input.revisionId,
            generation: operation.generation,
            ...(stateId !== undefined ? { documentStateId: stateId } : {}),
            ...(snapshot !== undefined ? { snapshot } : {}),
            ...(operation.capability !== undefined ? { capability: operation.capability } : {}),
            retry: operation.retry ?? input.retry,
        };

        try {
            return await this.contractService.processOperation(processInput);
        } catch {
            // The operation service normally converts adapter/repository
            // failures into a durable result. If an unexpected implementation
            // error escapes, fail closed without attempting a second path.
            return emptyContractResult(REASON_OPERATION_FAILED, "unknown");
        }
    }

    private async processReceipt(
        input: ServiceRecordRevisionDocumentCoordinatorProcessInput,
        operation: ServiceRecordRevisionReceiptOperationInput,
    ): Promise<ReceiptLinkRevisionRefreshProcessResult> {
        // Receipt refresh has no create-with-snapshot entrypoint. Core must
        // persist its immutable receipt facts and pass the state ID from that
        // same locked revision transaction before invoking this coordinator.
        if (!isNonEmptyString(operation.expectedGeneration)
            || !isNonEmptyString(operation.documentStateId)) {
            return emptyReceiptResult(REASON_IMMUTABLE_FACTS_MISSING);
        }

        const processInput: ReceiptLinkRevisionRefreshProcessInput = {
            branchId: input.branchId,
            clientId: input.clientId,
            serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId: input.revisionId,
            documentStateId: operation.documentStateId,
            expectedGeneration: operation.expectedGeneration,
            retry: operation.retry ?? input.retry,
        };

        try {
            return await this.receiptService.processOperation(processInput);
        } catch {
            return emptyReceiptResult(REASON_OPERATION_FAILED, "unknown");
        }
    }
}
