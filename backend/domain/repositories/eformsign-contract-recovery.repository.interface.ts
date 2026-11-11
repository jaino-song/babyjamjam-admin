import type { EformsignDocumentJobPayload } from "domain/entities/eformsign-document-job.entity";
import type { EformsignDispatchIntentEntity } from "domain/entities/eformsign-dispatch-intent.entity";
import type { PrepareEformsignDispatchIntentInput } from "./eformsign-dispatch-intent.repository.interface";

export const EFORMSIGN_CONTRACT_RECOVERY_REPOSITORY = "EFORMSIGN_CONTRACT_RECOVERY_REPOSITORY";
export const EFORMSIGN_CONTRACT_DRAFT_DISPATCH = "EFORMSIGN_CONTRACT_DRAFT_DISPATCH";
export interface ContractWorkerContext { jobId: string; leaseToken: string; contractGeneration: string }
export interface ContractRecoveryClaim { jobId: string; branchId: string; userId: string; claimEpoch: bigint }
export interface ContractRecoveryState {
    jobId: string; branchId: string; clientId: number; generation: string; fingerprint: string;
    payload: EformsignDocumentJobPayload; phase: string; priorDocumentId: string | null; providerDocumentId: string | null;
    claimEpoch: bigint; claimUserId: string | null; claimExpiresAt: Date | null;
    creationIntent: EformsignDispatchIntentEntity | null; draftIntent: EformsignDispatchIntentEntity | null;
}
export interface ContractDocumentEvidence {
    documentName?: string | null; documentNumber?: string | null; templateName?: string | null;
    creatorName?: string | null; lastEditorName?: string | null; stepRecipientTypes?: string[];
    documentId: string; templateId: string; companyId: string; creatorId: string;
    statusType: string; stepType: string; stepIndex: string; stepName: string; confirmed: boolean;
    createdAt: Date; updatedAt: Date; expiresAt: Date;
}
export interface ContractDraftDispatch {
    dispatchDraft(input: { documentOption: Record<string, unknown>; beforeOpen: () => Promise<boolean> }): Promise<
        { ok: true; candidateDocumentId: string; durationMs: number } | { ok: false; reason: string; uncertain: boolean; durationMs: number }
    >;
}
export class ContractRecoveryError extends Error {
    constructor(readonly code: string, readonly status = 409, readonly reason?: string, readonly expiresAt?: Date) { super(code); }
}
export interface IEformsignContractRecoveryRepository {
    claimCreation(input: PrepareEformsignDispatchIntentInput, worker: ContractWorkerContext, effect: { contractData: unknown; force?: boolean; workflow?: unknown }): Promise<{
        intent: EformsignDispatchIntentEntity; disposition: "claimed" | "already_accepted" | "uncertain";
    }>;
    claimLegacyCreation(input: PrepareEformsignDispatchIntentInput): Promise<{ intent: EformsignDispatchIntentEntity; disposition: "claimed" | "already_accepted" | "uncertain" }>;
    claimProvider(input: PrepareEformsignDispatchIntentInput): Promise<{ intent: EformsignDispatchIntentEntity; disposition: "claimed" | "already_accepted" | "uncertain" }>;
    readWorker(worker: ContractWorkerContext): Promise<ContractRecoveryState>;
    completeAutomatic(worker: ContractWorkerContext, evidence: ContractDocumentEvidence): Promise<void>;
    markAutomaticUncertain(worker: ContractWorkerContext): Promise<void>;
    recoverBeforeCreation(worker: ContractWorkerContext, nextAttemptAt: Date | null, errorCode: string): Promise<"retry" | "failed" | null>;
    open(jobId: string, branchId: string, userId: string): Promise<ContractRecoveryState>;
    readClaim(claim: ContractRecoveryClaim): Promise<ContractRecoveryState>;
    beginDraft(claim: ContractRecoveryClaim, templateId: string, identity: { companyId: string; creatorId: string; workflow: unknown }): Promise<EformsignDispatchIntentEntity>;
    beforeDraftOpen(claim: ContractRecoveryClaim, intentId: string): Promise<boolean>;
    markDraftUncertain(claim: ContractRecoveryClaim, intentId: string): Promise<void>;
    releaseDraftBeforeOpen(claim: ContractRecoveryClaim, intentId: string): Promise<void>;
    recordDraftCandidate(claim: ContractRecoveryClaim, intentId: string, documentId: string): Promise<void>;
    bindDocument(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence, draftIntentId?: string): Promise<ContractRecoveryState>;
    expose(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence): Promise<boolean>;
    reexposeHuman(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence): Promise<void>;
    completeManual(claim: ContractRecoveryClaim, evidence: ContractDocumentEvidence): Promise<void>;
}
