import {
    EformsignDispatchIntentEntity,
} from "domain/entities/eformsign-dispatch-intent.entity";

export const EFORMSIGN_CANCELLATION_REPOSITORY = "EFORMSIGN_CANCELLATION_REPOSITORY";

export interface BeginEformsignCancellationInput {
    branchId: string;
    documentIds: string[];
    actorUserId: string;
    reason: string;
}

export interface EformsignCancellationTarget {
    documentId: string;
    branchId: string;
    localDocumentId: number;
    clientId: number | null;
    assignmentId: number | null;
    templateId: string | null;
    providerDocumentId: string;
    sourceIntentId: string | null;
    sourceIntentStatus: string | null;
    purgeGeneration: Date;
    cancellationIntent: EformsignDispatchIntentEntity;
}

export interface BeginEformsignCancellationResult {
    targets: EformsignCancellationTarget[];
}

export interface CompleteEformsignCancellationInput {
    target: EformsignCancellationTarget;
    providerReceipt: unknown;
}

export interface MarkUncertainEformsignCancellationInput {
    target: EformsignCancellationTarget;
    reason: string;
    providerDocumentId?: string | null;
    providerReceipt?: unknown;
}

export interface ClearAuthoritativeEformsignCancellationInput {
    target: EformsignCancellationTarget;
    reason: string;
    actorUserId?: string | null;
    providerReceipt?: unknown;
}

export interface ReconcileEformsignCancellationInput {
    branchId: string;
    intentId: string;
    actorUserId: string;
    reason: string;
    /** `not_delivered` clears the fence; `delivered` records a terminal receipt. */
    outcome: "delivered" | "not_delivered";
    providerDocumentId?: string | null;
}

export interface EformsignCancellationReconcileResult {
    intent: EformsignDispatchIntentEntity;
    clearedPurgeFence: boolean;
}

/**
 * Narrow transaction boundary for cancellation. Implementations must lock the
 * branch-owned mirror row and matching dispatch intents before claiming the
 * cancellation. Provider calls never happen through this port.
 */
export interface IEformsignCancellationRepository {
    begin(input: BeginEformsignCancellationInput): Promise<BeginEformsignCancellationResult>;
    completeAccepted(input: CompleteEformsignCancellationInput): Promise<EformsignDispatchIntentEntity>;
    markUncertain(input: MarkUncertainEformsignCancellationInput): Promise<EformsignDispatchIntentEntity>;
    clearAuthoritativeRefusal(
        input: ClearAuthoritativeEformsignCancellationInput,
    ): Promise<EformsignDispatchIntentEntity>;
    reconcile(input: ReconcileEformsignCancellationInput): Promise<EformsignCancellationReconcileResult>;
    findByIntentId(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null>;
}
