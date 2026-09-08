import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type {
    ServiceRecordRevisionDocumentState,
    ServiceRecordRevisionDocumentStatus,
} from "@babyjamjam/shared/types/service-record";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type AdvanceServiceRecordRevisionDocumentStateInput,
    type CreateServiceRecordRevisionDocumentStateInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditJsonObject,
    type ServiceRecordEditJsonValue,
} from "domain/repositories/service-record-edit.repository.interface";

export const SERVICE_RECORD_CONTRACT_REVISION_PROVIDER = Symbol("SERVICE_RECORD_CONTRACT_REVISION_PROVIDER");
export const SERVICE_RECORD_CONTRACT_REVISION_DISPATCH = Symbol("SERVICE_RECORD_CONTRACT_REVISION_DISPATCH");

const CONTRACT_PERIOD_OPERATION = "contract_period" as const;
const STATE_STEP_PREPARED = "prepared";
const STATE_STEP_CAPABILITY_UNVERIFIED = "capability_unverified";
const STATE_STEP_MANUAL_REVIEW = "manual_review";
const STATE_STEP_WAITING_FOR_SIGNATURE = "waiting_for_signature";
const STATE_STEP_UNKNOWN = "unknown";
const STATE_STEP_REVIEW_CLAIM = "review_rejection_claim";
const STATE_STEP_REVIEW_REQUESTED = "review_rejection_requested";
const STATE_STEP_PARTICIPANT_CLAIM = "participant_update_claim";
const STATE_STEP_PARTICIPANT_UPDATED = "participant_updated";
const STATE_STEP_REPLACEMENT_CLAIM = "replacement_create_claim";
const STATE_STEP_REPLACEMENT_CREATED = "replacement_created";

const REASON_INVALID_INPUT = "CONTRACT_REVISION_INPUT_INVALID";
const REASON_STATE_NOT_FOUND = "CONTRACT_REVISION_STATE_NOT_FOUND";
const REASON_SCOPE_MISMATCH = "CONTRACT_REVISION_SCOPE_MISMATCH";
const REASON_GENERATION_MISMATCH = "CONTRACT_REVISION_GENERATION_MISMATCH";
const REASON_CAPABILITY_UNVERIFIED = "CONTRACT_REVISION_CAPABILITY_UNVERIFIED";
const REASON_CAPABILITY_MISMATCH = "CONTRACT_REVISION_CAPABILITY_MISMATCH";
const REASON_WORKFLOW_UNSUPPORTED = "CONTRACT_REVISION_WORKFLOW_UNSUPPORTED";
const REASON_PROVIDER_READ_FAILED = "CONTRACT_REVISION_PROVIDER_READ_FAILED";
const REASON_PROVIDER_STATE_CHANGED = "CONTRACT_REVISION_PROVIDER_STATE_CHANGED";
const REASON_DISPATCH_UNAVAILABLE = "CONTRACT_REVISION_DISPATCH_UNAVAILABLE";
const REASON_DISPATCH_UNCERTAIN = "CONTRACT_REVISION_DISPATCH_UNCERTAIN";
const REASON_PROVIDER_OUTCOME_UNKNOWN = "CONTRACT_REVISION_PROVIDER_OUTCOME_UNKNOWN";
const REASON_STATE_CAS_LOST = "CONTRACT_REVISION_STATE_CAS_LOST";

const FORBIDDEN_FIELD_MARKERS = [
    "signature",
    "stamp",
    "서명",
    "도장",
    "싸인",
    "receiveddate",
    "receivedamount",
    "수령일",
    "수령금액",
    "본인부담금",
] as const;

export type ServiceRecordContractRevisionWorkflowStage =
    | "provider_review"
    | "provider_participant"
    | "signature_pending"
    | "completed"
    | "unsupported";

export type ServiceRecordContractRevisionProviderOperation =
    | "request_review_rejection"
    | "update_participant_fields"
    | "create_replacement_document";

export interface ServiceRecordContractRevisionParticipant {
    id: string;
    name: string;
    phone: string | null;
}

/**
 * The workflow scope is a server-observed identity, not a provider SDK code.
 * Adapters must derive it from the current template/document response before
 * passing it to this service.
 */
export type ServiceRecordContractRevisionWorkflowScope = Record<
    string,
    string | number | boolean | null
>;

export interface ServiceRecordContractRevisionOriginalDocument {
    documentId: string;
    /** Provider snapshots may legitimately omit a version; null is frozen explicitly. */
    documentVersion: number | null;
    templateId: string;
    templateVersion: string;
    workflowScope: ServiceRecordContractRevisionWorkflowScope;
    mirrorGeneration: string;
    stage: ServiceRecordContractRevisionWorkflowStage;
    participant: ServiceRecordContractRevisionParticipant;
    receivedDate: string | null;
    receivedAmount: string | null;
    startDate: string;
    endDate: string;
    allowedFieldIds: string[];
    fields: Record<string, string>;
}

export interface ServiceRecordContractRevisionTargetPeriod {
    startDate: string;
    endDate: string;
    receiptPeriod: string;
    fields: Record<string, string>;
}

/** Complete, server-derived facts that are frozen for one operation generation. */
export interface ServiceRecordContractRevisionSnapshot {
    original: ServiceRecordContractRevisionOriginalDocument;
    target: ServiceRecordContractRevisionTargetPeriod;
}

export interface ServiceRecordContractRevisionCapabilityEvidence {
    status: "verified" | "unverified";
    templateId: string;
    templateVersion: string;
    workflowScope: ServiceRecordContractRevisionWorkflowScope;
    operations: ServiceRecordContractRevisionProviderOperation[];
}

export interface ServiceRecordContractRevisionProcessInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    generation: string;
    /** Existing state is required for retry/resume so the persisted snapshot wins. */
    documentStateId?: string;
    /** Only used when creating the first state for this generation. */
    snapshot?: ServiceRecordContractRevisionSnapshot;
    capability?: ServiceRecordContractRevisionCapabilityEvidence;
    retry?: boolean;
}

export interface ServiceRecordContractRevisionProcessResult {
    status: ServiceRecordRevisionDocumentStatus;
    state: ServiceRecordRevisionDocumentState | null;
    reason: string | null;
    providerDocumentId: string | null;
}

export interface ServiceRecordContractRevisionDocumentObservation {
    documentId: string;
    templateId: string;
    templateVersion: string;
    workflowScope: ServiceRecordContractRevisionWorkflowScope;
    stage: ServiceRecordContractRevisionWorkflowStage;
    participant: ServiceRecordContractRevisionParticipant;
    fields: Record<string, string>;
}

export interface ServiceRecordContractRevisionProviderPort {
    inspectDocument(input: {
        documentId: string;
        branchId: string;
        clientId: number;
        revisionId: string;
    }): Promise<ServiceRecordContractRevisionDocumentObservation>;
    requestReviewRejection(input: {
        documentId: string;
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
        comment: string;
    }): Promise<void>;
    updateParticipantFields(input: {
        documentId: string;
        fields: Record<string, string>;
        preservedReceipt: {
            receivedDate: string;
            receivedAmount: string;
        };
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
    }): Promise<void>;
    createReplacementDocument(input: {
        sourceDocumentId: string;
        templateId: string;
        templateVersion: string;
        fields: Record<string, string>;
        preservedReceipt: {
            receivedDate: string;
            receivedAmount: string;
        };
        recipient: ServiceRecordContractRevisionParticipant;
        workflowScope: ServiceRecordContractRevisionWorkflowScope;
        operationFingerprint: string;
    }): Promise<{ documentId: string }>;
    /** Query path for a create whose response was lost; must be idempotent. */
    findReplacementDocument(input: {
        sourceDocumentId: string;
        operationFingerprint: string;
        branchId: string;
        clientId: number;
    }): Promise<{ documentId: string } | null>;
}

export interface ServiceRecordContractRevisionDispatchClaimInput {
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    generation: string;
    operation: typeof CONTRACT_PERIOD_OPERATION;
    step: string;
    inputFingerprint: string;
}

export interface ServiceRecordContractRevisionDispatchClaim {
    disposition: "claimed" | "already_accepted" | "uncertain";
    claimToken: string | null;
    providerDocumentId?: string | null;
}

export interface ServiceRecordContractRevisionDispatchPort {
    claim(
        input: ServiceRecordContractRevisionDispatchClaimInput,
    ): Promise<ServiceRecordContractRevisionDispatchClaim>;
    markAccepted(
        claimToken: string,
        providerDocumentId?: string | null,
    ): Promise<void>;
    markUncertain(claimToken: string, reason: string): Promise<void>;
}

export type ServiceRecordContractRevisionStateRepository = Pick<
    IServiceRecordEditRepository,
    | "findRevisionDocumentState"
    | "createRevisionDocumentState"
    | "advanceRevisionDocumentState"
    | "retryRevisionDocumentState"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, canonicalize(value[key])]),
    );
}

function fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const instant = new Date(Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN));
    return instant.getUTCFullYear() === year
        && instant.getUTCMonth() === (month ?? Number.NaN) - 1
        && instant.getUTCDate() === day;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDocumentVersion(value: unknown): value is number | null {
    return value === null || isPositiveInteger(value);
}

function isAllowedWorkflowValue(value: unknown): value is string | number | boolean | null {
    return value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean";
}

function isWorkflowScope(value: unknown): value is ServiceRecordContractRevisionWorkflowScope {
    return isRecord(value)
        && Object.keys(value).length > 0
        && Object.values(value).every(isAllowedWorkflowValue);
}

function isParticipant(value: unknown): value is ServiceRecordContractRevisionParticipant {
    return isRecord(value)
        && isNonEmptyString(value["id"])
        && isNonEmptyString(value["name"])
        && (value["phone"] === null || isNonEmptyString(value["phone"]));
}

function isStage(value: unknown): value is ServiceRecordContractRevisionWorkflowStage {
    return value === "provider_review"
        || value === "provider_participant"
        || value === "signature_pending"
        || value === "completed"
        || value === "unsupported";
}

function hasForbiddenField(fieldId: string): boolean {
    const normalized = fieldId.toLowerCase();
    return FORBIDDEN_FIELD_MARKERS.some((marker) => normalized.includes(marker));
}

function fieldsAreRecord(value: unknown): value is Record<string, string> {
    return isRecord(value)
        && Object.entries(value).every(([key, fieldValue]) => isNonEmptyString(key) && typeof fieldValue === "string");
}

function asJsonValue(value: unknown): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((entry) => asJsonValue(entry));
    if (isRecord(value)) {
        const output: ServiceRecordEditJsonObject = {};
        for (const [key, entry] of Object.entries(value)) output[key] = asJsonValue(entry);
        return output;
    }
    throw new Error(REASON_INVALID_INPUT);
}

function snapshotAsJson(snapshot: ServiceRecordContractRevisionSnapshot): ServiceRecordEditJsonValue {
    return asJsonValue(snapshot);
}

function sameScope(
    first: ServiceRecordContractRevisionWorkflowScope,
    second: ServiceRecordContractRevisionWorkflowScope,
): boolean {
    return JSON.stringify(canonicalize(first)) === JSON.stringify(canonicalize(second));
}

function stateResult(
    state: ServiceRecordRevisionDocumentState | null,
    reason: string | null,
    providerDocumentId: string | null = null,
): ServiceRecordContractRevisionProcessResult {
    return {
        status: state?.status ?? "unknown",
        state,
        reason,
        providerDocumentId,
    };
}

@Injectable()
export class ServiceRecordContractRevisionService {
    constructor(
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly repository: ServiceRecordContractRevisionStateRepository,
        @Inject(SERVICE_RECORD_CONTRACT_REVISION_PROVIDER)
        private readonly provider: ServiceRecordContractRevisionProviderPort,
        @Inject(SERVICE_RECORD_CONTRACT_REVISION_DISPATCH)
        private readonly dispatch: ServiceRecordContractRevisionDispatchPort,
    ) {}

    async processOperation(
        input: ServiceRecordContractRevisionProcessInput,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const scopeError = this.validateScope(input);
        if (scopeError) return stateResult(null, scopeError);

        const loaded = await this.loadOrCreateState(input);
        if (!loaded.state) return stateResult(null, loaded.reason);
        let state = loaded.state;

        if (state.branchId !== input.branchId || state.clientId !== input.clientId || state.revisionId !== input.revisionId) {
            return stateResult(state, REASON_SCOPE_MISMATCH);
        }
        if (state.generation !== input.generation) {
            return stateResult(state, REASON_GENERATION_MISMATCH);
        }

        if (["not_required", "waiting_for_signature", "completed"].includes(state.status)) {
            return stateResult(state, null, state.targetDocumentId);
        }
        if (["manual_review", "failed", "unknown"].includes(state.status) && !input.retry) {
            return stateResult(state, null, state.targetDocumentId);
        }

        const snapshot = loaded.snapshot ?? this.readSnapshot(state.immutableInput);
        const snapshotError = this.validateSnapshot(snapshot);
        if (snapshotError) return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", snapshotError);
        if (!snapshot) return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_INVALID_INPUT);

        if (snapshot.original.startDate === snapshot.target.startDate
            && snapshot.original.endDate === snapshot.target.endDate) {
            return this.advanceTo(state, STATE_STEP_PREPARED, "not_required", null);
        }

        const capabilityResult = this.validateCapability(input.capability, snapshot);
        if (capabilityResult !== null) {
            const status = capabilityResult === REASON_CAPABILITY_UNVERIFIED
                ? "capability_unverified"
                : "manual_review";
            return this.advanceTo(state, status === "capability_unverified" ? STATE_STEP_CAPABILITY_UNVERIFIED : STATE_STEP_MANUAL_REVIEW, status, capabilityResult);
        }

        if (!input.capability) {
            return this.advanceTo(state, STATE_STEP_CAPABILITY_UNVERIFIED, "capability_unverified", REASON_CAPABILITY_UNVERIFIED);
        }

        if (input.retry && ["failed", "unknown", "manual_review"].includes(state.status)) {
            if (state.status === "unknown") {
                const reconciled = await this.reconcileUnknownBeforeRetry(state, snapshot, input);
                if (reconciled) return reconciled;
            }
            const retried = await this.repository.retryRevisionDocumentState({
                branchId: input.branchId,
                clientId: input.clientId,
                revisionId: input.revisionId,
                stateId: state.id,
                expectedGeneration: input.generation,
            });
            if (!retried) return stateResult(null, REASON_STATE_CAS_LOST);
            state = retried;
        }

        switch (snapshot.original.stage) {
            case "signature_pending":
                return this.advanceTo(state, STATE_STEP_WAITING_FOR_SIGNATURE, "waiting_for_signature", null);
            case "provider_review":
                return this.processProviderReview(state, snapshot, input);
            case "provider_participant":
                return this.processProviderParticipant(state, snapshot, input);
            case "completed":
                return this.processCompleted(state, snapshot, input);
            case "unsupported":
                return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_WORKFLOW_UNSUPPORTED);
            default:
                return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_WORKFLOW_UNSUPPORTED);
        }
    }

    private validateScope(input: ServiceRecordContractRevisionProcessInput): string | null {
        if (!isNonEmptyString(input.branchId)
            || !isPositiveInteger(input.clientId)
            || !isNonEmptyString(input.serviceRecordCaseId)
            || !isNonEmptyString(input.revisionId)
            || !isNonEmptyString(input.generation)) {
            return REASON_INVALID_INPUT;
        }
        if (input.documentStateId !== undefined && !isNonEmptyString(input.documentStateId)) return REASON_INVALID_INPUT;
        return null;
    }

    private async loadOrCreateState(input: ServiceRecordContractRevisionProcessInput): Promise<{
        state: ServiceRecordRevisionDocumentState | null;
        snapshot: ServiceRecordContractRevisionSnapshot | null;
        reason: string | null;
    }> {
        if (input.documentStateId) {
            const state = await this.repository.findRevisionDocumentState(
                input.branchId,
                input.clientId,
                input.revisionId,
                input.documentStateId,
            );
            if (!state) return { state: null, snapshot: null, reason: REASON_STATE_NOT_FOUND };
            return { state, snapshot: this.readSnapshot(state.immutableInput), reason: null };
        }

        if (!input.snapshot) return { state: null, snapshot: null, reason: REASON_INVALID_INPUT };
        const immutableInput = snapshotAsJson(input.snapshot);
        const createInput: CreateServiceRecordRevisionDocumentStateInput = {
            branchId: input.branchId,
            clientId: input.clientId,
            serviceRecordCaseId: input.serviceRecordCaseId,
            revisionId: input.revisionId,
            operation: CONTRACT_PERIOD_OPERATION,
            generation: input.generation,
            immutableInput,
            inputFingerprint: fingerprint(immutableInput),
            documentVersion: input.snapshot.original.documentVersion,
            sourceDocumentId: input.snapshot.original.documentId,
            templateId: input.snapshot.original.templateId,
            templateVersion: input.snapshot.original.templateVersion,
            workflowScope: asJsonValue(input.snapshot.original.workflowScope),
            mirrorGeneration: input.snapshot.original.mirrorGeneration,
            step: STATE_STEP_PREPARED,
            status: "pending",
        };
        try {
            const state = await this.repository.createRevisionDocumentState(createInput);
            return { state, snapshot: input.snapshot, reason: null };
        } catch {
            return { state: null, snapshot: null, reason: REASON_STATE_CAS_LOST };
        }
    }

    private readSnapshot(value: unknown): ServiceRecordContractRevisionSnapshot | null {
        if (!isRecord(value) || !isRecord(value["original"]) || !isRecord(value["target"])) return null;
        const original = value["original"];
        const target = value["target"];
        if (!isNonEmptyString(original["documentId"])
            || !isDocumentVersion(original["documentVersion"])
            || !isNonEmptyString(original["templateId"])
            || !isNonEmptyString(original["templateVersion"])
            || !isWorkflowScope(original["workflowScope"])
            || !isNonEmptyString(original["mirrorGeneration"])
            || !isStage(original["stage"])
            || !isParticipant(original["participant"])
            || !(original["receivedDate"] === null || isIsoDate(original["receivedDate"]))
            || !(original["receivedAmount"] === null || isNonEmptyString(original["receivedAmount"]))
            || !isIsoDate(original["startDate"])
            || !isIsoDate(original["endDate"])
            || !Array.isArray(original["allowedFieldIds"])
            || !original["allowedFieldIds"].every(isNonEmptyString)
            || !fieldsAreRecord(original["fields"])
            || !isIsoDate(target["startDate"])
            || !isIsoDate(target["endDate"])
            || !isNonEmptyString(target["receiptPeriod"])
            || !fieldsAreRecord(target["fields"])) {
            return null;
        }
        return {
            original: {
                documentId: original["documentId"],
                documentVersion: original["documentVersion"],
                templateId: original["templateId"],
                templateVersion: original["templateVersion"],
                workflowScope: original["workflowScope"],
                mirrorGeneration: original["mirrorGeneration"],
                stage: original["stage"],
                participant: original["participant"],
                receivedDate: original["receivedDate"],
                receivedAmount: original["receivedAmount"],
                startDate: original["startDate"],
                endDate: original["endDate"],
                allowedFieldIds: [...original["allowedFieldIds"]],
                fields: { ...original["fields"] },
            },
            target: {
                startDate: target["startDate"],
                endDate: target["endDate"],
                receiptPeriod: target["receiptPeriod"],
                fields: { ...target["fields"] },
            },
        };
    }

    private validateSnapshot(snapshot: ServiceRecordContractRevisionSnapshot | null): string | null {
        if (!snapshot) return REASON_INVALID_INPUT;
        const original = snapshot.original;
        const target = snapshot.target;
        if (!isNonEmptyString(original.documentId)
            || !isDocumentVersion(original.documentVersion)
            || !isNonEmptyString(original.templateId)
            || !isNonEmptyString(original.templateVersion)
            || !isWorkflowScope(original.workflowScope)
            || !isNonEmptyString(original.mirrorGeneration)
            || !isStage(original.stage)
            || !isParticipant(original.participant)
            || !isIsoDate(original.startDate)
            || !isIsoDate(original.endDate)
            || !isIsoDate(target.startDate)
            || !isIsoDate(target.endDate)
            || target.startDate > target.endDate
            || original.startDate > original.endDate
            || !/^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(target.receiptPeriod)
            || target.receiptPeriod !== `${target.startDate}~${target.endDate}`
            || !Array.isArray(original.allowedFieldIds)
            || original.allowedFieldIds.length === 0
            || !original.allowedFieldIds.every(isNonEmptyString)
            || !fieldsAreRecord(original.fields)
            || !fieldsAreRecord(target.fields)) {
            return REASON_INVALID_INPUT;
        }
        if (!isIsoDate(original.receivedDate) || !isNonEmptyString(original.receivedAmount)) {
            return REASON_INVALID_INPUT;
        }
        const allowed = new Set(original.allowedFieldIds);
        if (Object.keys(target.fields).some((fieldId) => !allowed.has(fieldId) || hasForbiddenField(fieldId))) {
            return REASON_INVALID_INPUT;
        }
        return null;
    }

    private validateCapability(
        capability: ServiceRecordContractRevisionCapabilityEvidence | undefined,
        snapshot: ServiceRecordContractRevisionSnapshot,
    ): string | null {
        if (!capability || capability.status !== "verified") return REASON_CAPABILITY_UNVERIFIED;
        if (capability.templateId !== snapshot.original.templateId
            || capability.templateVersion !== snapshot.original.templateVersion
            || !sameScope(capability.workflowScope, snapshot.original.workflowScope)
            || !capability.operations.length) {
            return REASON_CAPABILITY_MISMATCH;
        }
        if (snapshot.original.stage === "signature_pending") return null;
        const required = this.requiredOperation(snapshot.original.stage);
        return capability.operations.includes(required) ? null : REASON_CAPABILITY_UNVERIFIED;
    }

    private preservedReceipt(snapshot: ServiceRecordContractRevisionSnapshot): {
        receivedDate: string;
        receivedAmount: string;
    } {
        if (!isIsoDate(snapshot.original.receivedDate) || !isNonEmptyString(snapshot.original.receivedAmount)) {
            throw new Error(REASON_INVALID_INPUT);
        }
        return {
            receivedDate: snapshot.original.receivedDate,
            receivedAmount: snapshot.original.receivedAmount,
        };
    }

    private requiredOperation(stage: ServiceRecordContractRevisionWorkflowStage): ServiceRecordContractRevisionProviderOperation {
        switch (stage) {
            case "provider_review": return "request_review_rejection";
            case "provider_participant": return "update_participant_fields";
            case "completed": return "create_replacement_document";
            case "signature_pending": return "update_participant_fields";
            case "unsupported": return "update_participant_fields";
            default: return "update_participant_fields";
        }
    }

    private async processProviderReview(
        state: ServiceRecordRevisionDocumentState,
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const observation = await this.inspect(snapshot, input);
        if (!observation) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_READ_FAILED);
        if (!this.matchesOriginal(observation, snapshot)) {
            if (observation.stage === "provider_participant") {
                return this.processProviderParticipant(state, snapshot, input, observation);
            }
            return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
        }
        if (observation.stage !== "provider_review") {
            return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
        }

        const prepared = await this.advanceTo(state, STATE_STEP_REVIEW_CLAIM, "processing", null);
        if (!prepared.state) return prepared;
        state = prepared.state;
        const claiming = await this.claim(state, input, STATE_STEP_REVIEW_CLAIM);
        if (claiming.kind === "error") return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", claiming.reason);
        if (claiming.kind === "reconcile") {
            const reconciled = await this.inspect(snapshot, input);
            if (reconciled?.stage === "provider_participant" && this.matchesOriginal(reconciled, snapshot)) {
                return this.processProviderParticipant(state, snapshot, input, reconciled);
            }
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_DISPATCH_UNCERTAIN);
        }
        if (claiming.kind === "already_accepted") {
            const reconciled = await this.inspect(snapshot, input);
            if (reconciled?.stage === "provider_participant" && this.matchesOriginal(reconciled, snapshot)) {
                return this.processProviderParticipant(state, snapshot, input, reconciled);
            }
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }

        try {
            await this.provider.requestReviewRejection({
                documentId: snapshot.original.documentId,
                workflowScope: snapshot.original.workflowScope,
                comment: "서비스 기간 변경에 따른 계약서 재검토 요청",
            });
        } catch {
            return this.reconcileMutation(state, snapshot, input, claiming.claimToken, "provider_review");
        }
        const accepted = await this.markAccepted(claiming.claimToken, null);
        if (!accepted) {
            await this.markUncertain(claiming.claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }
        const after = await this.inspect(snapshot, input);
        if (!after) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_READ_FAILED);
        if (after.stage !== "provider_participant" || !this.matchesOriginal(after, snapshot)) {
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_STATE_CHANGED);
        }
        const progressed = await this.advanceTo(state, STATE_STEP_REVIEW_REQUESTED, "processing", null);
        if (!progressed.state) return progressed;
        return this.processProviderParticipant(progressed.state, snapshot, input, after);
    }

    /**
     * An unknown state may represent a mutation that succeeded before its
     * response was lost. Query the authoritative document/replacement first;
     * only an observation that proves no mutation occurred is allowed to
     * continue into the durable retry CAS below.
     */
    private async reconcileUnknownBeforeRetry(
        state: ServiceRecordRevisionDocumentState,
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
    ): Promise<ServiceRecordContractRevisionProcessResult | null> {
        const observed = await this.inspect(snapshot, input);
        if (!observed) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_READ_FAILED);

        switch (snapshot.original.stage) {
            case "provider_review": {
                if (!this.matchesOriginal(observed, snapshot)) {
                    if (observed.stage === "provider_participant") {
                        return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
                    }
                    return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
                }
                if (observed.stage !== "provider_participant") return null;
                const accepted = await this.acceptRecoveredClaim(state, input, STATE_STEP_REVIEW_CLAIM, null);
                if (!accepted) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_DISPATCH_UNCERTAIN);
                return this.processProviderParticipant(state, snapshot, input, observed);
            }
            case "provider_participant": {
                if (observed.stage !== "provider_participant" || !this.matchesOriginal(observed, snapshot)) {
                    return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
                }
                if (!this.matchesDesiredFields(observed, snapshot)) return null;
                const accepted = await this.acceptRecoveredClaim(state, input, STATE_STEP_PARTICIPANT_CLAIM, null);
                if (!accepted) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_DISPATCH_UNCERTAIN);
                return this.advanceTo(state, STATE_STEP_PARTICIPANT_UPDATED, "waiting_for_signature", null);
            }
            case "completed": {
                if (observed.stage !== "completed" || !this.matchesOriginal(observed, snapshot)) {
                    return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
                }
                const replacement = await this.provider.findReplacementDocument({
                    sourceDocumentId: snapshot.original.documentId,
                    operationFingerprint: state.inputFingerprint,
                    branchId: input.branchId,
                    clientId: input.clientId,
                }).catch(() => null);
                if (!replacement) return null;
                const accepted = await this.acceptRecoveredClaim(
                    state,
                    input,
                    STATE_STEP_REPLACEMENT_CLAIM,
                    replacement.documentId,
                );
                if (!accepted) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_DISPATCH_UNCERTAIN);
                return this.advanceTo(
                    state,
                    STATE_STEP_REPLACEMENT_CREATED,
                    "waiting_for_signature",
                    null,
                    replacement.documentId,
                );
            }
            default:
                return null;
        }
    }

    private async processProviderParticipant(
        state: ServiceRecordRevisionDocumentState,
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
        knownObservation?: ServiceRecordContractRevisionDocumentObservation,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const observation = knownObservation ?? await this.inspect(snapshot, input);
        if (!observation) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_READ_FAILED);
        if (observation.stage !== "provider_participant" || !this.matchesOriginal(observation, snapshot)) {
            return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
        }

        const prepared = await this.advanceTo(state, STATE_STEP_PARTICIPANT_CLAIM, "processing", null);
        if (!prepared.state) return prepared;
        state = prepared.state;
        const claiming = await this.claim(state, input, STATE_STEP_PARTICIPANT_CLAIM);
        if (claiming.kind === "error") return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", claiming.reason);
        if (claiming.kind === "reconcile" || claiming.kind === "already_accepted") {
            const reconciled = await this.inspect(snapshot, input);
            if (reconciled && this.matchesDesiredFields(reconciled, snapshot)) {
                return this.advanceTo(state, STATE_STEP_PARTICIPANT_UPDATED, "waiting_for_signature", null);
            }
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }

        try {
            await this.provider.updateParticipantFields({
                documentId: snapshot.original.documentId,
                fields: { ...snapshot.target.fields },
                preservedReceipt: this.preservedReceipt(snapshot),
                workflowScope: snapshot.original.workflowScope,
            });
        } catch {
            return this.reconcileMutation(state, snapshot, input, claiming.claimToken, "provider_participant");
        }
        const accepted = await this.markAccepted(claiming.claimToken, null);
        if (!accepted) {
            await this.markUncertain(claiming.claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }
        const after = await this.inspect(snapshot, input);
        if (!after || !this.matchesDesiredFields(after, snapshot)) {
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }
        return this.advanceTo(state, STATE_STEP_PARTICIPANT_UPDATED, "waiting_for_signature", null);
    }

    private async processCompleted(
        state: ServiceRecordRevisionDocumentState,
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const observation = await this.inspect(snapshot, input);
        if (!observation) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_READ_FAILED);
        if (observation.stage !== "completed" || !this.matchesOriginal(observation, snapshot)) {
            return this.advanceTo(state, STATE_STEP_MANUAL_REVIEW, "manual_review", REASON_PROVIDER_STATE_CHANGED);
        }

        const prepared = await this.advanceTo(state, STATE_STEP_REPLACEMENT_CLAIM, "processing", null);
        if (!prepared.state) return prepared;
        state = prepared.state;
        const claiming = await this.claim(state, input, STATE_STEP_REPLACEMENT_CLAIM);
        if (claiming.kind === "error") return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", claiming.reason);
        if (claiming.kind === "reconcile" || claiming.kind === "already_accepted") {
            const replacement = await this.provider.findReplacementDocument({
                sourceDocumentId: snapshot.original.documentId,
                operationFingerprint: state.inputFingerprint,
                branchId: input.branchId,
                clientId: input.clientId,
            });
            if (!replacement) return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
            return this.advanceTo(
                state,
                STATE_STEP_REPLACEMENT_CREATED,
                "waiting_for_signature",
                null,
                replacement.documentId,
            );
        }

        let replacement: { documentId: string };
        try {
            replacement = await this.provider.createReplacementDocument({
                sourceDocumentId: snapshot.original.documentId,
                templateId: snapshot.original.templateId,
                templateVersion: snapshot.original.templateVersion,
                fields: { ...snapshot.target.fields },
                preservedReceipt: this.preservedReceipt(snapshot),
                recipient: { ...snapshot.original.participant },
                workflowScope: snapshot.original.workflowScope,
                operationFingerprint: state.inputFingerprint,
            });
        } catch {
            const reconciled = await this.provider.findReplacementDocument({
                sourceDocumentId: snapshot.original.documentId,
                operationFingerprint: state.inputFingerprint,
                branchId: input.branchId,
                clientId: input.clientId,
            }).catch(() => null);
            if (!reconciled) {
                await this.markUncertain(claiming.claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
                return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
            }
            replacement = reconciled;
        }
        const accepted = await this.markAccepted(claiming.claimToken, replacement.documentId);
        if (!accepted) {
            await this.markUncertain(claiming.claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
            return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
        }
        return this.advanceTo(
            state,
            STATE_STEP_REPLACEMENT_CREATED,
            "waiting_for_signature",
            null,
            replacement.documentId,
        );
    }

    private async inspect(
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
    ): Promise<ServiceRecordContractRevisionDocumentObservation | null> {
        try {
            return await this.provider.inspectDocument({
                documentId: snapshot.original.documentId,
                branchId: input.branchId,
                clientId: input.clientId,
                revisionId: input.revisionId,
            });
        } catch {
            return null;
        }
    }

    private matchesOriginal(
        observation: ServiceRecordContractRevisionDocumentObservation,
        snapshot: ServiceRecordContractRevisionSnapshot,
    ): boolean {
        return observation.documentId === snapshot.original.documentId
            && observation.templateId === snapshot.original.templateId
            && observation.templateVersion === snapshot.original.templateVersion
            && sameScope(observation.workflowScope, snapshot.original.workflowScope)
            && observation.participant.id === snapshot.original.participant.id
            && observation.participant.name === snapshot.original.participant.name
            && observation.participant.phone === snapshot.original.participant.phone;
    }

    private matchesDesiredFields(
        observation: ServiceRecordContractRevisionDocumentObservation,
        snapshot: ServiceRecordContractRevisionSnapshot,
    ): boolean {
        return Object.entries(snapshot.target.fields).every(([fieldId, value]) => observation.fields[fieldId] === value);
    }

    private async claim(
        state: ServiceRecordRevisionDocumentState,
        input: ServiceRecordContractRevisionProcessInput,
        step: string,
    ): Promise<
        | { kind: "claimed"; claimToken: string }
        | { kind: "already_accepted"; claimToken: string | null }
        | { kind: "reconcile"; claimToken: string | null }
        | { kind: "error"; reason: string }
    > {
        try {
            const claim = await this.dispatch.claim({
                branchId: input.branchId,
                clientId: input.clientId,
                serviceRecordCaseId: input.serviceRecordCaseId,
                revisionId: input.revisionId,
                generation: input.generation,
                operation: CONTRACT_PERIOD_OPERATION,
                step,
                inputFingerprint: state.inputFingerprint,
            });
            if (claim.disposition === "claimed") {
                if (!isNonEmptyString(claim.claimToken)) return { kind: "error", reason: REASON_DISPATCH_UNAVAILABLE };
                return { kind: "claimed", claimToken: claim.claimToken };
            }
            if (claim.disposition === "already_accepted") {
                return { kind: "already_accepted", claimToken: claim.claimToken };
            }
            return { kind: "reconcile", claimToken: claim.claimToken };
        } catch {
            return { kind: "error", reason: REASON_DISPATCH_UNAVAILABLE };
        }
    }

    private async acceptRecoveredClaim(
        state: ServiceRecordRevisionDocumentState,
        input: ServiceRecordContractRevisionProcessInput,
        step: string,
        providerDocumentId: string | null,
    ): Promise<boolean> {
        const claiming = await this.claim(state, input, step);
        if (claiming.kind === "error") return false;
        if (claiming.kind === "already_accepted") return true;
        if (!claiming.claimToken) return false;
        const accepted = await this.markAccepted(claiming.claimToken, providerDocumentId);
        if (!accepted) await this.markUncertain(claiming.claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
        return accepted;
    }

    private async markAccepted(claimToken: string | null, providerDocumentId: string | null): Promise<boolean> {
        if (!claimToken) return false;
        try {
            await this.dispatch.markAccepted(claimToken, providerDocumentId);
            return true;
        } catch {
            return false;
        }
    }

    private async markUncertain(claimToken: string | null, reason: string): Promise<void> {
        if (!claimToken) return;
        await this.dispatch.markUncertain(claimToken, reason).catch(() => undefined);
    }

    private async reconcileMutation(
        state: ServiceRecordRevisionDocumentState,
        snapshot: ServiceRecordContractRevisionSnapshot,
        input: ServiceRecordContractRevisionProcessInput,
        claimToken: string | null,
        stage: "provider_review" | "provider_participant",
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const observed = await this.inspect(snapshot, input);
        if (stage === "provider_review"
            && observed?.stage === "provider_participant"
            && this.matchesOriginal(observed, snapshot)) {
            const accepted = await this.markAccepted(claimToken, null);
            if (!accepted) {
                await this.markUncertain(claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
                return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
            }
            return this.processProviderParticipant(state, snapshot, input, observed);
        }
        if (stage === "provider_participant" && observed && this.matchesDesiredFields(observed, snapshot)) {
            const accepted = await this.markAccepted(claimToken, null);
            if (accepted) return this.advanceTo(state, STATE_STEP_PARTICIPANT_UPDATED, "waiting_for_signature", null);
        }
        await this.markUncertain(claimToken, REASON_PROVIDER_OUTCOME_UNKNOWN);
        return this.advanceTo(state, STATE_STEP_UNKNOWN, "unknown", REASON_PROVIDER_OUTCOME_UNKNOWN);
    }

    private async advanceTo(
        state: ServiceRecordRevisionDocumentState,
        step: string,
        status: ServiceRecordRevisionDocumentStatus,
        reason: string | null,
        targetDocumentId?: string | null,
    ): Promise<ServiceRecordContractRevisionProcessResult> {
        const patch: AdvanceServiceRecordRevisionDocumentStateInput = {
            branchId: state.branchId,
            clientId: state.clientId,
            stateId: state.id,
            expectedGeneration: state.generation,
            expectedVersion: state.version,
            step,
            status,
            lastErrorCode: reason,
            expectedDocumentVersion: state.documentVersion,
            expectedTargetDocumentId: state.targetDocumentId,
            expectedMirrorGeneration: state.mirrorGeneration,
            ...(targetDocumentId !== undefined ? { targetDocumentId } : {}),
        };
        let next: ServiceRecordRevisionDocumentState | null;
        try {
            next = await this.repository.advanceRevisionDocumentState(patch);
        } catch {
            return stateResult(null, REASON_STATE_CAS_LOST, targetDocumentId ?? null);
        }
        if (!next) return stateResult(null, REASON_STATE_CAS_LOST, targetDocumentId ?? null);
        return stateResult(next, reason, targetDocumentId ?? next.targetDocumentId);
    }
}
