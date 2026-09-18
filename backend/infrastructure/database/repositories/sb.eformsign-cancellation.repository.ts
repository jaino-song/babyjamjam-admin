import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import {
    EFORMSIGN_DISPATCH_INTENT_STATUS,
    EformsignDispatchIntentEntity,
    type EformsignDispatchAction,
    type EformsignDispatchIntentStatus,
} from "domain/entities/eformsign-dispatch-intent.entity";
import {
    type BeginEformsignCancellationInput,
    type ClearAuthoritativeEformsignCancellationInput,
    type CompleteEformsignCancellationInput,
    type EformsignCancellationReconcileResult,
    type EformsignCancellationTarget,
    EFORMSIGN_CANCELLATION_REPOSITORY,
    type IEformsignCancellationRepository,
    type MarkUncertainEformsignCancellationInput,
    type ReconcileEformsignCancellationInput,
} from "domain/repositories/eformsign-cancellation.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    purgeEformsignDocumentContentInTransaction,
} from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";

/**
 * The cancellation adapter owns the local side of the cancel transaction. It
 * intentionally never calls eformsign: callers must commit the durable claim,
 * leave the transaction, call the provider, then invoke one of the transition
 * methods below. This is what keeps a timeout from silently releasing the purge
 * fence or creating a duplicate cancellation attempt.
 */
@Injectable()
export class SbEformsignCancellationRepository implements IEformsignCancellationRepository {
    constructor(private readonly prisma: PrismaService) {}

    async begin(input: BeginEformsignCancellationInput): Promise<{ targets: EformsignCancellationTarget[] }> {
        const branchId = input.branchId.trim();
        const documentIds = normalizeDocumentIds(input.documentIds);
        const actorUserId = input.actorUserId.trim();
        const reason = normalizeReason(input.reason);
        if (!branchId || !actorUserId || !reason || documentIds.length === 0) {
            throw new ConflictException("전자문서 취소 요청이 올바르지 않습니다.");
        }

        return this.prisma.$transaction(async (tx) => {
            const mirrors = await tx.$queryRaw<MirrorRow[]>(Prisma.sql`
                SELECT
                    id,
                    document_id AS "documentId",
                    branch_id AS "branchId",
                    client_id AS "clientId",
                    employee_schedule_id AS "assignmentId",
                    template_id AS "templateId",
                    permanent_purge_requested_at AS "permanentPurgeRequestedAt"
                FROM eformsign_doc
                WHERE branch_id = ${branchId}::uuid
                  AND document_id IN (${Prisma.join(documentIds)})
                ORDER BY id
                FOR UPDATE
            `);
            if (mirrors.length !== documentIds.length) {
                throw new ConflictException("다른 지점의 전자문서는 취소할 수 없습니다.");
            }

            const mirrorIds = mirrors.map((mirror) => mirror.id);
            const intents = await tx.$queryRaw<IntentRow[]>(Prisma.sql`
                SELECT
                    id,
                    branch_id AS "branchId",
                    client_id AS "clientId",
                    local_document_id AS "localDocumentId",
                    assignment_id AS "assignmentId",
                    provider_document_id AS "providerDocumentId",
                    template_id AS "templateId",
                    action,
                    generation,
                    business_key AS "businessKey",
                    fingerprint,
                    status,
                    attempt_count AS "attemptCount",
                    started_at AS "startedAt",
                    provider_accepted_at AS "providerAcceptedAt",
                    uncertain_at AS "uncertainAt",
                    uncertain_reason AS "uncertainReason",
                    provider_receipt AS "providerReceipt",
                    reconciled_at AS "reconciledAt",
                    reconciled_outcome AS "reconciledOutcome",
                    reconciled_by_user_id AS "reconciledByUserId",
                    reconciliation_reason AS "reconciliationReason",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM eformsign_dispatch_intent
                WHERE branch_id = ${branchId}::uuid
                  AND (
                      local_document_id IN (${Prisma.join(mirrorIds)})
                      OR provider_document_id IN (${Prisma.join(documentIds)})
                  )
                ORDER BY updated_at DESC, created_at DESC
                FOR UPDATE
            `);

            const targets: EformsignCancellationTarget[] = [];
            for (const mirror of mirrors) {
                const candidates = intents.filter((intent) =>
                    intent.localDocumentId === mirror.id
                    || intent.providerDocumentId === mirror.documentId,
                );
                const sourceIntent = chooseSourceIntent(candidates, mirror);
                // A prepared create/finalize has not crossed the provider boundary and
                // remains cancellable so an abandoned preparation cannot block liveness.
                // Only started/uncertain attempts (which may have crossed the network)
                // are refused here; dispatch claim rechecks the same mirror fence under
                // lock before any provider call.
                const inFlightSourceIntent = candidates.find((intent) =>
                    (intent.action === "create" || intent.action === "finalize")
                    && (
                        intent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                        || intent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
                    ),
                );
                if (inFlightSourceIntent) {
                    throw new ConflictException("진행 중인 전자문서 작업이 있어 취소할 수 없습니다.");
                }

                const clientId = sourceIntent?.clientId ?? mirror.clientId;
                const assignmentId = sourceIntent?.assignmentId ?? mirror.assignmentId;
                const templateId = sourceIntent?.templateId ?? mirror.templateId;
                if (!sourceIntent && clientId === null) {
                    throw new ConflictException("기존 전자문서의 취소 범위를 확인할 수 없습니다.");
                }
                if (!sourceIntent) {
                    const scopeRows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
                        SELECT id
                        FROM eformsign_doc
                        WHERE branch_id = ${branchId}::uuid
                          AND client_id = ${clientId}
                          AND employee_schedule_id IS NOT DISTINCT FROM ${assignmentId}
                          AND template_id IS NOT DISTINCT FROM ${templateId}
                          AND status_type NOT IN ('049', '099')
                        ORDER BY id
                        FOR UPDATE
                    `);
                    if (scopeRows.length !== 1) {
                        throw new ConflictException("기존 전자문서의 취소 범위가 여러 건과 충돌합니다.");
                    }
                }

                const cancelIntent = candidates
                    .filter((intent) => intent.action === "cancel")
                    .sort(compareNewestIntent)[0];
                if (
                    cancelIntent
                    && (
                        cancelIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                        || cancelIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
                    )
                ) {
                    targets.push(this.toTarget(
                        mirror,
                        sourceIntent,
                        cancelIntent,
                        mirror.permanentPurgeRequestedAt ?? new Date(0),
                    ));
                    continue;
                }

                const now = new Date();
                const generation = cancelIntent
                    ? `${cancelIntent.generation}:retry:${cancelIntent.attemptCount + 1}`
                    : `cancel:${mirror.documentId}:${sourceIntent?.id ?? mirror.id}`;
                const businessKey = buildCancellationBusinessKey({
                    branchId,
                    documentId: mirror.documentId,
                    clientId,
                    assignmentId,
                    templateId,
                    sourceIntentId: sourceIntent?.id ?? null,
                    generation,
                });
                const fingerprint = createHash("sha256")
                    .update(`${businessKey}|${reason}`)
                    .digest("hex");
                const purgeGeneration = nextPurgeGeneration(mirror.permanentPurgeRequestedAt, now);

                let currentIntent: IntentRow;
                if (
                    cancelIntent
                    && (
                        cancelIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED
                        || cancelIntent.status === EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
                    )
                ) {
                    const claimed = await tx.eformsign_dispatch_intent.updateMany({
                        where: {
                            id: cancelIntent.id,
                            branchId,
                            attemptCount: cancelIntent.attemptCount,
                            status: {
                                in: [
                                    EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED,
                                    EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                                ],
                            },
                        },
                        data: {
                            status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                            attemptCount: { increment: 1 },
                            startedAt: now,
                            uncertainAt: null,
                            uncertainReason: null,
                            reconciledAt: null,
                            reconciledOutcome: null,
                            reconciledByUserId: null,
                            reconciliationReason: null,
                            providerDocumentId: mirror.documentId,
                        },
                    });
                    if (claimed.count !== 1) {
                        throw new ConflictException("전자문서 취소 작업을 시작할 수 없습니다.");
                    }
                    const claimedRows = await tx.$queryRaw<IntentRow[]>(Prisma.sql`
                        SELECT
                            id,
                            branch_id AS "branchId",
                            client_id AS "clientId",
                            local_document_id AS "localDocumentId",
                            assignment_id AS "assignmentId",
                            provider_document_id AS "providerDocumentId",
                            template_id AS "templateId",
                            action,
                            generation,
                            business_key AS "businessKey",
                            fingerprint,
                            status,
                            attempt_count AS "attemptCount",
                            started_at AS "startedAt",
                            provider_accepted_at AS "providerAcceptedAt",
                            uncertain_at AS "uncertainAt",
                            uncertain_reason AS "uncertainReason",
                            provider_receipt AS "providerReceipt",
                            reconciled_at AS "reconciledAt",
                            reconciled_outcome AS "reconciledOutcome",
                            reconciled_by_user_id AS "reconciledByUserId",
                            reconciliation_reason AS "reconciliationReason",
                            created_at AS "createdAt",
                            updated_at AS "updatedAt"
                        FROM eformsign_dispatch_intent
                        WHERE id = ${cancelIntent.id}::uuid AND branch_id = ${branchId}::uuid
                        FOR UPDATE
                    `);
                    currentIntent = claimedRows[0] ?? {
                        ...cancelIntent,
                        status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                        attemptCount: cancelIntent.attemptCount + 1,
                        startedAt: now,
                        providerDocumentId: mirror.documentId,
                        uncertainAt: null,
                        uncertainReason: null,
                        reconciledAt: null,
                        reconciledOutcome: null,
                        reconciledByUserId: null,
                        reconciliationReason: null,
                        updatedAt: now,
                    };
                } else if (cancelIntent?.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED) {
                    throw new ConflictException("전자문서 취소 작업이 이미 진행 중입니다.");
                } else {
                    const created = await tx.eformsign_dispatch_intent.create({
                        data: {
                            branchId,
                            clientId,
                            localDocumentId: mirror.id,
                            assignmentId,
                            providerDocumentId: mirror.documentId,
                            templateId,
                            action: "cancel",
                            generation,
                            businessKey,
                            fingerprint,
                            status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                            attemptCount: 1,
                            startedAt: now,
                        },
                    });
                    currentIntent = normalizeIntentRow(created);
                }

                const fenced = await tx.eformsign_doc.updateMany({
                    where: {
                        id: mirror.id,
                        branchId,
                        OR: [
                            { permanentPurgeRequestedAt: null },
                            { permanentPurgeRequestedAt: mirror.permanentPurgeRequestedAt },
                        ],
                    },
                    data: { permanentPurgeRequestedAt: purgeGeneration },
                });
                if (fenced.count !== 1) {
                    throw new ConflictException("전자문서 영구 삭제 잠금을 설정할 수 없습니다.");
                }
                targets.push(this.toTarget(
                    mirror,
                    sourceIntent,
                    currentIntent,
                    purgeGeneration,
                ));
            }
            return { targets };
        });
    }

    async completeAccepted(input: CompleteEformsignCancellationInput): Promise<EformsignDispatchIntentEntity> {
        const target = input.target;
        return this.prisma.$transaction(async (tx) => {
            const mirror = await this.lockMirror(tx, target.branchId, target.documentId);
            if (!mirror) throw new ConflictException("전자문서 영구 삭제 대상을 찾을 수 없습니다.");
            const current = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!current) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            this.assertCancellationIntent(current, target);
            if (
                current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            ) {
                return this.toDomain(current);
            }
            if (
                (current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                    && current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN)
                || current.attemptCount !== target.cancellationIntent.attemptCount
            ) {
                return this.toDomain(current);
            }
            if (!sameDate(mirror.permanentPurgeRequestedAt, target.purgeGeneration)) {
                return this.toDomain(current);
            }

            const receipt = toInputJson(input.providerReceipt);
            const updated = await tx.eformsign_dispatch_intent.updateMany({
                where: {
                    id: current.id,
                    branchId: target.branchId,
                    attemptCount: current.attemptCount,
                    status: {
                        in: [
                            EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                            EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                        ],
                    },
                },
                data: {
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED,
                    providerDocumentId: target.providerDocumentId,
                    providerAcceptedAt: new Date(),
                    uncertainAt: null,
                    uncertainReason: null,
                    ...(receipt === undefined ? {} : { providerReceipt: receipt }),
                },
            });
            if (updated.count !== 1) {
                const afterRace = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
                if (!afterRace) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
                return this.toDomain(afterRace);
            }

            // The CAS and the local PII purge share this transaction. Any purge
            // failure rolls the intent back to STARTED/UNCERTAIN for retry.
            await purgeEformsignDocumentContentInTransaction(tx, [target.documentId], new Date());
            const accepted = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!accepted) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            return this.toDomain(accepted);
        });
    }

    async markUncertain(input: MarkUncertainEformsignCancellationInput): Promise<EformsignDispatchIntentEntity> {
        const target = input.target;
        return this.prisma.$transaction(async (tx) => {
            const mirror = await this.lockMirror(tx, target.branchId, target.documentId);
            if (!mirror) throw new ConflictException("전자문서 영구 삭제 대상을 찾을 수 없습니다.");
            const current = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!current) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            this.assertCancellationIntent(current, target);
            if (
                current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
                || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED
            ) {
                return this.toDomain(current);
            }
            if (
                current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                || current.attemptCount !== target.cancellationIntent.attemptCount
            ) {
                return this.toDomain(current);
            }
            const receipt = toInputJson(input.providerReceipt);
            await tx.eformsign_dispatch_intent.updateMany({
                where: {
                    id: current.id,
                    branchId: target.branchId,
                    attemptCount: current.attemptCount,
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                },
                data: {
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                    uncertainAt: new Date(),
                    uncertainReason: normalizeReason(input.reason),
                    ...(input.providerDocumentId?.trim()
                        ? { providerDocumentId: input.providerDocumentId.trim() }
                        : {}),
                    ...(receipt === undefined ? {} : { providerReceipt: receipt }),
                },
            });
            const uncertain = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!uncertain) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            return this.toDomain(uncertain);
        });
    }

    async clearAuthoritativeRefusal(
        input: ClearAuthoritativeEformsignCancellationInput,
    ): Promise<EformsignDispatchIntentEntity> {
        const target = input.target;
        return this.prisma.$transaction(async (tx) => {
            const mirror = await this.lockMirror(tx, target.branchId, target.documentId);
            if (!mirror) throw new ConflictException("전자문서 영구 삭제 대상을 찾을 수 없습니다.");
            const current = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!current) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            this.assertCancellationIntent(current, target);
            if (
                current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            ) {
                throw new ConflictException("이미 취소된 전자문서는 미전달로 변경할 수 없습니다.");
            }
            if (current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED) {
                await this.clearFence(tx, target);
                return this.toDomain(current);
            }
            if (
                (current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
                    && current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN)
                || current.attemptCount !== target.cancellationIntent.attemptCount
            ) {
                return this.toDomain(current);
            }
            const receipt = toInputJson(input.providerReceipt);
            await tx.eformsign_dispatch_intent.updateMany({
                where: {
                    id: current.id,
                    branchId: target.branchId,
                    attemptCount: current.attemptCount,
                    status: {
                        in: [
                            EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                            EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                        ],
                    },
                },
                data: {
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED,
                    reconciledAt: new Date(),
                    reconciledOutcome: "not_delivered",
                    reconciledByUserId: input.actorUserId?.trim() || null,
                    reconciliationReason: normalizeReason(input.reason),
                    uncertainAt: null,
                    uncertainReason: null,
                    ...(receipt === undefined ? {} : { providerReceipt: receipt }),
                },
            });
            await this.clearFence(tx, target);
            const reconciled = await this.lockIntent(tx, target.branchId, target.cancellationIntent.id);
            if (!reconciled) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            return this.toDomain(reconciled);
        });
    }

    async reconcile(input: ReconcileEformsignCancellationInput): Promise<EformsignCancellationReconcileResult> {
        const branchId = input.branchId.trim();
        const intentId = input.intentId.trim();
        const actorUserId = input.actorUserId.trim();
        const reason = normalizeReason(input.reason);
        if (!branchId || !intentId || !actorUserId || !reason) {
            throw new ConflictException("전자문서 취소 확인 요청이 올바르지 않습니다.");
        }

        return this.prisma.$transaction(async (tx) => {
            const observed = await this.readIntent(tx, branchId, intentId);
            if (!observed) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            if (observed.action !== "cancel") {
                throw new ConflictException("취소 작업이 아닌 전자문서 작업입니다.");
            }
            const documentId = observed.providerDocumentId;
            if (!documentId) throw new ConflictException("취소 작업의 provider id가 없습니다.");
            const observedMirror = await this.lockMirror(tx, branchId, documentId);
            if (!observedMirror) throw new ConflictException("전자문서 소유 범위를 확인할 수 없습니다.");
            const current = await this.lockIntent(tx, branchId, intentId);
            if (!current) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            if (current.action !== "cancel" || current.providerDocumentId !== documentId) {
                throw new ConflictException("취소 작업의 소유 범위가 변경되었습니다.");
            }
            const target = this.toTarget(
                observedMirror,
                null,
                current,
                observedMirror.permanentPurgeRequestedAt ?? new Date(0),
            );
            if (
                input.providerDocumentId?.trim()
                && input.providerDocumentId.trim() !== documentId
            ) {
                throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
            }

            if (input.outcome === "not_delivered") {
                if (
                    current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                    || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
                ) {
                    throw new ConflictException("이미 취소된 전자문서는 미전달로 변경할 수 없습니다.");
                }
                if (current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED) {
                    throw new ConflictException("진행 중인 전자문서는 미전달로 변경할 수 없습니다.");
                }
                if (current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.PREPARED) {
                    throw new ConflictException("준비 중인 취소 작업은 미전달로 변경할 수 없습니다.");
                }
                if (current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED) {
                    await tx.eformsign_dispatch_intent.updateMany({
                        where: {
                            id: current.id,
                            branchId,
                            status: EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                        },
                        data: {
                            status: EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_NOT_DELIVERED,
                            reconciledAt: new Date(),
                            reconciledOutcome: "not_delivered",
                            reconciledByUserId: actorUserId,
                            reconciliationReason: reason,
                            uncertainAt: null,
                            uncertainReason: null,
                        },
                    });
                }
                const clearedPurgeFence = await this.clearFence(tx, target);
                const reconciled = await this.lockIntent(tx, branchId, intentId);
                if (!reconciled) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
                return {
                    intent: this.toDomain(reconciled),
                    clearedPurgeFence,
                };
            }

            if (
                current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.ACCEPTED
                || current.status === EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED
            ) {
                return { intent: this.toDomain(current), clearedPurgeFence: false };
            }
            if (
                current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN
                && current.status !== EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED
            ) {
                throw new ConflictException("취소 작업을 전달 완료로 확인할 수 없습니다.");
            }
            await tx.eformsign_dispatch_intent.updateMany({
                where: {
                    id: current.id,
                    branchId,
                    status: {
                        in: [
                            EFORMSIGN_DISPATCH_INTENT_STATUS.STARTED,
                            EFORMSIGN_DISPATCH_INTENT_STATUS.UNCERTAIN,
                        ],
                    },
                },
                data: {
                    status: EFORMSIGN_DISPATCH_INTENT_STATUS.RECONCILED_DELIVERED,
                    providerDocumentId: documentId,
                    providerAcceptedAt: current.providerAcceptedAt ?? new Date(),
                    reconciledAt: new Date(),
                    reconciledOutcome: "delivered",
                    reconciledByUserId: actorUserId,
                    reconciliationReason: reason,
                    uncertainAt: null,
                    uncertainReason: null,
                },
            });
            await purgeEformsignDocumentContentInTransaction(tx, [documentId], new Date());
            const delivered = await this.lockIntent(tx, branchId, intentId);
            if (!delivered) throw new ConflictException("전자문서 취소 작업을 찾을 수 없습니다.");
            return { intent: this.toDomain(delivered), clearedPurgeFence: true };
        });
    }

    async findByIntentId(branchId: string, intentId: string): Promise<EformsignDispatchIntentEntity | null> {
        const row = await this.prisma.eformsign_dispatch_intent.findFirst({
            where: { branchId, id: intentId, action: "cancel" },
        });
        return row ? this.toDomain(normalizeIntentRow(row)) : null;
    }

    private async lockIntent(
        tx: Prisma.TransactionClient,
        branchId: string,
        intentId: string,
    ): Promise<IntentRow | null> {
        const rows = await tx.$queryRaw<IntentRow[]>(Prisma.sql`
            SELECT
                id,
                branch_id AS "branchId",
                client_id AS "clientId",
                local_document_id AS "localDocumentId",
                assignment_id AS "assignmentId",
                provider_document_id AS "providerDocumentId",
                template_id AS "templateId",
                action,
                generation,
                business_key AS "businessKey",
                fingerprint,
                status,
                attempt_count AS "attemptCount",
                started_at AS "startedAt",
                provider_accepted_at AS "providerAcceptedAt",
                uncertain_at AS "uncertainAt",
                uncertain_reason AS "uncertainReason",
                provider_receipt AS "providerReceipt",
                reconciled_at AS "reconciledAt",
                reconciled_outcome AS "reconciledOutcome",
                reconciled_by_user_id AS "reconciledByUserId",
                reconciliation_reason AS "reconciliationReason",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM eformsign_dispatch_intent
            WHERE id = ${intentId}::uuid AND branch_id = ${branchId}::uuid
            FOR UPDATE
        `);
        return rows[0] ?? null;
    }

    private async readIntent(
        tx: Prisma.TransactionClient,
        branchId: string,
        intentId: string,
    ): Promise<IntentRow | null> {
        const row = await tx.eformsign_dispatch_intent.findFirst({
            where: { id: intentId, branchId },
        });
        return row ? normalizeIntentRow(row) : null;
    }

    private async lockMirror(
        tx: Prisma.TransactionClient,
        branchId: string,
        documentId: string,
    ): Promise<MirrorRow | null> {
        const rows = await tx.$queryRaw<MirrorRow[]>(Prisma.sql`
            SELECT
                id,
                document_id AS "documentId",
                branch_id AS "branchId",
                client_id AS "clientId",
                employee_schedule_id AS "assignmentId",
                template_id AS "templateId",
                permanent_purge_requested_at AS "permanentPurgeRequestedAt"
            FROM eformsign_doc
            WHERE branch_id = ${branchId}::uuid AND document_id = ${documentId}
            FOR UPDATE
        `);
        return rows[0] ?? null;
    }

    private async clearFence(tx: Prisma.TransactionClient, target: EformsignCancellationTarget): Promise<boolean> {
        const result = await tx.eformsign_doc.updateMany({
            where: {
                documentId: target.documentId,
                branchId: target.branchId,
                permanentPurgeRequestedAt: target.purgeGeneration,
            },
            data: { permanentPurgeRequestedAt: null },
        });
        return result.count === 1;
    }

    private assertCancellationIntent(current: IntentRow, target: EformsignCancellationTarget): void {
        if (current.action !== "cancel" || current.branchId !== target.branchId) {
            throw new ConflictException("취소 작업의 소유 범위가 변경되었습니다.");
        }
        if (
            current.providerDocumentId
            && current.providerDocumentId !== target.providerDocumentId
        ) {
            throw new ConflictException("전자문서 provider id가 기존 작업과 충돌합니다.");
        }
    }

    private toTarget(
        mirror: MirrorRow,
        sourceIntent: IntentRow | null,
        cancellationIntent: IntentRow,
        purgeGeneration: Date,
    ): EformsignCancellationTarget {
        return {
            documentId: mirror.documentId,
            branchId: mirror.branchId,
            localDocumentId: mirror.id,
            clientId: cancellationIntent.clientId ?? sourceIntent?.clientId ?? mirror.clientId,
            assignmentId: cancellationIntent.assignmentId ?? sourceIntent?.assignmentId ?? mirror.assignmentId,
            templateId: cancellationIntent.templateId ?? sourceIntent?.templateId ?? mirror.templateId,
            providerDocumentId: cancellationIntent.providerDocumentId ?? mirror.documentId,
            sourceIntentId: sourceIntent?.id ?? null,
            sourceIntentStatus: sourceIntent?.status ?? null,
            purgeGeneration,
            cancellationIntent: this.toDomain(cancellationIntent),
        };
    }

    private toDomain(row: IntentRow): EformsignDispatchIntentEntity {
        return new EformsignDispatchIntentEntity({
            id: row.id,
            branchId: row.branchId,
            clientId: row.clientId,
            localDocumentId: row.localDocumentId,
            assignmentId: row.assignmentId,
            providerDocumentId: row.providerDocumentId,
            templateId: row.templateId,
            action: row.action as EformsignDispatchAction,
            generation: row.generation,
            businessKey: row.businessKey,
            fingerprint: row.fingerprint,
            status: row.status as EformsignDispatchIntentStatus,
            attemptCount: row.attemptCount,
            startedAt: row.startedAt,
            providerAcceptedAt: row.providerAcceptedAt,
            uncertainAt: row.uncertainAt,
            uncertainReason: row.uncertainReason,
            providerReceipt: row.providerReceipt,
            reconciledAt: row.reconciledAt,
            reconciledOutcome: row.reconciledOutcome === "delivered" || row.reconciledOutcome === "not_delivered"
                ? row.reconciledOutcome
                : null,
            reconciledByUserId: row.reconciledByUserId,
            reconciliationReason: row.reconciliationReason,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    }
}

// Keep the token near the implementation for module registration discoverability
// while retaining the domain-owned token as the source of truth.
export { EFORMSIGN_CANCELLATION_REPOSITORY };

interface MirrorRow {
    id: number;
    documentId: string;
    branchId: string;
    clientId: number | null;
    assignmentId: number | null;
    templateId: string | null;
    permanentPurgeRequestedAt: Date | null;
}

interface IntentRow {
    id: string;
    branchId: string;
    clientId: number | null;
    localDocumentId: number | null;
    assignmentId: number | null;
    providerDocumentId: string | null;
    templateId: string | null;
    action: string;
    generation: string;
    businessKey: string;
    fingerprint: string;
    status: string;
    attemptCount: number;
    startedAt: Date | null;
    providerAcceptedAt: Date | null;
    uncertainAt: Date | null;
    uncertainReason: string | null;
    providerReceipt: Prisma.JsonValue | null;
    reconciledAt: Date | null;
    reconciledOutcome: string | null;
    reconciledByUserId: string | null;
    reconciliationReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

function normalizeIntentRow(row: Record<string, unknown>): IntentRow {
    return row as unknown as IntentRow;
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

function nextPurgeGeneration(current: Date | null, now: Date): Date {
    return new Date(Math.max(now.getTime(), (current?.getTime() ?? Number.NEGATIVE_INFINITY) + 1));
}

function sameDate(left: Date | null, right: Date): boolean {
    return left !== null && left.getTime() === right.getTime();
}

function compareNewestIntent(left: IntentRow, right: IntentRow): number {
    return right.updatedAt.getTime() - left.updatedAt.getTime()
        || right.createdAt.getTime() - left.createdAt.getTime();
}

function chooseSourceIntent(intents: IntentRow[], mirror: MirrorRow): IntentRow | null {
    return intents
        .filter((intent) => intent.action === "create" || intent.action === "finalize")
        .sort((left, right) => {
            const leftProviderMatch = left.providerDocumentId === mirror.documentId ? 0 : 1;
            const rightProviderMatch = right.providerDocumentId === mirror.documentId ? 0 : 1;
            return leftProviderMatch - rightProviderMatch || compareNewestIntent(left, right);
        })[0] ?? null;
}

function buildCancellationBusinessKey(input: {
    branchId: string;
    documentId: string;
    clientId: number | null;
    assignmentId: number | null;
    templateId: string | null;
    sourceIntentId: string | null;
    generation: string;
}): string {
    const identity = [
        input.branchId,
        input.documentId,
        input.clientId ?? "-",
        input.assignmentId ?? "-",
        input.templateId ?? "-",
        input.sourceIntentId ?? "legacy",
        input.generation,
    ].join("|");
    return createHash("sha256").update(identity).digest("hex");
}

function toInputJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return value as Prisma.InputJsonValue;
}
