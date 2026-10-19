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
        findFirst: jest.fn(),
    });

    let messageLogModel: ReturnType<typeof createMockPrismaMessageLog>;
    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let queryRaw: jest.Mock;
    let prisma: PrismaService;
    let repository: SbMessageLogRepository;
    let triggerJobModel: { findFirst: jest.Mock };

    beforeEach(() => {
        messageLogModel = createMockPrismaMessageLog();
        clientModel = createMockPrismaClient();
        queryRaw = jest.fn();
        triggerJobModel = { findFirst: jest.fn() };
        prisma = {
            message_log: messageLogModel,
            client: clientModel,
            message_trigger_job: triggerJobModel,
            $queryRaw: queryRaw,
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

    describe("manual retry duplicate lookups", () => {
        const branchId = "11111111-1111-1111-1111-111111111111";
        const source = () => MessageLogEntity.reconstitute(
            77, branchId, "aligo_sms", "service_record_link_sms", "job-1", "01012345678", 7,
            "link", { scheduleId: "10" }, "failed", null, "rejected", 3, null, null,
            new Date("2026-10-01"), new Date("2026-10-01"),
        );

        it("walks ancestors then all descendants using branch-pinned JSON edges and cycle-safe UNION", async () => {
            queryRaw.mockResolvedValue([{ id: 76 }, { id: 77 }, { id: 78 }, { id: 79 }]);
            messageLogModel.findMany.mockResolvedValue([{ ...source(), id: 79, status: "sent" }]);
            const family = await repository.findRetryFamilyInBranch(branchId, 77);
            expect(family.map((log) => log.id)).toEqual([79]);
            const sql = queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
            expect(sql.sql).toContain("WITH RECURSIVE ancestors AS");
            expect(sql.sql).toContain("parent.id::text = ancestors.variables->>'retryOfLogId'");
            expect(sql.sql).toContain("child.variables->>'retryOfLogId' = family.id::text");
            expect(sql.sql).not.toContain("UNION ALL");
            expect(sql.values).toEqual([branchId, 77, branchId, branchId]);
            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: { branchId, id: { in: [76, 77, 78, 79] } },
            });
        });

        it("does not fetch unrelated logs when the source is absent in the branch", async () => {
            queryRaw.mockResolvedValue([]);
            await expect(repository.findRetryFamilyInBranch(branchId, 77)).resolves.toEqual([]);
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });

        it.each([true, false])("finds a newer same-schedule send without requiring a retry schedule: %s", async (exists) => {
            const log = source();
            queryRaw.mockResolvedValue([{ exists }]);
            await expect(repository.hasNewerServiceRecordSmsInBranch(branchId, log)).resolves.toBe(exists);
            const sql = queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
            expect(sql.sql).toContain("newer.created_at > source.created_at");
            expect(sql.sql).toContain("newer.id <> source.id");
            expect(sql.sql).toContain("newer.provider = 'aligo_sms'");
            expect(sql.sql).toContain("newer.status <> 'failed'");
            expect(sql.sql).not.toContain("next_retry_at");
            expect(sql.values).toEqual([branchId, log.id, branchId, branchId, "service_record_link_sms", branchId, "system:service_record_link"]);
        });

        it("matches schedule variables or trigger jobs and falls back to the source's branch-pinned job", async () => {
            const log = source();
            log.variables = {};
            queryRaw.mockResolvedValue([{ exists: true }]);
            await expect(repository.hasNewerServiceRecordSmsInBranch(branchId, log)).resolves.toBe(true);
            const sql = queryRaw.mock.calls[0][0] as { sql: string };
            expect(sql.sql).toContain("COALESCE(NULLIF(log.variables->>'scheduleId', ''), job.employee_schedule_id::text)");
            expect(sql.sql).toContain("job.id = log.trigger_job_id AND job.branch_id =");
            expect(sql.sql).toContain("newer.variables->>'scheduleId' = source.schedule_id");
            expect(sql.sql).toContain("job.id = newer.trigger_job_id");
            expect(sql.sql).toContain("job.employee_schedule_id::text = source.schedule_id");
        });

        it("returns false when no source or schedule matches", async () => {
            queryRaw.mockResolvedValue([{ exists: false }]);
            await expect(repository.hasNewerServiceRecordSmsInBranch(branchId, source())).resolves.toBe(false);
        });
    });

    describe("findServiceRecordLinkClientState", () => {
        const state = { serviceStatus: "waiting", bookingConfirmedAt: new Date("2099-05-01"), startDate: new Date("2099-06-01"), endDate: new Date("2099-06-30") };
        const select = { serviceStatus: true, bookingConfirmedAt: true, startDate: true, endDate: true };
        const linkLog = () => MessageLogEntity.create({
            provider: "aligo_sms", templateKey: "service_record_link_sms", receiver: "01012345678",
            messageBody: "link", variables: {}, branchId: "branch-1", clientId: 7, triggerJobId: "job-1",
        });
        it("reads the schedule's client through the branch-pinned job before the log client", async () => {
            const log = linkLog();
            triggerJobModel.findFirst.mockResolvedValue({ employeeSchedule: { client: { ...state, branchId: log.branchId } } });
            expect(await repository.findServiceRecordLinkClientState(log)).toEqual(state);
            expect(triggerJobModel.findFirst).toHaveBeenCalledWith({
                where: { id: log.triggerJobId, branchId: log.branchId },
                select: { employeeSchedule: { select: { client: { select: { ...select, branchId: true } } } } },
            });
            expect(clientModel.findFirst).not.toHaveBeenCalled();
        });
        it("falls back to the branch-pinned log client when the job has no schedule", async () => {
            const log = linkLog();
            triggerJobModel.findFirst.mockResolvedValue({ employeeSchedule: null });
            clientModel.findFirst.mockResolvedValue(state);
            expect(await repository.findServiceRecordLinkClientState(log)).toEqual(state);
            expect(clientModel.findFirst).toHaveBeenCalledWith({ where: { id: 7, branchId: "branch-1" }, select });
        });
        it.each([null, { employeeSchedule: { client: null } }])("returns null when neither client resolves: %j", async (job) => {
            triggerJobModel.findFirst.mockResolvedValue(job);
            clientModel.findFirst.mockResolvedValue(null);
            expect(await repository.findServiceRecordLinkClientState(linkLog())).toBeNull();
        });
        it("excludes a job in another branch and returns null without a fallback client", async () => {
            const log = linkLog();
            log.clientId = null;
            triggerJobModel.findFirst.mockImplementation(async ({ where }) => where.branchId === "other-branch"
                ? { employeeSchedule: { client: { ...state, branchId: "other-branch" } } }
                : null);
            expect(await repository.findServiceRecordLinkClientState(log)).toBeNull();
            expect(triggerJobModel.findFirst.mock.calls[0][0].where).toEqual({ id: "job-1", branchId: "branch-1" });
            expect(clientModel.findFirst).not.toHaveBeenCalled();
        });
        it("does not use a cross-branch schedule client and falls back to the log client", async () => {
            triggerJobModel.findFirst.mockResolvedValue({ employeeSchedule: { client: { ...state, branchId: "other-branch" } } });
            clientModel.findFirst.mockResolvedValue(null);
            expect(await repository.findServiceRecordLinkClientState(linkLog())).toBeNull();
            expect(clientModel.findFirst).toHaveBeenCalledTimes(1);
        });
        it("uses the log client without a job and avoids unscoped reads for a null branch", async () => {
            const log = linkLog();
            log.triggerJobId = null;
            clientModel.findFirst.mockResolvedValue(state);
            expect(await repository.findServiceRecordLinkClientState(log)).toEqual(state);
            log.branchId = null;
            expect(await repository.findServiceRecordLinkClientState(log)).toBeNull();
            expect(clientModel.findFirst).toHaveBeenCalledTimes(1);
            expect(triggerJobModel.findFirst).not.toHaveBeenCalled();
        });
    });

    describe("Aligo history conditional claims", () => {
        const historyLog = () => {
            const log = MessageLogEntity.create({ provider: "aligo_sms", templateKey: "manual_sms", receiver: "01012345678", messageBody: "message", variables: {}, branchId: "branch-1" });
            log.providerAcceptanceState = "uncertain";
            log.providerCallStartedAt = new Date("2026-10-12T00:00:00Z");
            log.updatedAt = new Date("2026-10-12T00:10:00Z");
            return log;
        };
        it("lost bookkeeping CAS leaves a concurrent operator's row unchanged", async () => {
            const log = historyLog(); const expected = log.updatedAt;
            log.variables = { historyLookup: "checking" }; log.updatedAt = new Date(expected.getTime() + 1);
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });
            expect(await repository.claimAligoHistoryBookkeeping(log, "uncertain", expected)).toBeNull();
            expect(messageLogModel.updateMany.mock.calls[0][0].where).toEqual({ id: log.id, branchId: log.branchId, providerAcceptanceState: "uncertain", updatedAt: expected });
            expect(messageLogModel.findUnique).not.toHaveBeenCalled(); expect(messageLogModel.update).not.toHaveBeenCalled();
        });
        it("stale lookup cannot reconcile a row with a newer updatedAt", async () => {
            const log = historyLog();
            messageLogModel.findUnique.mockResolvedValue({ ...log, updatedAt: new Date(log.updatedAt.getTime() + 1) });
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            expect(await repository.reconcileProviderAttempt(log, "delivered", "system:aligo-history", "checked", "ours", { expectedUpdatedAt: log.updatedAt })).toBeNull();
            expect(messageLogModel.updateMany).not.toHaveBeenCalled();
        });
        it("only one concurrent stale started claim increments the attempt", async () => {
            const log = historyLog(); log.providerAcceptanceState = "started"; const expected = log.updatedAt;
            log.markStaleStartedAsUncertain(new Date("2026-10-12T00:15:00Z"));
            messageLogModel.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
            messageLogModel.findUnique.mockResolvedValue({ ...log });
            expect((await repository.claimAligoHistoryBookkeeping(log, "started", expected))?.attempts).toBe(1);
            expect(await repository.claimAligoHistoryBookkeeping(log, "started", expected)).toBeNull();
            expect(messageLogModel.updateMany.mock.calls[0][0].where).toMatchObject({ providerAcceptanceState: "started", updatedAt: expected });
        });
        it("reconciliation removes bookkeeping in the same CAS and retry none is permanent", async () => {
            const log = historyLog(); log.variables = { historyLookup: "checking", historyLookupAbsentAt: "before" };
            messageLogModel.findUnique.mockResolvedValue({ ...log }); messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            await repository.reconcileProviderAttempt(log, "not-delivered", "system:aligo-history", "발송 실패: 응답 없음", null,
                { expectedUpdatedAt: log.updatedAt, retry: "none", variables: {} });
            expect(messageLogModel.updateMany.mock.calls[0][0].data).toMatchObject({ status: "failed", nextRetryAt: null, variables: { retrySafety: "reconciled-not-delivered" } });
        });
        it("filters age and exhausted rows inside the bounded selection query", async () => {
            queryRaw.mockResolvedValue([]); const now = new Date("2026-10-12T00:20:00Z");
            expect(await repository.findAligoHistoryCandidatesSystemScope(now, 10)).toEqual([]);
            const sql = queryRaw.mock.calls[0][0];
            expect(sql.sql).toContain("provider_call_started_at >="); expect(sql.sql).toContain("provider_call_started_at <=");
            expect(sql.sql).toContain("variables->>'historyLookup' IS DISTINCT FROM 'exhausted'");
            expect(sql.sql).toContain("LIMIT"); expect(sql.sql).not.toContain("status =");
            expect(sql.values).toEqual([new Date(now.getTime() - 24 * 60 * 60_000), new Date(now.getTime() - 5 * 60_000), new Date(now.getTime() - 5 * 60_000).toISOString(), 10]);
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });
        it("mid ownership lookup excludes the current row", async () => {
            messageLogModel.findMany.mockResolvedValue([{ aligoMid: "other" }]);
            expect(await repository.findAligoMidsStoredOnOtherLogs(["other", "ours"], 12)).toEqual(new Set(["other"]));
            expect(messageLogModel.findMany).toHaveBeenCalledWith({ where: { id: { not: 12 }, aligoMid: { in: ["other", "ours"] } }, select: { aligoMid: true } });
        });
    });

    describe("findSentTriggerJobIdsSystemScope", () => {
        it("should return an empty set without querying when jobIds is empty", async () => {
            const result = await repository.findSentTriggerJobIdsSystemScope([]);

            expect(result).toEqual(new Set());
            expect(messageLogModel.findMany).not.toHaveBeenCalled();
        });

        it("should query sent or carrier-failed logs and return non-null trigger job ids", async () => {
            messageLogModel.findMany.mockResolvedValue([
                { triggerJobId: "job-1" },
                { triggerJobId: null },
                { triggerJobId: "job-3" },
            ]);

            const result = await repository.findSentTriggerJobIdsSystemScope(["job-1", "job-2", "job-3"]);

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    triggerJobId: { in: ["job-1", "job-2", "job-3"] },
                    OR: [{ status: "sent" }, { carrierResultState: "failed" }],
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

        it("writes the scheduled carrier fields once, then stops rewriting them", async () => {
            const log = buildEntity("branch-1");
            log.scheduleCarrierCheck(new Date("2026-10-14T05:00:00.000Z"));
            messageLogModel.update.mockResolvedValue(buildRow("branch-1"));

            await repository.update(log);
            await repository.update(log);

            const first = messageLogModel.update.mock.calls[0][0] as { data: Record<string, unknown> };
            const second = messageLogModel.update.mock.calls[1][0] as { data: Record<string, unknown> };
            expect(first.data).toEqual(expect.objectContaining({
                carrierCheckDueAt: new Date("2026-10-14T05:30:00.000Z"),
                carrierResultState: null,
            }));
            expect(second.data).not.toHaveProperty("carrierCheckDueAt");
            expect(second.data).not.toHaveProperty("carrierCheckedAt");
            expect(second.data).not.toHaveProperty("carrierResultState");
            expect(second.data).not.toHaveProperty("carrierResults");
            expect(log.hasPendingCarrierCheckSchedule()).toBe(false);
        });

        it("keeps the carrier schedule when the update fails", async () => {
            const log = buildEntity("branch-1");
            log.scheduleCarrierCheck(new Date("2026-10-14T05:00:00.000Z"));
            messageLogModel.update
                .mockRejectedValueOnce(new Error("write failed"))
                .mockResolvedValueOnce(buildRow("branch-1"));

            await expect(repository.update(log)).rejects.toThrow("write failed");
            expect(log.hasPendingCarrierCheckSchedule()).toBe(true);

            await repository.update(log);
            const retried = messageLogModel.update.mock.calls[1][0] as { data: Record<string, unknown> };
            expect(retried.data).toHaveProperty("carrierCheckDueAt");
        });

        it("keeps the carrier schedule when the caller owns the transaction", async () => {
            const log = buildEntity("branch-1");
            log.scheduleCarrierCheck(new Date("2026-10-14T05:00:00.000Z"));
            messageLogModel.update.mockResolvedValue(buildRow("branch-1"));

            await repository.update(log, { message_log: messageLogModel } as never);

            expect(log.hasPendingCarrierCheckSchedule()).toBe(true);
        });

        it("clears the carrier schedule after save()", async () => {
            const log = buildEntity("branch-1");
            log.scheduleCarrierCheck(new Date("2026-10-14T05:00:00.000Z"));
            messageLogModel.create.mockResolvedValue(buildRow("branch-1"));

            await repository.save(log);

            expect(log.hasPendingCarrierCheckSchedule()).toBe(false);
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
            expect(queryRaw).not.toHaveBeenCalled();
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
            queryRaw.mockResolvedValueOnce([{ id: source.id }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: source.id }]);
            messageLogModel.findMany.mockResolvedValue([{ ...source }]);
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

            expect(queryRaw).toHaveBeenCalledTimes(3);
            expect(messageLogModel.create).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                kind: "started",
                log: expect.objectContaining({ id: 78 }),
            });
        });

        it.each([
            ["pending", {}, null],
            ["sent", {}, null],
            ["failed", { retrySafety: "partial" }, null],
            ["failed", { retrySafety: "uncertain" }, null],
            ["failed", {}, "started"],
            ["failed", {}, "uncertain"],
            ["failed", {}, "reconciled_delivered"],
        ])("refuses unsafe family state inside the manual admission transaction: %s %j %s", async (status, variables, acceptance) => {
            queryRaw.mockResolvedValueOnce([{ id: 76 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 78 }]);
            messageLogModel.findMany.mockResolvedValue([{
                ...source, id: 78, status, variables, providerAcceptanceState: acceptance,
            }]);

            await expect(repository.startRetryAttempt(source, retryDraft, "manual")).resolves.toEqual({ kind: "lost" });

            const queries = queryRaw.mock.calls.map(([sql]) => sql);
            expect(queries[0].sql).toContain("WITH RECURSIVE ancestors");
            expect(queries[0].values).toContain(source.branchId);
            expect(queries[1].sql).toContain("pg_advisory_xact_lock");
            expect(queries[1].values).toContain(`sms_retry_family:${source.branchId}:76`);
            expect(queries[2].sql).toContain("SELECT id FROM family");
            expect(messageLogModel.findMany).toHaveBeenCalledWith({ where: { branchId: source.branchId, id: { in: [78] } } });
            expect(messageLogModel.updateMany).not.toHaveBeenCalled();
            expect(messageLogModel.create).not.toHaveBeenCalled();
        });

        it("refuses manual admission when the branch-scoped ancestry has no root", async () => {
            queryRaw.mockResolvedValueOnce([]);

            await expect(repository.startRetryAttempt(source, retryDraft, "manual")).resolves.toEqual({ kind: "lost" });

            expect(queryRaw).toHaveBeenCalledTimes(1);
            expect(messageLogModel.updateMany).not.toHaveBeenCalled();
            expect(messageLogModel.create).not.toHaveBeenCalled();
        });

        it.each([false, true])("rechecks newer link sends in the supplied transaction (newer=%s)", async (newer) => {
            const txModel = createMockPrismaMessageLog();
            const txQuery = jest.fn().mockResolvedValueOnce([{ id: 77 }]).mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ id: 77 }, { id: 78 }]).mockResolvedValueOnce([{ exists: newer }]);
            txModel.findMany.mockResolvedValue([{ ...source }, {
                ...source, id: 78, providerAcceptanceState: "reconciled_not_delivered",
            }]);
            txModel.updateMany.mockResolvedValue({ count: 1 });
            txModel.create.mockResolvedValue({ ...retryDraft, id: 79 });
            const transaction = { message_log: txModel, $queryRaw: txQuery } as unknown as import("@prisma/client").Prisma.TransactionClient;

            const result = await repository.startRetryAttempt(source, retryDraft, "manual", transaction);

            expect(result.kind).toBe(newer ? "lost" : "started");
            expect(txQuery.mock.calls[3][0].sql).toContain("newer.created_at > source.created_at");
            expect(txModel.create).toHaveBeenCalledTimes(newer ? 0 : 1);
            expect(queryRaw).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
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

    describe("findClientHistoryPageByBranch", () => {
        const snapshotAt = new Date("2026-07-09T00:00:00.123Z");
        const buildLogRow = (id: number) => ({
            id,
            branchId: "branch-1",
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
            aligoMid: null,
            errorMessage: null,
            attempts: 1,
            lastAttemptAt: new Date("2026-08-29T00:00:00.000Z"),
            nextRetryAt: null,
            createdAt: new Date("2026-08-28T00:00:00.000Z"),
            updatedAt: new Date("2026-08-29T00:00:00.000Z"),
        });
        const sqlText = (call: unknown[]) =>
            (call[0] as { strings: string[] }).strings.join("?").replace(/\s+/g, " ");

        it("filters by client in the database, inside the branch, newest id first", async () => {
            messageLogModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: null },
                { snapshotAt, after: { source: "log", nativeId: "42" }, limit: 51 },
            );

            expect(queryRaw).not.toHaveBeenCalled();
            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    branchId: "branch-1",
                    createdAt: { lte: snapshotAt },
                    AND: [{ id: { lt: 42 } }, { clientId: 7 }],
                },
                orderBy: { id: "desc" },
                take: 51,
            });
        });

        it("adds unowned phone-matched rows by id, found with a normalised digit comparison, never a raw equality", async () => {
            queryRaw.mockResolvedValue([{ id: 99 }, { id: 98 }]);
            messageLogModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: "01012345678" },
                { snapshotAt, after: null, limit: 11 },
            );

            expect(queryRaw).toHaveBeenCalledTimes(1);
            const call = queryRaw.mock.calls[0];
            const text = sqlText(call);
            expect(text).toContain("branch_id = ?::uuid");
            expect(text).toContain("client_id IS NULL");
            expect(text).toContain("regexp_replace(COALESCE(recipient_phone, ''), '[^0-9]', '', 'g') = ANY(?::text[])");
            expect(text).toContain("regexp_split_to_array(COALESCE(receiver, ''), '[,;' || chr(10) || ']')");
            expect(text).not.toMatch(/recipient_phone\s*=\s*\?/);
            const values = (call[0] as { values: unknown[] }).values;
            expect(values[0]).toBe("branch-1");
            expect(values).toContainEqual(expect.arrayContaining(["01012345678", "821012345678"]));

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    branchId: "branch-1",
                    createdAt: { lte: snapshotAt },
                    AND: [{ OR: [{ clientId: 7 }, { clientId: null, id: { in: [99, 98] } }] }],
                },
                orderBy: { id: "desc" },
                take: 11,
            });
        });

        it("keeps a client with no phone match to the rows it owns", async () => {
            queryRaw.mockResolvedValue([]);
            messageLogModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: "01012345678" },
                { snapshotAt, after: null, limit: 11 },
            );

            expect(messageLogModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ AND: [{ clientId: 7 }] }),
            }));
        });

        it("applies the continuation cursor before the phone-id limit", async () => {
            queryRaw.mockResolvedValue([]);
            messageLogModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: "01012345678" },
                { snapshotAt, after: { source: "log", nativeId: "42" }, limit: 11 },
            );

            const sql = queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
            const text = sql.strings.join("?").replace(/\s+/g, " ");
            expect(text).toContain("AND id < ?");
            expect(text.indexOf("AND id < ?")).toBeLessThan(text.indexOf("LIMIT"));
            expect(sql.values).toContain(42);
            expect(sql.values[sql.values.length - 1]).toBe(11);
        });

        it("walks 2,001 unowned phone-matched logs page by page, dropping none and ending with hasMore false", async () => {
            // Ids 1..2001 are unowned rows that already match the client's phone; the fake driver
            // models only the clauses this fix is about (cursor, limit).
            const ids = Array.from({ length: 2001 }, (_, i) => i + 1);
            queryRaw.mockImplementation(async (sql: { strings: string[]; values: unknown[] }) => {
                const text = sql.strings.join("?");
                let rows = ids;
                if (text.includes("AND id < ?")) {
                    const after = sql.values[2] as number;
                    rows = rows.filter((id) => id < after);
                }
                const limit = sql.values[sql.values.length - 1] as number;
                return [...rows].sort((a, b) => b - a).slice(0, limit).map((id) => ({ id }));
            });
            messageLogModel.findMany.mockImplementation(async (args: {
                where: { AND: Array<Record<string, unknown>> };
                take: number;
            }) => {
                const matches = (id: number, clause: Record<string, unknown>): boolean => {
                    if ("OR" in clause) return (clause["OR"] as Array<Record<string, unknown>>).some((c) => matches(id, c));
                    if ("id" in clause) {
                        const idClause = clause["id"] as { lt?: number; in?: number[] };
                        if (idClause.lt !== undefined) return id < idClause.lt;
                        if (idClause.in) return idClause.in.includes(id);
                    }
                    if ("clientId" in clause && clause["clientId"] !== null) return false;
                    return true;
                };
                return ids
                    .filter((id) => args.where.AND.every((clause) => matches(id, clause)))
                    .sort((a, b) => b - a)
                    .slice(0, args.take)
                    .map((id) => buildLogRow(id));
            });

            const seen: number[] = [];
            let after: { source: "log"; nativeId: string } | null = null;
            let hasMore = true;
            for (let guard = 0; guard < 100 && hasMore; guard += 1) {
                const rows: MessageLogEntity[] = await repository.findClientHistoryPageByBranch(
                    "branch-1",
                    { clientId: 7, phoneKey: "01012345678" },
                    { snapshotAt, after, limit: 51 },
                );
                const visible = rows.slice(0, 50);
                seen.push(...visible.map((row) => row.id));
                hasMore = rows.length > 50;
                if (hasMore) after = { source: "log", nativeId: String(visible[visible.length - 1]!.id) };
            }

            expect(hasMore).toBe(false);
            expect(seen).toHaveLength(2001);
            expect(new Set(seen).size).toBe(2001);
            expect(seen[seen.length - 1]).toBe(1);
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

        it("persists the carrier-check schedule when an uncertain attempt is reconciled as delivered with a mid", async () => {
            const uncertainAt = new Date("2026-10-14T03:00:00.000Z");
            const row = {
                id: 44, branchId: "branch-1", provider: "aligo_sms", templateKey: "manual_sms", triggerJobId: null,
                receiver: "01012345678", clientId: null, recipientName: "수신자", recipientPhone: "01012345678",
                messageBody: "message", variables: { retrySafety: "uncertain" }, status: "failed", aligoMid: null,
                errorMessage: "timeout", attempts: 1, lastAttemptAt: uncertainAt, nextRetryAt: null,
                createdAt: uncertainAt, updatedAt: uncertainAt, providerAcceptanceKey: "sms:key-44",
                providerAcceptanceFingerprint: "fingerprint-44", providerAcceptanceState: "uncertain",
                providerCallStartedAt: uncertainAt, providerAcceptedAt: null, providerReconciledAt: null,
                providerReconciledBy: null, providerReconciliationReason: null,
                carrierCheckDueAt: null, carrierCheckedAt: null, carrierResultState: null, carrierResults: null,
            };
            messageLogModel.findUnique
                .mockResolvedValueOnce(row)
                .mockResolvedValueOnce({ ...row, status: "sent", providerAcceptanceState: "reconciled_delivered" });
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            const attempt = MessageLogEntity.reconstitute(
                44, "branch-1", "aligo_sms", "manual_sms", null, "01012345678", null, "message",
                { retrySafety: "uncertain" }, "failed", null, "timeout", 1, uncertainAt, null,
                uncertainAt, uncertainAt, "수신자", "01012345678", "sms:key-44", "fingerprint-44", "uncertain", uncertainAt,
            );

            await repository.reconcileProviderAttempt(attempt, "delivered", "system:aligo-history", "history", "mid-44");

            const data = messageLogModel.updateMany.mock.calls[0]?.[0].data;
            expect(data).toMatchObject({
                status: "sent",
                aligoMid: "mid-44",
                carrierCheckDueAt: expect.any(Date),
                carrierCheckedAt: null,
                carrierResultState: null,
            });
            expect(data.carrierCheckDueAt.getTime()).toBe(data.providerAcceptedAt.getTime() + 30 * 60 * 1000);
        });

        it("does not write carrier columns when an uncertain attempt is reconciled as not delivered", async () => {
            const uncertainAt = new Date("2026-10-14T03:00:00.000Z");
            const row = {
                id: 45, branchId: "branch-1", provider: "aligo_sms", templateKey: "manual_sms", triggerJobId: null,
                receiver: "01012345678", clientId: null, recipientName: "수신자", recipientPhone: "01012345678",
                messageBody: "message", variables: {}, status: "failed", aligoMid: null, errorMessage: "timeout",
                attempts: 1, lastAttemptAt: uncertainAt, nextRetryAt: null, createdAt: uncertainAt, updatedAt: uncertainAt,
                providerAcceptanceKey: "sms:key-45", providerAcceptanceFingerprint: "fingerprint-45",
                providerAcceptanceState: "uncertain", providerCallStartedAt: uncertainAt, providerAcceptedAt: null,
                providerReconciledAt: null, providerReconciledBy: null, providerReconciliationReason: null,
            };
            messageLogModel.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(row);
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });
            const attempt = MessageLogEntity.reconstitute(
                45, "branch-1", "aligo_sms", "manual_sms", null, "01012345678", null, "message",
                {}, "failed", null, "timeout", 1, uncertainAt, null,
                uncertainAt, uncertainAt, "수신자", "01012345678", "sms:key-45", "fingerprint-45", "uncertain", uncertainAt,
            );

            await repository.reconcileProviderAttempt(attempt, "not-delivered", "operator-1", "checked", "mid-45", { retry: "none" });

            const data = messageLogModel.updateMany.mock.calls[0]?.[0].data;
            expect(data).not.toHaveProperty("carrierCheckDueAt");
        });
    });

    describe("findCarrierChecksDueSystemScope", () => {
        it("queries due aligo_sms rows with a mid in system scope, oldest due first", async () => {
            messageLogModel.findMany.mockResolvedValue([]);
            const now = new Date("2026-10-14T03:00:00.000Z");

            await repository.findCarrierChecksDueSystemScope(25, now);

            expect(messageLogModel.findMany).toHaveBeenCalledWith({
                where: {
                    provider: "aligo_sms",
                    aligoMid: { not: null },
                    carrierCheckDueAt: { not: null, lte: now },
                },
                orderBy: [{ carrierCheckDueAt: "asc" }, { id: "asc" }],
                take: 25,
            });
        });
    });

    describe("postponeCarrierCheck", () => {
        const until = new Date("2026-10-14T04:00:00.000Z");

        it("conditionally pushes a still-due check out to the given time", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });

            expect(await repository.postponeCarrierCheck(55, "mid-1", until)).toBe(true);

            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: { id: 55, aligoMid: "mid-1", carrierCheckDueAt: { not: null } },
                data: { carrierCheckDueAt: until },
            });
        });

        it("returns false when the row changed or was already checked", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            expect(await repository.postponeCarrierCheck(55, "mid-1", until)).toBe(false);
        });
    });

    describe("saveCarrierCheckResult", () => {
        const checkedAt = new Date("2026-10-14T03:30:00.000Z");
        const baseInput = {
            id: 55,
            expectedMid: "mid-1",
            results: [{ receiver: "01012345678", verdict: "success" }],
            checkedAt,
            failureMessage: null,
        };
        const carrierData = (state: string) => ({
            carrierCheckDueAt: null,
            carrierCheckedAt: checkedAt,
            carrierResultState: state,
            carrierResults: baseInput.results,
        });

        it("stores a delivered result without touching status or provider acceptance", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });

            const outcome = await repository.saveCarrierCheckResult({ ...baseInput, state: "delivered" });

            expect(outcome).toBe("saved");
            expect(messageLogModel.updateMany).toHaveBeenCalledTimes(1);
            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: { id: 55, aligoMid: "mid-1", carrierCheckDueAt: { not: null } },
                data: carrierData("delivered"),
            });
            expect(clientModel.updateMany).not.toHaveBeenCalled();
        });

        it("flips a sent or accepted-pending row to failed in one conditional update", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });

            const outcome = await repository.saveCarrierCheckResult({
                ...baseInput,
                state: "failed",
                failureMessage: "통신사 전달 실패: 5678 결번",
            });

            expect(outcome).toBe("saved_status_failed");
            expect(messageLogModel.updateMany).toHaveBeenCalledTimes(1);
            expect(messageLogModel.updateMany).toHaveBeenCalledWith({
                where: {
                    id: 55,
                    aligoMid: "mid-1",
                    carrierCheckDueAt: { not: null },
                    OR: [
                        { status: "sent" },
                        { status: "pending", providerAcceptanceState: "accepted" },
                    ],
                },
                data: {
                    ...carrierData("failed"),
                    status: "failed",
                    errorMessage: "통신사 전달 실패: 5678 결번",
                    nextRetryAt: null,
                },
            });
            expect(clientModel.updateMany).not.toHaveBeenCalled();
        });

        it("saves the failed result without flipping status when the row is no longer sent", async () => {
            messageLogModel.updateMany
                .mockResolvedValueOnce({ count: 0 })
                .mockResolvedValueOnce({ count: 1 });

            const outcome = await repository.saveCarrierCheckResult({
                ...baseInput,
                state: "failed",
                failureMessage: "통신사 전달 실패: 5678 결번",
            });

            expect(outcome).toBe("saved");
            expect(messageLogModel.updateMany).toHaveBeenNthCalledWith(2, {
                where: { id: 55, aligoMid: "mid-1", carrierCheckDueAt: { not: null } },
                data: carrierData("failed"),
            });
        });

        it("never flips status for non-failed states", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 1 });

            for (const state of ["unconfirmed", "lookup_error"] as const) {
                messageLogModel.updateMany.mockClear();
                expect(await repository.saveCarrierCheckResult({ ...baseInput, state })).toBe("saved");
                expect(messageLogModel.updateMany).toHaveBeenCalledTimes(1);
                const call = messageLogModel.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
                expect(call.data).not.toHaveProperty("status");
            }
        });

        it("returns stale when no row matches (mid changed or already checked)", async () => {
            messageLogModel.updateMany.mockResolvedValue({ count: 0 });

            expect(await repository.saveCarrierCheckResult({ ...baseInput, state: "delivered" })).toBe("stale");
            expect(await repository.saveCarrierCheckResult({
                ...baseInput,
                state: "failed",
                failureMessage: "x",
            })).toBe("stale");
        });
    });
});
