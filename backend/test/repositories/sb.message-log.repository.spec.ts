import { Logger } from "@nestjs/common";

import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageLogEntity } from "domain/entities/message-log.entity";

describe("SbMessageLogRepository", () => {
    const createMockPrismaMessageLog = () => ({
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
    });
    const createMockPrismaClient = () => ({
        updateMany: jest.fn(),
    });

    let messageLogModel: ReturnType<typeof createMockPrismaMessageLog>;
    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let queryRaw: jest.Mock;
    let prisma: PrismaService;
    let repository: SbMessageLogRepository;

    beforeEach(() => {
        messageLogModel = createMockPrismaMessageLog();
        clientModel = createMockPrismaClient();
        queryRaw = jest.fn();
        prisma = {
            message_log: messageLogModel,
            client: clientModel,
            $transaction: jest.fn(async (callback) => callback({
                message_log: messageLogModel,
                client: clientModel,
                $queryRaw: queryRaw,
            })),
        } as unknown as PrismaService;
        repository = new SbMessageLogRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("findSentTriggerJobIdsSystemScope", () => {
        it("should return an empty set without querying when jobIds is empty", async () => {
            const result = await repository.findSentTriggerJobIdsSystemScope([]);

            expect(result).toEqual(new Set());
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });

        it("should query sent logs and return non-null trigger job ids", async () => {
            messageLogModel.findMany.mockResolvedValue([
                { triggerJobId: "job-1" },
                { triggerJobId: null },
                { triggerJobId: "job-3" },
            ]);

            const result = await repository.findSentTriggerJobIdsSystemScope(["job-1", "job-2", "job-3"]);

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    triggerJobId: { in: ["job-1", "job-2", "job-3"] },
                    status: "sent",
                },
                select: { triggerJobId: true },
            });
            expect(result).toEqual(new Set(["job-1", "job-3"]));
        });
    });

    describe("update", () => {
        const buildRow = (branchId: string | null) => ({
            id: 55,
            branchId,
            provider: "aligo_sms",
            templateKey: "manual_sms",
            triggerJobId: null,
            receiver: "01012345678",
            clientId: null,
            recipientName: null,
            recipientPhone: "01012345678",
            messageBody: "message",
            variables: {},
            status: "sent",
            aligoMid: "aligo-mid",
            errorMessage: null,
            attempts: 1,
            lastAttemptAt: new Date("2026-08-29T00:00:00.000Z"),
            nextRetryAt: null,
            createdAt: new Date("2026-08-28T00:00:00.000Z"),
            updatedAt: new Date("2026-08-29T00:00:00.000Z"),
        });
        const buildEntity = (branchId: string | null) => MessageLogEntity.reconstitute(
            55,
            branchId,
            "aligo_sms",
            "manual_sms",
            null,
            "01012345678",
            null,
            "message",
            {},
            "sent",
            "aligo-mid",
            null,
            1,
            new Date("2026-08-29T00:00:00.000Z"),
            null,
            new Date("2026-08-28T00:00:00.000Z"),
            new Date("2026-08-29T00:00:00.000Z"),
        );

        it("pins the where clause to the entity's branch when one is set", async () => {
            const log = buildEntity("branch-1");
            messageLogModel.update.mockResolvedValue(buildRow("branch-1"));

            await repository.update(log);

            expect(messageLogModel.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 55, branchId: "branch-1" } }),
            );
        });

        it("falls back to an id-only where and warns when the entity has no branch", async () => {
            const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
            const log = buildEntity(null);
            messageLogModel.update.mockResolvedValue(buildRow(null));

            await repository.update(log);

            expect(messageLogModel.update).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: 55 } }),
            );
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining("message_log_null_branch_write"),
            );
            warnSpy.mockRestore();
        });

        it("persists retry safety markers when updating a delivery log", async () => {
            const log = buildEntity("branch-1");
            log.variables = { retrySafety: "partial" };
            messageLogModel.update.mockResolvedValue(buildRow("branch-1"));

            await repository.update(log);

            expect(messageLogModel.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        variables: { retrySafety: "partial" },
                    }),
                }),
            );
        });

        it("atomically stamps the client when a service-end notice is provider-accepted", async () => {
            const acceptedAt = new Date("2026-09-16T03:00:00.000Z");
            const log = MessageLogEntity.reconstitute(
                55,
                "11111111-1111-1111-1111-111111111111",
                "aligo_sms",
                "service_end_notice_sms",
                "job-55",
                "01012345678",
                7,
                "서비스 종료 안내",
                {},
                "sent",
                "aligo-mid",
                null,
                1,
                acceptedAt,
                null,
                new Date("2026-09-16T02:59:00.000Z"),
                acceptedAt,
                "김산모",
                "01012345678",
                "sms:key",
                "fingerprint",
                "accepted",
                new Date("2026-09-16T02:59:30.000Z"),
                acceptedAt,
            );
            messageLogModel.update.mockResolvedValue({
                ...buildRow(log.branchId),
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                clientId: log.clientId,
                providerAcceptanceState: "accepted",
                providerAcceptedAt: acceptedAt,
            });
            clientModel.updateMany.mockResolvedValue({ count: 1 });

            await repository.update(log);

            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(clientModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 7,
                    branchId: log.branchId,
                    serviceEndNoticeSentAt: null,
                },
                data: { serviceEndNoticeSentAt: acceptedAt },
            });
        });

        it("does not stamp the client for a rejected service-end notice", async () => {
            const log = MessageLogEntity.reconstitute(
                56,
                "11111111-1111-1111-1111-111111111111",
                "aligo_sms",
                "service_end_notice_sms",
                "job-56",
                "01012345678",
                7,
                "서비스 종료 안내",
                {},
                "failed",
                null,
                "provider rejected",
                1,
                new Date("2026-09-16T03:00:00.000Z"),
                new Date("2026-09-16T03:05:00.000Z"),
                new Date("2026-09-16T02:59:00.000Z"),
                new Date("2026-09-16T03:00:00.000Z"),
                "김산모",
                "01012345678",
                "sms:key-rejected",
                "fingerprint-rejected",
                "rejected",
                new Date("2026-09-16T02:59:30.000Z"),
            );
            messageLogModel.update.mockResolvedValue({
                ...buildRow(log.branchId),
                id: log.id,
                templateKey: log.templateKey,
                triggerJobId: log.triggerJobId,
                clientId: log.clientId,
                status: "failed",
                providerAcceptanceState: "rejected",
            });

            await repository.update(log);

            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(clientModel.updateMany).not.toHaveBeenCalled();
        });
    });

    describe("startRetryAttempt", () => {
        let source: MessageLogEntity;
        let retryDraft: MessageLogEntity;

        beforeEach(() => {
            source = MessageLogEntity.reconstitute(
                77,
                "11111111-1111-1111-1111-111111111111",
                "aligo_sms",
                "service_record_link_sms",
                "job-1",
                "01012345678",
                7,
                "message",
                {},
                "failed",
                null,
                "등록되지 않은 발신번호입니다.",
                1,
                new Date("2026-07-22T17:13:11.000Z"),
                new Date("2026-07-22T17:18:11.000Z"),
                new Date("2026-07-22T17:13:11.000Z"),
            );
            retryDraft = MessageLogEntity.reconstitute(
                0,
                source.branchId,
                source.provider,
                source.templateKey,
                source.triggerJobId,
                source.receiver,
                source.clientId,
                source.messageBody,
                { retryOfLogId: "77", retryAttempt: "2" },
                "pending",
                null,
                null,
                1,
                null,
                new Date("2026-07-22T17:23:11.000Z"),
                new Date("2026-07-22T17:18:11.000Z"),
            );
        });

        it("should clear only the source retry schedule and create a separate attempt", async () => {
            const claimedAt = new Date("2026-07-22T17:18:12.000Z");
            const nowSpy = jest.spyOn(Date, "now").mockReturnValue(claimedAt.getTime());
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            messageLogModel.create.mockResolvedValue({
                id: 78,
                branchId: retryDraft.branchId,
                provider: retryDraft.provider,
                templateKey: retryDraft.templateKey,
                triggerJobId: retryDraft.triggerJobId,
                receiver: retryDraft.receiver,
                clientId: retryDraft.clientId,
                recipientName: null,
                recipientPhone: retryDraft.receiver,
                messageBody: retryDraft.messageBody,
                variables: retryDraft.variables,
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 1,
                lastAttemptAt: null,
                nextRetryAt: retryDraft.nextRetryAt,
                createdAt: retryDraft.createdAt,
                updatedAt: retryDraft.createdAt,
            });

            const result = await repository.startRetryAttempt(source, retryDraft, "automatic");

            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 77,
                    branchId: source.branchId,
                    status: "failed",
                    nextRetryAt: source.nextRetryAt,
                    updatedAt: source.updatedAt,
                },
                data: {
                    nextRetryAt: null,
                    updatedAt: claimedAt,
                },
            });
            expect(messageLogModel.create).toHaveBeenCalled();
            expect(result).toEqual({
                kind: "started",
                log: expect.objectContaining({ id: 78, status: "pending" }),
            });
            expect(source).toEqual(expect.objectContaining({
                id: 77,
                status: "failed",
                errorMessage: "등록되지 않은 발신번호입니다.",
            }));
            nowSpy.mockRestore();
        });

        it("claims the newly created retry attempt through the same supplied transaction", async () => {
            const pendingRow = {
                ...retryDraft, id: 78, providerAcceptanceKey: "retry:key",
                providerAcceptanceFingerprint: "retry:fingerprint", providerAcceptanceState: "prepared",
            };
            const txModel = createMockPrismaMessageLog();
            txModel.updateMany.mockResolvedValue({ count: 1 });
            txModel.create.mockResolvedValue(pendingRow);
            txModel.findUnique.mockResolvedValue({ ...pendingRow, providerAcceptanceState: "started" });
            const transaction = { message_log: txModel } as unknown as import("@prisma/client").Prisma.TransactionClient;
            const started = await repository.startRetryAttempt(source, retryDraft, "automatic", transaction);
            expect(started.kind).toBe("started");
            if (started.kind !== "started") throw new Error("Retry was not created");
            await expect(repository.claimProviderAttempt(started.log, transaction)).resolves.toEqual(
                expect.objectContaining({ id: 78, providerAcceptanceState: "started" }),
            );
            expect(txModel.updateMany).toHaveBeenCalledTimes(2);
            expect(messageLogModel.updateMany).not.toHaveBeenCalled();
            expect(messageLogModel.findUnique).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it("should not create a duplicate attempt when the source was already claimed", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            await expect(repository.startRetryAttempt(source, retryDraft, "automatic")).resolves.toEqual({ kind: "lost" });

            expect(messageLogModel.create).not.toHaveBeenCalled();
        });

        it("atomically suppresses an automatic service-end retry when the client was already notified", async () => {
            source.templateKey = "service_end_notice_sms";
            const sourceSnapshot = {
                status: source.status,
                nextRetryAt: source.nextRetryAt,
                updatedAt: source.updatedAt,
            };
            queryRaw.mockResolvedValue([{
                service_end_notice_sent_at: new Date("2026-09-16T03:00:00.000Z"),
            }]);
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });

            const result = await repository.startRetryAttempt(source, retryDraft, "automatic");

            expect(queryRaw).toHaveBeenCalledTimes(1);
            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: source.id,
                    branchId: source.branchId,
                    status: sourceSnapshot.status,
                    nextRetryAt: sourceSnapshot.nextRetryAt,
                    updatedAt: sourceSnapshot.updatedAt,
                },
                data: expect.objectContaining({
                    status: "failed",
                    errorMessage: "서비스 종료 안내가 이미 발송됨",
                    nextRetryAt: null,
                }),
            });
            expect(messageLogModel.create).not.toHaveBeenCalled();
            expect(result).toEqual({ kind: "suppressed", log: source });
        });

        it("keeps explicit manual service-end retries available", async () => {
            source.templateKey = "service_end_notice_sms";
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            messageLogModel.create.mockResolvedValue({
                id: 78,
                branchId: source.branchId,
                provider: source.provider,
                templateKey: source.templateKey,
                triggerJobId: source.triggerJobId,
                receiver: source.receiver,
                clientId: source.clientId,
                recipientName: null,
                recipientPhone: source.receiver,
                messageBody: source.messageBody,
                status: "pending",
                variables: retryDraft.variables,
                aligoMid: null,
                errorMessage: null,
                attempts: retryDraft.attempts,
                lastAttemptAt: null,
                nextRetryAt: retryDraft.nextRetryAt,
                createdAt: retryDraft.createdAt,
                updatedAt: retryDraft.updatedAt,
            });

            const result = await repository.startRetryAttempt(source, retryDraft, "manual");

            expect(queryRaw).not.toHaveBeenCalled();
            expect(messageLogModel.create).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                kind: "started",
                log: expect.objectContaining({ id: 78 }),
            });
        });
    });

    describe("findByIdInBranch", () => {
        it("returns only a log owned by the requested branch", async () => {
            messageLogModel.findFirst.mockResolvedValue({
                id: 77,
                branchId: "branch-1",
                provider: "aligo_sms",
                templateKey: "service_record_link_sms",
                triggerJobId: "job-1",
                receiver: "01012345678",
                clientId: 3,
                recipientName: "나세정",
                recipientPhone: "01012345678",
                messageBody: "제공기록지 작성 링크",
                variables: {},
                status: "failed",
                aligoMid: null,
                errorMessage: "발송 실패",
                attempts: 1,
                lastAttemptAt: new Date("2026-07-23T02:20:00.000Z"),
                nextRetryAt: null,
                createdAt: new Date("2026-07-23T02:20:00.000Z"),
                updatedAt: new Date("2026-07-23T02:20:00.000Z"),
            });

            const result = await repository.findByIdInBranch("branch-1", 77);

            expect(messageLogModel.findFirst).toHaveBeenCalledWith({
                where: { id: 77, branchId: "branch-1" },
            });
            expect(result).toMatchObject({
                id: 77,
                branchId: "branch-1",
                status: "failed",
            });
        });
    });

    describe("findHistoryPageByBranch", () => {
        it("uses native log id ordering and keeps timestamp precision as an eligibility cutoff", async () => {
            messageLogModel.findMany.mockResolvedValue([]);
            const snapshotAt = new Date("2026-07-09T00:00:00.123Z");

            await repository.findHistoryPageByBranch("branch-1", {
                snapshotAt,
                after: { source: "log", nativeId: "42" },
                limit: 11,
            });

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    branchId: "branch-1",
                    createdAt: { lte: snapshotAt },
                    AND: [{ id: { lt: 42 } }],
                },
                orderBy: { id: "desc" },
                take: 11,
            });
        });
    });

    describe("reconcileProviderAttempt", () => {
        it("does not reconcile an attempt while the provider call is still started", async () => {
            const startedAt = new Date("2026-08-29T00:00:00.000Z");
            const startedRow = {
                id: 42,
                branchId: "branch-1",
                provider: "aligo_sms",
                templateKey: "manual_sms",
                triggerJobId: null,
                receiver: "01012345678",
                clientId: null,
                recipientName: "수신자",
                recipientPhone: "01012345678",
                messageBody: "message",
                variables: {},
                status: "pending",
                aligoMid: null,
                errorMessage: null,
                attempts: 0,
                lastAttemptAt: null,
                nextRetryAt: null,
                createdAt: startedAt,
                updatedAt: startedAt,
                providerAcceptanceKey: "sms:key",
                providerAcceptanceFingerprint: "fingerprint",
                providerAcceptanceState: "started",
                providerCallStartedAt: startedAt,
                providerAcceptedAt: null,
                providerReconciledAt: null,
                providerReconciledBy: null,
                providerReconciliationReason: null,
            };
            messageLogModel.findUnique.mockResolvedValue(startedRow);
            const attempt = MessageLogEntity.reconstitute(
                42,
                "branch-1",
                "aligo_sms",
                "manual_sms",
                null,
                "01012345678",
                null,
                "message",
                {},
                "pending",
                null,
                null,
                0,
                null,
                null,
                startedAt,
                startedAt,
                "수신자",
                "01012345678",
                "sms:key",
                "fingerprint",
                "started",
                startedAt,
            );

            await expect(repository.reconcileProviderAttempt(
                attempt,
                "not-delivered",
                "operator-1",
                "provider still in flight",
            )).resolves.toBeNull();
            expect(messageLogModel.updateMany).not.toHaveBeenCalled();
        });

        it("atomically stamps the client when an uncertain service-end notice is reconciled as delivered", async () => {
            const uncertainAt = new Date("2026-09-16T03:00:00.000Z");
            const uncertainRow = {
                id: 43,
                branchId: "11111111-1111-1111-1111-111111111111",
                provider: "aligo_sms",
                templateKey: "service_end_notice_sms",
                triggerJobId: "job-43",
                receiver: "01012345678",
                clientId: 7,
                recipientName: "김산모",
                recipientPhone: "01012345678",
                messageBody: "서비스 종료 안내",
                variables: { retrySafety: "uncertain" },
                status: "failed",
                aligoMid: null,
                errorMessage: "provider response unavailable",
                attempts: 1,
                lastAttemptAt: uncertainAt,
                nextRetryAt: null,
                createdAt: uncertainAt,
                updatedAt: uncertainAt,
                providerAcceptanceKey: "sms:key-43",
                providerAcceptanceFingerprint: "fingerprint-43",
                providerAcceptanceState: "uncertain",
                providerCallStartedAt: uncertainAt,
                providerAcceptedAt: null,
                providerReconciledAt: null,
                providerReconciledBy: null,
                providerReconciliationReason: null,
            };
            const deliveredRow = {
                ...uncertainRow,
                status: "sent",
                errorMessage: null,
                providerAcceptanceState: "reconciled_delivered",
                providerAcceptedAt: new Date("2026-09-16T03:10:00.000Z"),
                providerReconciledAt: new Date("2026-09-16T03:10:00.000Z"),
                providerReconciledBy: "operator-1",
                providerReconciliationReason: "provider receipt confirmed delivery",
                updatedAt: new Date("2026-09-16T03:10:00.000Z"),
            };
            messageLogModel.findUnique
                .mockResolvedValueOnce(uncertainRow)
                .mockResolvedValueOnce(deliveredRow);
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            clientModel.updateMany.mockResolvedValue({ count: 1 });
            const attempt = MessageLogEntity.reconstitute(
                uncertainRow.id,
                uncertainRow.branchId,
                uncertainRow.provider,
                uncertainRow.templateKey,
                uncertainRow.triggerJobId,
                uncertainRow.receiver,
                uncertainRow.clientId,
                uncertainRow.messageBody,
                uncertainRow.variables,
                "failed",
                null,
                uncertainRow.errorMessage,
                1,
                uncertainAt,
                null,
                uncertainAt,
                uncertainAt,
                uncertainRow.recipientName,
                uncertainRow.recipientPhone,
                uncertainRow.providerAcceptanceKey,
                uncertainRow.providerAcceptanceFingerprint,
                "uncertain",
                uncertainAt,
            );

            await repository.reconcileProviderAttempt(
                attempt,
                "delivered",
                "operator-1",
                "provider receipt confirmed delivery",
            );

            expect(clientModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 7,
                    branchId: uncertainRow.branchId,
                    serviceEndNoticeSentAt: null,
                },
                data: { serviceEndNoticeSentAt: expect.any(Date) },
            });
        });
    });
});
