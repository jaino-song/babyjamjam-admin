import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchAction,
    EformsignDispatchIntentEntity,
    EformsignDispatchIntentStatus,
} from "domain/entities/eformsign-dispatch-intent.entity";

export interface PrepareEformsignDispatchIntentInput {
    branchId: string;
    clientId?: number | null;
    localDocumentId?: number | null;
    assignmentId?: number | null;
    providerDocumentId?: string | null;
    templateId?: string | null;
    action: EformsignDispatchAction;
    generation: string;
    businessKey: string;
    fingerprint: string;
}

export interface ReconcileEformsignDispatchIntentInput {
    branchId: string;
    intentId: string;
    /** Optional attempt token read by the operator; the repository always CASes the observed count. */
    attemptCount?: number;
    outcome: "delivered" | "not_delivered";
    actorUserId: string;
    reason: string;
    providerDocumentId?: string | null;
}

export interface EformsignDispatchIntentIdentityInput {
    branchId: string;
    clientId: number | null;
    assignmentId: number | null;
    templateId: string | null;
}

export interface IEformsignDispatchIntentRepository {
    prepare(input: PrepareEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity>;
    claim(
        intentId: string,
        branchId: string,
    ): Promise<{ intent: EformsignDispatchIntentEntity; claimed: boolean } | null>;
    markAccepted(
        intentId: string,
        branchId: string,
        attemptCount: number,
        providerDocumentId: string,
        providerReceipt?: unknown,
    ): Promise<EformsignDispatchIntentEntity | null>;
    markUncertain(
        intentId: string,
        branchId: string,
        attemptCount: number,
        reason: string,
        providerDocumentId?: string | null,
    ): Promise<EformsignDispatchIntentEntity | null>;
    releaseBeforeSend(
        intentId: string,
        branchId: string,
        attemptCount: number,
        reason: string,
    ): Promise<EformsignDispatchIntentEntity | null>;
    reconcile(input: ReconcileEformsignDispatchIntentInput): Promise<EformsignDispatchIntentEntity | null>;
    findById(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null>;
    /**
     * Returns the latest successful cancellation for the exact create scope.
     * The cancellation row is retained after mirror purge, so this is the
     * source of the next reissue generation.
     */
    findLatestSuccessfulCancellation(
        input: EformsignDispatchIntentIdentityInput,
    ): Promise<EformsignDispatchIntentEntity | null>;
    /** A pending cancellation fences a new create in the same scope. */
    findPendingCancellation(
        input: EformsignDispatchIntentIdentityInput,
    ): Promise<EformsignDispatchIntentEntity | null>;
}

export const EFORMSIGN_DISPATCH_INTENT_REPOSITORY = "EFORMSIGN_DISPATCH_INTENT_REPOSITORY";

export function isDispatchIntentTerminal(status: EformsignDispatchIntentStatus): boolean {
    return status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
        || status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED;
}
