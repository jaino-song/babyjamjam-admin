import { ConflictException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import {
    SmsProviderAcceptanceService,
} from "application/services/sms-provider-acceptance.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";

describe("SMS provider acceptance and retry boundary", () => {
    const branchId = "11111111-1111-1111-1111-111111111111";
    const createSource = (retrySafety = "uncertain") =>
        MessageLogEntity.reconstitute(
            77,
            branchId,
            "aligo_sms",
            "client_greeting_sms",
            "job-77",
            "01012345678",
            7,
            "안녕하세요",
            {
                senderPhone: "0212345678",
                recipientName: "고객",
                title: "인사 메시지",
                msgType: "AUTO",
                retrySafety,
            },
            "failed",
            null,
            "provider response unavailable",
            1,
            new Date("2026-08-29T00:00:00.000Z"),
            new Date("2026-08-29T00:00:01.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
            "고객",
            "01012345678",
            "sms:source-attempt",
            "source-fingerprint",
            "uncertain",
            new Date("2026-08-29T00:00:00.000Z"),
        );

    const createRepository = (source: MessageLogEntity) => {
        const repository = {
            findByIdInBranch: jest.fn().mockResolvedValue(source),
            update: jest.fn().mockImplementation(async (log: MessageLogEntity) => log),
            reconcileProviderAttempt: jest.fn().mockImplementation(async (
                log: MessageLogEntity,
                outcome: "delivered" | "not-delivered",
                actor: string,
                reason: string,
                providerMessageId?: string | null,
            ) => {
                log.reconcileProviderOutcome({ outcome, actor, reason, providerMessageId });
                return log;
            }),
            claimProviderAttempt: jest.fn().mockImplementation(async (log: MessageLogEntity) => {
                if (!log.canStartProviderCall()) return null;
                log.markProviderCallStarted(new Date("2026-08-29T00:01:00.000Z"));
                return log;
            }),
            startRetryAttempt: jest.fn().mockImplementation(async (
                _sourceLog: MessageLogEntity,
                draft: MessageLogEntity,
            ) =>
                MessageLogEntity.reconstitute(
                    78,
                    draft.branchId,
                    draft.provider,
                    draft.templateKey,
                    draft.triggerJobId,
                    draft.receiver,
                    draft.clientId,
                    draft.messageBody,
                    draft.variables,
                    draft.status,
                    draft.aligoMid,
                    draft.errorMessage,
                    draft.attempts,
                    draft.lastAttemptAt,
                    draft.nextRetryAt,
                    draft.createdAt,
                    draft.updatedAt,
                    draft.recipientName,
                    draft.recipientPhone,
                    draft.providerAcceptanceKey,
                    draft.providerAcceptanceFingerprint,
                    draft.providerAcceptanceState,
                    draft.providerCallStartedAt,
                    draft.providerAcceptedAt,
                    draft.providerReconciledAt,
                    draft.providerReconciledBy,
                    draft.providerReconciliationReason,
                ),
            ),
        };
        return repository;
    };

    const createProvider = () => ({
        sendSms: jest.fn().mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 123,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        }),
    });

    it("requires authoritative non-delivery before one retry and never retries the uncertain source", async () => {
        const source = createSource();
        const repository = createRepository(source);
        const acceptance = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );
        const provider = createProvider();
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );

        await acceptance.reconcile({
            branchId,
            logId: source.id,
            outcome: "not-delivered",
            actor: "operator-1",
            reason: "provider history confirms no delivery",
        });
        expect(source.providerAcceptanceState).toBe("reconciled_not_delivered");

        const retry = await retryService.retryById(branchId, source.id);

        expect(retry).toEqual(expect.objectContaining({
            id: 78,
            providerAcceptanceState: "accepted",
            status: "sent",
        }));
        expect(provider.sendSms).toHaveBeenCalledTimes(1);
        expect(repository.startRetryAttempt).toHaveBeenCalledTimes(1);
        expect(source.providerAcceptanceState).toBe("reconciled_not_delivered");
    });

    it("blocks retry after authoritative delivery reconciliation", async () => {
        const source = createSource();
        const repository = createRepository(source);
        const acceptance = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );
        const provider = createProvider();
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );

        await acceptance.reconcile({
            branchId,
            logId: source.id,
            outcome: "delivered",
            actor: "operator-1",
            reason: "provider receipt confirms delivery",
            providerMessageId: "provider-123",
        });

        await expect(retryService.retryById(branchId, source.id)).rejects.toThrow(ConflictException);
        expect(source.providerAcceptanceState).toBe("reconciled_delivered");
        expect(source.status).toBe("sent");
        expect(provider.sendSms).not.toHaveBeenCalled();
        expect(repository.startRetryAttempt).not.toHaveBeenCalled();
    });

    it("blocks partial batches from reconciliation and whole-list manual retry", async () => {
        const source = createSource("partial");
        source.nextRetryAt = null;
        const repository = createRepository(source);
        const acceptance = new SmsProviderAcceptanceService(
            repository as unknown as IMessageLogRepository,
        );
        const provider = createProvider();
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );

        await expect(acceptance.reconcile({
            branchId,
            logId: source.id,
            outcome: "not-delivered",
            actor: "operator-1",
            reason: "failed recipient cannot be isolated",
        })).rejects.toThrow(ConflictException);

        await expect(retryService.retryById(branchId, source.id)).rejects.toThrow(ConflictException);

        expect(source.providerAcceptanceState).toBe("uncertain");
        expect(source.nextRetryAt).toBeNull();
        expect(source.variables["retrySafety"]).toBe("partial");
        expect(provider.sendSms).not.toHaveBeenCalled();
        expect(repository.startRetryAttempt).not.toHaveBeenCalled();
    });
});

/**
 * Phase 7 Task 7.1 (BJJ-319): partial-completion recovery.
 *
 * The partial-acceptance resend ban must live in persisted state, not in any
 * UI or process lifetime. These tests drive the real retry service to produce
 * the partial markers, persist them into a stateful row store, and then build
 * brand-new service instances over rows re-read from that store — the
 * equivalent of a new process after a restart. Every resend path must still be
 * fenced by the durable markers alone.
 */
describe("SMS partial acceptance survives process restart as a durable resend ban", () => {
    const branchId = "22222222-2222-2222-2222-222222222222";

    interface StoredRow {
        id: number;
        fields: Parameters<typeof MessageLogEntity.reconstitute>;
    }

    /** Row store that re-reads produce a brand-new entity from (fresh-process semantics). */
    const createMessageLogStore = () => {
        const rows = new Map<number, StoredRow>();
        let nextId = 100;

        const snapshot = (log: MessageLogEntity): StoredRow => ({
            id: log.id,
            fields: [
                log.id, log.branchId, log.provider, log.templateKey, log.triggerJobId,
                log.receiver, log.clientId, log.messageBody, { ...log.variables },
                log.status, log.aligoMid, log.errorMessage, log.attempts,
                log.lastAttemptAt ? new Date(log.lastAttemptAt) : null,
                log.nextRetryAt ? new Date(log.nextRetryAt) : null,
                new Date(log.createdAt), new Date(log.updatedAt),
                log.recipientName, log.recipientPhone,
                log.providerAcceptanceKey, log.providerAcceptanceFingerprint,
                log.providerAcceptanceState,
                log.providerCallStartedAt ? new Date(log.providerCallStartedAt) : null,
                log.providerAcceptedAt ? new Date(log.providerAcceptedAt) : null,
                log.providerReconciledAt ? new Date(log.providerReconciledAt) : null,
                log.providerReconciledBy, log.providerReconciliationReason,
            ] as Parameters<typeof MessageLogEntity.reconstitute>,
        });

        const repository = {
            findByIdInBranch: jest.fn(async (_branchId: string, id: number) => {
                const row = rows.get(id);
                return row ? MessageLogEntity.reconstitute(...row.fields) : null;
            }),
            update: jest.fn(async (log: MessageLogEntity) => {
                rows.set(log.id, snapshot(log));
                return MessageLogEntity.reconstitute(...snapshot(log).fields);
            }),
            startRetryAttempt: jest.fn(async (sourceLog: MessageLogEntity, draft: MessageLogEntity) => {
                const source = rows.get(sourceLog.id);
                if (!source) return null;
                // Same CAS as the production repository: the source must still
                // own its retry schedule, otherwise the retry was claimed.
                const current = MessageLogEntity.reconstitute(...source.fields);
                if (current.nextRetryAt?.getTime() !== sourceLog.nextRetryAt?.getTime()
                    || current.status !== sourceLog.status) {
                    return null;
                }
                current.nextRetryAt = null;
                current.updatedAt = new Date();
                rows.set(current.id, snapshot(current));
                const persisted = MessageLogEntity.reconstitute(
                    ...[nextId++, draft.branchId, draft.provider, draft.templateKey, draft.triggerJobId,
                        draft.receiver, draft.clientId, draft.messageBody, { ...draft.variables },
                        draft.status, draft.aligoMid, draft.errorMessage, draft.attempts,
                        draft.lastAttemptAt, draft.nextRetryAt, new Date(), new Date(),
                        draft.recipientName, draft.recipientPhone, draft.providerAcceptanceKey,
                        draft.providerAcceptanceFingerprint, draft.providerAcceptanceState,
                        draft.providerCallStartedAt, draft.providerAcceptedAt,
                        draft.providerReconciledAt, draft.providerReconciledBy,
                        draft.providerReconciliationReason] as Parameters<typeof MessageLogEntity.reconstitute>,
                );
                rows.set(persisted.id, snapshot(persisted));
                return MessageLogEntity.reconstitute(...snapshot(persisted).fields);
            }),
            findPendingRetriesSystemScope: jest.fn(async () =>
                [...rows.values()]
                    .map((row) => MessageLogEntity.reconstitute(...row.fields))
                    .filter((row) => ["pending", "failed"].includes(row.status)
                        && row.nextRetryAt !== null
                        && row.nextRetryAt.getTime() <= Date.now())),
        };
        return { rows, repository, seed: (log: MessageLogEntity) => rows.set(log.id, snapshot(log)) };
    };

    const createProvider = (response?: unknown) => ({
        sendSms: jest.fn().mockResolvedValue(response ?? {
            request: {
                senderPhone: "0212345678",
                receiver: "01011112222, 01033334444",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: 1,
                message: "success",
                msg_id: 900,
                success_cnt: 1,
                error_cnt: 1,
                msg_type: "LMS",
            },
        }),
    });

    const buildServices = (repository: unknown, provider: { sendSms: jest.Mock }) => {
        const acceptance = new SmsProviderAcceptanceService(repository as unknown as IMessageLogRepository);
        const retryService = new SmsRetryService(
            repository as unknown as IMessageLogRepository,
            provider as unknown as AligoService,
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            acceptance,
        );
        const scheduler = new MessageRetrySchedulerService(
            repository as unknown as IMessageLogRepository,
            retryService,
            { holdsLease: () => true } as unknown as SchedulerLeaseService,
        );
        return { acceptance, retryService, scheduler };
    };

    const createMultiRecipientFailedLog = () =>
        MessageLogEntity.reconstitute(
            55,
            branchId,
            "aligo_sms",
            "manual_sms",
            null,
            "01011112222, 01033334444",
            7,
            "안내 메시지",
            { senderPhone: "0212345678", title: "안내", msgType: "LMS" },
            "failed",
            null,
            "이전 발송 실패",
            1,
            new Date("2026-09-01T00:00:00.000Z"),
            new Date("2026-09-01T00:05:00.000Z"),
            new Date("2026-09-01T00:00:00.000Z"),
            new Date("2026-09-01T00:00:00.000Z"),
            "고객",
            "01011112222",
            "sms:source-key",
            "source-fingerprint",
        );

    it("persists the partial fence and a restarted process still forbids every resend path", async () => {
        // --- Previous process: manual retry hits a partial provider response.
        const previousRun = createMessageLogStore();
        previousRun.seed(createMultiRecipientFailedLog());
        const previousProvider = createProvider();
        const previousServices = buildServices(previousRun.repository, previousProvider);

        const partialLog = await previousServices.retryService.retryById(branchId, 55);

        expect(previousProvider.sendSms).toHaveBeenCalledTimes(1);
        expect(partialLog.isPartialProviderOutcome()).toBe(true);
        expect(partialLog.providerAcceptanceState).toBe("uncertain");
        expect(partialLog.status).toBe("failed");

        // --- New process: rows are re-read from the store; all services fresh.
        const restartedRun = createMessageLogStore();
        for (const row of previousRun.rows.values()) restartedRun.seed(MessageLogEntity.reconstitute(...row.fields));
        const provider = createProvider();
        const services = buildServices(restartedRun.repository, provider);

        // 1. The partial attempt row is refused by the persisted marker alone.
        await expect(services.retryService.retryById(branchId, 100)).rejects.toThrow(ConflictException);
        // 2. The source row must be fenced too: it stayed `failed` after its
        // attempt went partial, and a whole-list resend from it would duplicate
        // the recipient the provider already accepted.
        await expect(services.retryService.retryById(branchId, 55)).rejects.toThrow(ConflictException);
        // 2. Operator reconciliation is refused so the original list cannot be replayed.
        await expect(services.acceptance.reconcile({
            branchId,
            logId: 55,
            outcome: "not-delivered",
            actor: "operator-1",
            reason: "failed recipient cannot be isolated",
        })).rejects.toThrow(ConflictException);
        // 3. The retry scheduler never resends the partial batch either.
        await services.scheduler.retryFailedMessages();

        expect(provider.sendSms).not.toHaveBeenCalled();
        expect(restartedRun.repository.startRetryAttempt).not.toHaveBeenCalled();

        // The durable state is unchanged: still partial, never silently
        // reclassified as sent or delivered.
        const persistedAttempt = await restartedRun.repository.findByIdInBranch(branchId, 100) as MessageLogEntity;
        expect(persistedAttempt.isPartialProviderOutcome()).toBe(true);
        expect(persistedAttempt.providerAcceptanceState).toBe("uncertain");
        expect(persistedAttempt.status).toBe("failed");
        const persistedSource = await restartedRun.repository.findByIdInBranch(branchId, 55) as MessageLogEntity;
        expect(persistedSource.isPartialProviderOutcome()).toBe(true);
        expect(persistedSource.status).toBe("failed");
    });

    it("a restarted scheduler supersedes a legacy partial row it can still select, without resending", async () => {
        // Defense-in-depth: a partial marker persisted while its retry schedule
        // was not cleared must be terminated by the scheduler, never resent.
        const store = createMessageLogStore();
        const legacyPartial = createMultiRecipientFailedLog();
        legacyPartial.variables = { ...legacyPartial.variables, retrySafety: "partial" };
        legacyPartial.providerAcceptanceState = "uncertain";
        store.seed(legacyPartial);

        const provider = createProvider();
        const services = buildServices(store.repository, provider);
        await services.scheduler.retryFailedMessages();

        expect(provider.sendSms).not.toHaveBeenCalled();
        expect(store.repository.startRetryAttempt).not.toHaveBeenCalled();
        const row = await store.repository.findByIdInBranch(branchId, 55) as MessageLogEntity;
        expect(row.nextRetryAt).toBeNull();
        expect(row.status).toBe("failed");
        expect(row.errorMessage).toContain("부분 발송");
        expect(row.isPartialProviderOutcome()).toBe(true);
    });
});
