import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
} from "@nestjs/common";

import {
    EformsignCredentialBoundary,
    type EformsignProviderPrincipal,
    assertEformsignProviderCapability,
} from "application/services/eformsign-credential-boundary.service";
import { EformsignService } from "application/services/eformsign.service";
import {
    classifyEformsignCancellationError,
    classifyEformsignCancellationResult,
    sanitizeEformsignCancellationReceipt,
    type EformsignCancellationOutcome,
} from "application/utils/eformsign-cancellation";
import {
    EFORMSIGN_CANCELLATION_REPOSITORY,
    type EformsignCancellationReconcileResult,
    type EformsignCancellationTarget,
    type IEformsignCancellationRepository,
} from "domain/repositories/eformsign-cancellation.repository.interface";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    type EformsignApiDocumentResponse,
    type IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import { UNASSIGNED_TERMINAL_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { isEformsignDocumentAbsentError } from "infrastructure/api/eformsign-api.error";
import { EFORMSIGN_DISPATCH_INTENT_STATUS } from "domain/entities/eformsign-dispatch-intent.entity";

export interface CancelEformsignDocumentsParams {
    branchId: string;
    documentIds: string[];
    actorUserId: string;
    reason?: string;
    comment?: string;
}

export interface CancelEformsignDocumentsResult {
    result: {
        success_result: string[];
        fail_result: Array<{
            document_id: string;
            outcome: "authoritative_refusal" | "uncertain" | "reconciled_not_delivered";
            code?: string;
        }>;
    };
    unresolved_document_ids: string[];
    cancellation_intent_ids: string[];
}

/**
 * Orchestrates a durable cancellation claim around the provider call. The
 * repository commits the intent and purge fence before this use case reads
 * credentials. Completion is then an atomic local CAS plus mirror purge.
 */
@Injectable()
export class CancelEformsignDocumentsUsecase {
    constructor(
        @Inject(EFORMSIGN_CANCELLATION_REPOSITORY)
        private readonly cancellationRepository: IEformsignCancellationRepository,
        private readonly eformsignService: EformsignService,
        private readonly credentialBoundary: EformsignCredentialBoundary,
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    async execute(
        params: CancelEformsignDocumentsParams,
        principal: EformsignProviderPrincipal,
    ): Promise<CancelEformsignDocumentsResult> {
        const branchId = params.branchId.trim();
        const actorUserId = params.actorUserId.trim();
        const documentIds = normalizeDocumentIds(params.documentIds);
        if (!branchId || !actorUserId || documentIds.length === 0) {
            throw new ConflictException("전자문서 취소 요청이 올바르지 않습니다.");
        }
        if (principal.branchId !== branchId) {
            throw new ForbiddenException("전자문서 취소 지점 권한이 없습니다.");
        }

        const { targets } = await this.cancellationRepository.begin({
            branchId,
            documentIds,
            actorUserId,
            reason: normalizeReason(params.reason ?? "관리자 삭제"),
        });
        const activeTargets = targets.filter((target) => !isCancellationTerminal(target));
        const acceptedIds = new Set(targets
            .filter((target) => isCancellationAccepted(target))
            .map((target) => target.documentId));
        const outcomes: EformsignCancellationOutcome[] = [];

        if (activeTargets.length > 0) {
            let providerResult: unknown;
            try {
                providerResult = await this.credentialBoundary.withCredentials(
                    principal,
                    "document.cancel",
                    ({ accessToken }) => this.eformsignService.cancelDocuments(
                        accessToken,
                        activeTargets.map((target) => target.providerDocumentId),
                        params.comment?.trim() || "관리자 삭제",
                    ),
                );
                outcomes.push(...classifyEformsignCancellationResult(
                    providerResult,
                    activeTargets.map((target) => target.documentId),
                ));
            } catch (error) {
                const classified = classifyEformsignCancellationError(error);
                outcomes.push(...activeTargets.map((target) => ({
                    ...classified,
                    documentId: target.documentId,
                })));
                await this.persistOutcomes(activeTargets, outcomes, actorUserId);
                throw error;
            }
            await this.persistOutcomes(activeTargets, outcomes, actorUserId);
            for (const outcome of outcomes) {
                if (outcome.decision === "accepted") acceptedIds.add(outcome.documentId);
            }
        }

        const failResult: CancelEformsignDocumentsResult["result"]["fail_result"] = [];
        for (const target of targets) {
            if (isCancellationAccepted(target)) continue;
            const outcome = outcomes.find((item) => item.documentId === target.documentId);
            if (outcome) {
                if (outcome.decision === "accepted") continue;
                failResult.push({
                    document_id: target.documentId,
                    outcome: outcome.decision,
                    ...(outcome.vendorCode ? { code: outcome.vendorCode } : {}),
                });
                continue;
            }
            if (target.cancellationIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED) {
                failResult.push({
                    document_id: target.documentId,
                    outcome: "reconciled_not_delivered",
                });
                continue;
            }
            failResult.push({
                document_id: target.documentId,
                outcome: "uncertain",
            });
        }

        const unresolved = [...new Set(failResult.map((failure) => failure.document_id))];
        return {
            result: {
                success_result: [...acceptedIds],
                fail_result: failResult,
            },
            unresolved_document_ids: unresolved,
            cancellation_intent_ids: targets.map((target) => target.cancellationIntent.id),
        };
    }

    async reconcile(
        input: Parameters<IEformsignCancellationRepository["reconcile"]>[0],
        principal: EformsignProviderPrincipal,
    ): Promise<EformsignCancellationReconcileResult> {
        const branchId = input.branchId.trim();
        const intentId = input.intentId.trim();
        const actorUserId = input.actorUserId.trim();
        if (
            principal.branchId !== branchId
            || principal.userId !== actorUserId
            || (principal.globalRole !== "owner" && principal.branchRole !== "admin")
        ) {
            throw new ForbiddenException("전자문서 취소 확인 권한이 없습니다.");
        }

        const normalizedInput = {
            ...input,
            branchId,
            intentId,
            actorUserId,
            reason: input.reason.trim().slice(0, 500),
            providerDocumentId: input.providerDocumentId?.trim() || undefined,
        };
        if (normalizedInput.outcome === "delivered") {
            const proof = await this.verifyDeliveredProviderState(normalizedInput, principal);
            normalizedInput.reason = `${normalizedInput.reason} [provider_${proof.kind}_verified]`.slice(0, 500);
        }
        return this.cancellationRepository.reconcile(normalizedInput);
    }

    /**
     * A client-supplied `outcome=delivered` is not evidence that a cancellation
     * reached eformsign. Before allowing the repository to purge, read the
     * exact branch-owned provider id and require an authoritative terminal
     * detail or a documented absence response. Ambiguous vendor errors remain
     * uncertain and retain the purge fence.
     */
    private async verifyDeliveredProviderState(
        input: Parameters<IEformsignCancellationRepository["reconcile"]>[0],
        principal: EformsignProviderPrincipal,
    ): Promise<{ kind: "absence" | "terminal"; statusType?: string }> {
        const existing = await this.cancellationRepository.findByIntentId(
            input.branchId,
            input.intentId,
        );
        if (!existing || existing.action !== "cancel" || existing.branchId !== input.branchId) {
            throw new ForbiddenException("전자문서 취소 확인 권한이 없습니다.");
        }
        const providerDocumentId = existing.providerDocumentId?.trim();
        if (!providerDocumentId) {
            throw new ConflictException("provider 상태를 확인할 전자문서 id가 없습니다.");
        }
        if (
            input.providerDocumentId
            && input.providerDocumentId.trim() !== providerDocumentId
        ) {
            throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
        }

        assertEformsignProviderCapability(principal, "document.read");
        try {
            const remote = await this.credentialBoundary.withCredentials(
                principal,
                "document.read",
                ({ accessToken }) => this.eformsignClient.getDocument(
                    accessToken,
                    providerDocumentId,
                ),
            );
            if (!isEformsignDocumentIdentity(remote, providerDocumentId)) {
                throw new ConflictException("provider 전자문서 소유 범위를 확인할 수 없습니다.");
            }
            const statusType = normalizeEformsignStatusCode(remote.current_status?.status_type);
            if (!UNASSIGNED_TERMINAL_STATUS_CODES.has(statusType)) {
                throw new ConflictException("provider가 취소 완료 또는 문서 부재를 확인하지 않았습니다.");
            }
            return { kind: "terminal", statusType };
        } catch (error) {
            if (isEformsignDocumentAbsentError(error)) {
                return { kind: "absence" };
            }
            if (error instanceof ConflictException) throw error;
            // 4000031 means the provider cannot establish absence on its own;
            // it must never be treated as a successful delivered proof.
            throw new ConflictException("provider 취소 결과를 확인할 수 없어 수동 재검증이 필요합니다.");
        }
    }

    private async persistOutcomes(
        targets: EformsignCancellationTarget[],
        outcomes: EformsignCancellationOutcome[],
        actorUserId: string,
    ): Promise<void> {
        for (const target of targets) {
            const outcome = outcomes.find((item) => item.documentId === target.documentId)
                ?? {
                    documentId: target.documentId,
                    decision: "uncertain" as const,
                    reason: "provider_cancel_result_missing_document",
                };
            const receipt = sanitizeEformsignCancellationReceipt({
                decision: outcome.decision,
                documentId: target.documentId,
                vendorCode: outcome.vendorCode,
            });
            if (outcome.decision === "accepted") {
                await this.cancellationRepository.completeAccepted({
                    target,
                    providerReceipt: receipt,
                });
            } else if (outcome.decision === "authoritative_refusal") {
                await this.cancellationRepository.clearAuthoritativeRefusal({
                    target,
                    reason: outcome.reason,
                    actorUserId,
                    providerReceipt: receipt,
                });
            } else {
                await this.cancellationRepository.markUncertain({
                    target,
                    reason: outcome.reason,
                    providerDocumentId: target.providerDocumentId,
                    providerReceipt: receipt,
                });
            }
        }
    }
}

function isCancellationTerminal(target: EformsignCancellationTarget): boolean {
    return isCancellationAccepted(target)
        || target.cancellationIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED;
}

function isCancellationAccepted(target: EformsignCancellationTarget): boolean {
    return target.cancellationIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
        || target.cancellationIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED;
}

function normalizeDocumentIds(documentIds: string[]): string[] {
    return [...new Set(documentIds
        .filter((documentId): documentId is string => typeof documentId === "string")
        .map((documentId) => documentId.trim())
        .filter(Boolean))];
}

function normalizeReason(reason: string): string {
    return reason.replace(/\s+/g, " ").trim().slice(0, 500);
}

function isEformsignDocumentIdentity(
    remote: Pick<EformsignApiDocumentResponse, "id">,
    expectedId: string,
): boolean {
    return typeof remote.id === "string" && remote.id.trim() === expectedId;
}
