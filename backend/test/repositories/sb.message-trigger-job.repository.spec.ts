import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import { AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "domain/constants/agent-automation-storage";
import { ordinaryAutomationJobWhere } from "application/utils/message-automation-record-sql";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "domain/constants/message-automation-intent";
import {
    SERVICE_RECORD_LINK_RULE_ID,
} from "domain/constants/service-record-link-message";
import {
    MessageTriggerJobEntity,
    MessageTriggerJobPayload,
} from "domain/entities/message-trigger-job.entity";
import { Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

describe("MessageTriggerJobEntity", () => {
    const now = new Date("2026-07-09T00:00:00.000Z");

    const createJob = (attempts = 0, nextAttemptAt: Date | null = null) =>
        MessageTriggerJobEntity.reconstitute(
            "job-1",
            "branch-1",
            "rule-1",
            "pending",
            new Date("2026-07-09T01:00:00.000Z"),
            null,
            null,
            null,
            1,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-1:client:1",
            {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
            new Date("2026-07-08T00:00:00.000Z"),
            new Date("2026-07-08T00:00:00.000Z"),
            attempts,
            nextAttemptAt,
        );

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("defer config bumps nextAttemptAt without attempts", () => {
        const job = createJob(2);

        job.defer("config", "provider unconfigured");

        expect(job.status).toBe("pending");
        expect(job.attempts).toBe(2);
        expect(job.nextAttemptAt).toEqual(new Date(now.getTime() + TRIGGER_JOB_CONFIG_RETRY_DELAY_MS));
    });

    it("defer transient increments attempts and terminal-fails at TRIGGER_JOB_MAX_ATTEMPTS", () => {
        const retryJob = createJob(0);
        retryJob.defer("transient", "timeout");

        expect(retryJob.status).toBe("pending");
        expect(retryJob.attempts).toBe(1);
        expect(retryJob.nextAttemptAt).toEqual(new Date(now.getTime() + TRIGGER_JOB_RETRY_DELAY_MS));

        const terminalJob = createJob(TRIGGER_JOB_MAX_ATTEMPTS - 1);
        terminalJob.defer("transient", "timeout");

        expect(terminalJob.status).toBe("failed");
        expect(terminalJob.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(terminalJob.cancelReason).toBe("timeout");
    });

    it("markSent clears nextAttemptAt", () => {
        const job = createJob(1, new Date("2026-07-09T00:05:00.000Z"));

        job.markSent();

        expect(job.status).toBe("sent");
        expect(job.nextAttemptAt).toBeNull();
    });

    it("binds processing state to the immutable claim token", () => {
        const job = createJob();

        job.markProcessing("claim-a");

        expect(job.status).toBe("processing");
        expect(job.claimToken).toBe("claim-a");
    });

    it("marks a claimed job dispatching at the provider authorization boundary", () => {
        const job = createJob();
        job.markProcessing("claim-a");

        job.markDispatchAuthorized();

        expect(job.status).toBe("dispatching");
        expect(job.claimToken).toBe("claim-a");
    });
});

describe("SbMessageTriggerJobRepository", () => {
    const now = new Date("2026-07-09T00:00:00.000Z");

    type MockMessageTriggerJobRow = {
        id: string;
        branchId: string | null;
        ruleId: string;
        status: string;
        scheduledFor: Date;
        attempts: number;
        nextAttemptAt: Date | null;
        sentAt: Date | null;
        canceledAt: Date | null;
        cancelReason: string | null;
        clientId: number | null;
        employeeScheduleId: number | null;
        recipientType: string;
        recipientPhone: string | null;
        templateKey: string;
        dedupeKey: string;
        payload: MessageTriggerJobPayload;
        createdAt: Date;
        updatedAt: Date;
        canceledByUser: boolean;
        claimToken: string | null;
    };

    const createMockPrismaMessageTriggerJob = () => ({
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
    });

    const baseRow = (): MockMessageTriggerJobRow => ({
        id: "job-1",
        branchId: "branch-1",
        ruleId: "rule-1",
        status: "pending",
        scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
        attempts: 0,
        nextAttemptAt: null,
        sentAt: null,
        canceledAt: null,
        cancelReason: null,
        clientId: 1,
        employeeScheduleId: null,
        recipientType: MessageTriggerRecipientType.CLIENT,
        recipientPhone: "01012345678",
        templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
        dedupeKey: "rule-1:client:1",
        payload: {
            memberId: "1",
            recipientName: "홍길동",
            recipientPhone: "01012345678",
            templateVariables: {},
        },
        createdAt: new Date("2026-07-08T00:00:00.000Z"),
        updatedAt: new Date("2026-07-08T00:00:00.000Z"),
        canceledByUser: false,
        claimToken: null,
    });

    const createRow = (overrides: Partial<MockMessageTriggerJobRow> = {}): MockMessageTriggerJobRow => ({
        ...baseRow(),
        ...overrides,
    });

    const createJob = () =>
        MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: "rule-1",
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: "rule-1:client:1",
            payload: {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
        });

    it.each(["rule", "dedupe", "payload"])("refuses reserved %s carriers without database access", async (carrier) => {
        const job = createJob();
        if (carrier === "rule") Object.assign(job, { ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID });
        if (carrier === "dedupe") Object.assign(job, { dedupeKey: `${AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX}synthetic` });
        if (carrier === "payload") Object.assign(job.payload, { [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: null });
        for (const operation of [() => repository.create(job), () => repository.update(job), () => repository.upsertPending(job)]) {
            await expect(operation()).rejects.toThrow("Internal automation records are not delivery jobs");
        }
        await expect(repository.upsertPendingForRuleGeneration(job, now, false)).resolves.toBeNull();
        await expect(repository.promoteAutomaticSchedulingClaim("marker", now.toISOString(), job)).resolves.toBeNull();
        await expect(repository.claimProviderRejectedForRetry("branch-1", job.id, "version", "snapshot", job, createJob())).resolves.toBeNull();
        await expect(repository.claimProviderRejectedForRetry("branch-1", "source", "version", "snapshot", createJob(), job)).resolves.toBeNull();
        expect(queryRaw).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        for (const method of Object.values(messageTriggerJobModel)) expect(method).not.toHaveBeenCalled();
    });

    const targetVersion = (job: MessageTriggerJobEntity, snapshotHash: string): string => createHash("sha256").update(JSON.stringify({
        id: job.id,
        branchId: job.branchId,
        ruleId: job.ruleId,
        status: job.status,
        scheduledFor: job.scheduledFor.toISOString(),
        sentAt: job.sentAt?.toISOString() ?? null,
        canceledAt: job.canceledAt?.toISOString() ?? null,
        cancelReason: job.cancelReason,
        clientId: job.clientId,
        employeeScheduleId: job.employeeScheduleId,
        recipientType: job.recipientType,
        recipientPhone: job.recipientPhone,
        templateKey: job.templateKey,
        payload: job.payload,
        attempts: job.attempts,
        nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        deliverySnapshotHash: snapshotHash,
    })).digest("hex");

    const getSqlText = (value: unknown): string => {
        if (typeof value === "object" && value !== null && "strings" in value) {
            const strings = (value as { strings?: unknown }).strings;
            if (Array.isArray(strings)) {
                return strings.join("");
            }
        }

        return String(value);
    };

    let messageTriggerJobModel: ReturnType<typeof createMockPrismaMessageTriggerJob>;
    let queryRaw: jest.Mock;
    let prisma: PrismaService;
    let repository: SbMessageTriggerJobRepository;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
        messageTriggerJobModel = createMockPrismaMessageTriggerJob();
        queryRaw = jest.fn();
        prisma = {
            message_trigger_job: messageTriggerJobModel,
            $queryRaw: queryRaw,
            $transaction: jest.fn(),
        } as unknown as PrismaService;
        (prisma.$transaction as jest.Mock).mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(prisma));
        repository = new SbMessageTriggerJobRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("reads a bounded tenant/client/rule review snapshot with terminal rows and explicit cancellation intact", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({ id: "job-1", status: "sent" }),
            createRow({ id: "job-2", status: "canceled", canceledByUser: true }),
        ]);
        const result = await repository.findForClientAutomationReview("branch-1", 1, ["rule-1"]);
        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), branchId: "branch-1", clientId: 1, ruleId: { in: ["rule-1"] } },
            orderBy: { id: "asc" }, take: 501,
        });
        expect(result).toEqual([
            expect.objectContaining({ id: "job-1", status: "sent", canceledByUser: false }),
            expect.objectContaining({ id: "job-2", status: "canceled", canceledByUser: true }),
        ]);
        expect(messageTriggerJobModel.updateMany).not.toHaveBeenCalled();
        expect(messageTriggerJobModel.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("does not broaden an empty rule set into a customer history query", async () => {
        expect(await repository.findForClientAutomationReview("branch-1", 1, [])).toEqual([]);
        expect(messageTriggerJobModel.findMany).not.toHaveBeenCalled();
    });

    it("claimPendingWithRuleFence atomically locks the rule and claims the pending job", async () => {
        queryRaw.mockResolvedValueOnce([{ id: "job-1", claim_token: "claim-a" }]);

        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe("claim-a");
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(queryRaw).toHaveBeenCalledTimes(1);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("WITH candidate_job AS");
        expect(sqlText).toContain("FOR UPDATE OF rule");
        expect(sqlText).toContain('UPDATE "message_trigger_job" AS job');
        // The database enforces (status <> 'processing' OR claim_token IS NOT NULL);
        // a claim that does not mint a token is rejected and surfaces as a 500.
        expect(sqlText).toContain("claim_token = gen_random_uuid()::text");
        // The minted token is the CAS fence for every later write on this job.
        expect(sqlText).toContain("RETURNING job.id, job.claim_token");

        queryRaw.mockReset();
        queryRaw.mockResolvedValueOnce([]);
        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBeNull();
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("uses the claim token as a CAS so a stale completion cannot overwrite a newer claim", async () => {
        const staleAttempt = createJob();
        staleAttempt.claimToken = "claim-a";
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 0 });
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({
            status: "processing",
            claimToken: "claim-b",
        }));

        const result = await repository.update(staleAttempt);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: staleAttempt.id, claimToken: "claim-a", branchId: "branch-1" },
            data: expect.objectContaining({ claimToken: "claim-a" }),
        });
        expect(messageTriggerJobModel.update).not.toHaveBeenCalled();
        expect(result.claimToken).toBe("claim-b");
    });

    it("claims a branch job through a global rule without widening the job branch fence", async () => {
        queryRaw.mockResolvedValueOnce([{ id: "job-1", claim_token: "claim-b" }]);

        await expect(repository.claimPendingWithRuleFence("job-1", "branch-1")).resolves.toBe("claim-b");

        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("rule.branch_id IS NULL");
        expect(sqlText).toContain("job.branch_id = ");
        expect(sqlText).not.toContain("job.branch_id IS NULL");
    });

    it("hasActiveJobsBefore uses updatedAt as the generation fence when a dedupe row is reactivated", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce({ id: "job-1" }).mockResolvedValueOnce(null);

        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(true);
        await expect(repository.hasActiveJobsBefore("branch-1", "rule-1", now)).resolves.toBe(false);
        expect(messageTriggerJobModel.findFirst).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                ruleId: "rule-1",
                status: { in: ["pending", "processing", "dispatching"] },
                updatedAt: { lt: now },
            },
            select: { id: true },
        });
    });

    it("findDuePendingSystemScope filters out jobs with future nextAttemptAt and includes null/past", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findDuePendingSystemScope(25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                status: "pending",
                scheduledFor: { lte: now },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            orderBy: [
                { scheduledFor: "asc" },
                { createdAt: "asc" },
            ],
            take: 25,
        });
    });

    it("findUpcomingPendingByBranch keeps future, overdue, processing, and dispatching jobs visible", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findUpcomingPendingByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                status: { in: ["pending", "processing", "dispatching"] },
            },
            orderBy: { scheduledFor: "asc" },
            take: 25,
        });
    });

    it("findTerminalByBranch returns failed and canceled jobs newest first", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findTerminalByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                status: { in: ["failed", "canceled"] },
            },
            orderBy: { updatedAt: "desc" },
            take: 25,
        });
    });

    it("findRecentUndeliveredByBranch scopes to branch and the failed/canceled since-window, newest first", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                id: "job-canceled",
                status: "canceled",
                canceledAt: new Date("2026-07-08T12:00:00.000Z"),
                cancelReason: "사용자가 발송을 취소함",
                updatedAt: new Date("2026-07-08T12:00:00.000Z"),
            }),
            createRow({
                id: "job-failed",
                status: "failed",
                cancelReason: "provider rejected",
                updatedAt: new Date("2026-07-08T13:00:00.000Z"),
            }),
        ]);

        const result = await repository.findRecentUndeliveredByBranch("branch-1", since, until, 25);

        // Deliberately scoped with objectContaining (not a canceledByUser
        // guard test — see the dedicated guard test below): branch scoping,
        // the failed/canceled status split, and the per-status since-window
        // (canceledAt for canceled rows, updatedAt for failed rows, since
        // there is no dedicated failedAt column) are what this test covers.
        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                OR: [
                    { status: "canceled", canceledAt: { gte: since, lt: until } },
                    { status: "failed", updatedAt: { gte: since, lt: until } },
                ],
            }),
            orderBy: { updatedAt: "desc" },
            take: 25,
        });
        expect(result.map((job) => job.status)).toEqual(["canceled", "failed"]);
        expect(result[0]?.cancelReason).toBe("사용자가 발송을 취소함");
        expect(result[1]?.cancelReason).toBe("provider rejected");
    });

    it("findRecentUndeliveredByBranch's guarded WHERE clause excludes a user-canceled row from the digest (canceledByUser guard)", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findRecentUndeliveredByBranch("branch-1", since, until, 25);

        // Mutation-sensitive assertion, isolated from the shape test above:
        // a cancel the user pressed themselves must never be reported back
        // to them as a problem, so canceledByUser: false must always be
        // part of the WHERE clause. Deleting or weakening this line in the
        // implementation fails this test (and only this test — the shape
        // test above uses objectContaining and does not assert on this key).
        const [{ where }] = messageTriggerJobModel.findMany.mock.calls[0];
        expect(where.canceledByUser).toBe(false);
    });

    it("countRecentUndeliveredByBranch uses the same guarded half-open window", async () => {
        const since = new Date("2026-07-08T00:00:00.000Z");
        const until = new Date("2026-07-09T00:00:00.000Z");
        messageTriggerJobModel.count.mockResolvedValue(73);

        await expect(
            repository.countRecentUndeliveredByBranch("branch-1", since, until),
        ).resolves.toBe(73);
        expect(messageTriggerJobModel.count).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                canceledByUser: false,
                OR: [
                    { status: "canceled", canceledAt: { gte: since, lt: until } },
                    { status: "failed", updatedAt: { gte: since, lt: until } },
                ],
            },
        });
    });

    it("findHistoryByBranch excludes internal intent rows before applying the history limit", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findHistoryByBranch("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            take: 25,
        });
    });

    it("findHistoryPageByBranch uses current terminal status, UUID ordering, and cutoff log suppression", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);
        const snapshotAt = new Date("2026-07-09T00:00:00.123Z");
        const afterId = "00000000-0000-4000-8000-000000000042";

        await repository.findHistoryPageByBranch("branch-1", {
            snapshotAt,
            after: { source: "job", nativeId: afterId },
            limit: 11,
        });

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: {
                branchId: "branch-1",
                ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                status: { in: ["failed", "canceled"] },
                logs: { none: { branchId: "branch-1", createdAt: { lte: snapshotAt } } },
                createdAt: { lte: snapshotAt },
                AND: [{ id: { lt: afterId } }],
            },
            orderBy: { id: "desc" },
            take: 11,
        });
    });

    describe("findClientHistoryPageByBranch", () => {
        const snapshotAt = new Date("2026-07-09T00:00:00.123Z");
        const afterId = "00000000-0000-4000-8000-000000000042";

        it("keeps the branch-history filters and adds the client, with no raw phone lookup when the client has no phone", async () => {
            messageTriggerJobModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: null },
                { snapshotAt, after: { source: "job", nativeId: afterId }, limit: 11 },
            );

            expect(queryRaw).not.toHaveBeenCalled();
            expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
                where: {
                    branchId: "branch-1",
                    ruleId: { not: MESSAGE_AUTOMATION_INTENT_RULE_ID },
                    status: { in: ["failed", "canceled"] },
                    logs: { none: { branchId: "branch-1", createdAt: { lte: snapshotAt } } },
                    createdAt: { lte: snapshotAt },
                    AND: [{ id: { lt: afterId } }, { clientId: 7 }],
                },
                orderBy: { id: "desc" },
                take: 11,
            });
        });

        it("pulls in unowned terminal jobs by normalised phone digits within the branch", async () => {
            queryRaw.mockResolvedValue([{ id: afterId }]);
            messageTriggerJobModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: "01012345678" },
                { snapshotAt, after: null, limit: 11 },
            );

            expect(queryRaw).toHaveBeenCalledTimes(1);
            const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
            expect(sqlText).toContain("job.branch_id = ");
            expect(sqlText).toContain("job.client_id IS NULL");
            expect(sqlText).toContain("job.status IN ('failed', 'canceled')");
            expect(sqlText).toContain("COALESCE(job.recipient_phone, job.payload->>'recipientPhone')");
            expect(sqlText).toContain("'[^0-9]'");
            expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    branchId: "branch-1",
                    AND: [{ OR: [{ clientId: 7 }, { clientId: null, id: { in: [afterId] } }] }],
                }),
            }));
        });

        it("applies the continuation cursor and the already-logged exclusion before the phone-id limit", async () => {
            queryRaw.mockResolvedValue([]);
            messageTriggerJobModel.findMany.mockResolvedValue([]);

            await repository.findClientHistoryPageByBranch(
                "branch-1",
                { clientId: 7, phoneKey: "01012345678" },
                { snapshotAt, after: { source: "job", nativeId: afterId }, limit: 11 },
            );

            const sql = queryRaw.mock.calls[0][0] as { strings: string[]; values: unknown[] };
            const text = sql.strings.join("?").replace(/\s+/g, " ");
            expect(text).toContain("AND job.id < ?");
            expect(text).toContain("NOT EXISTS ( SELECT 1 FROM \"message_log\" AS log WHERE log.trigger_job_id = job.id");
            expect(text.indexOf("NOT EXISTS")).toBeLessThan(text.indexOf("LIMIT"));
            expect(sql.values).toContain(afterId);
            expect(sql.values[sql.values.length - 1]).toBe(11);
        });

        describe("an unowned phone match set larger than any fixed cap", () => {
            type FakeJob = ReturnType<typeof createRow> & { logged: boolean };
            const snapshot = new Date("2026-07-09T00:00:00.123Z");
            const phoneKey = "01012345678";

            // Rows stand in for terminal, unowned jobs that already match the client's phone;
            // the fake driver models only the clauses this fix is about (cursor, log exclusion, limit).
            const installFakeDatabase = (database: FakeJob[]) => {
                const byIdDesc = (a: FakeJob, b: FakeJob) => (a.id < b.id ? 1 : -1);
                queryRaw.mockImplementation(async (sql: { strings: string[]; values: unknown[] }) => {
                    const text = sql.strings.join("?");
                    let rows = database.filter((job) => job.clientId === null);
                    if (text.includes("job.id < ?")) {
                        const after = sql.values.find((v) => typeof v === "string" && v.startsWith("job-")) as string;
                        rows = rows.filter((job) => job.id < after);
                    }
                    if (text.includes("NOT EXISTS")) rows = rows.filter((job) => !job.logged);
                    const limit = sql.values[sql.values.length - 1] as number;
                    return rows.sort(byIdDesc).slice(0, limit).map((job) => ({ id: job.id }));
                });
                messageTriggerJobModel.findMany.mockImplementation(async (args: {
                    where: { logs?: unknown; AND: Array<Record<string, unknown>> };
                    take: number;
                }) => {
                    const matches = (job: FakeJob, clause: Record<string, unknown>): boolean => {
                        if ("OR" in clause) return (clause["OR"] as Array<Record<string, unknown>>).some((c) => matches(job, c));
                        if ("id" in clause) {
                            const id = clause["id"] as { lt?: string; in?: string[] };
                            if (id.lt !== undefined) return job.id < id.lt;
                            if (id.in) return id.in.includes(job.id);
                        }
                        if ("clientId" in clause && job.clientId !== clause["clientId"]) return false;
                        return true;
                    };
                    return database
                        .filter((job) => (args.where.logs ? !job.logged : true))
                        .filter((job) => args.where.AND.every((clause) => matches(job, clause)))
                        .sort(byIdDesc)
                        .slice(0, args.take);
                });
            };

            const jobRow = (id: string, logged: boolean): FakeJob => ({
                ...createRow({ id, clientId: null, status: "failed" }),
                logged,
            });

            it("returns the only unlogged job when 2,000 newer jobs already have a log", async () => {
                const logged = Array.from({ length: 2000 }, (_, i) => jobRow(`job-${String(i + 1).padStart(5, "0")}`, true));
                installFakeDatabase([jobRow("job-00000", false), ...logged]);

                const page = await repository.findClientHistoryPageByBranch(
                    "branch-1",
                    { clientId: 7, phoneKey },
                    { snapshotAt: snapshot, after: null, limit: 11 },
                );

                expect(page.map((job) => job.id)).toEqual(["job-00000"]);
            });

            it("walks 2,001 unlogged unowned jobs page by page without dropping the oldest", async () => {
                const all = Array.from({ length: 2001 }, (_, i) => jobRow(`job-${String(i).padStart(5, "0")}`, false));
                installFakeDatabase(all);

                const seen: string[] = [];
                let after: { source: "job"; nativeId: string } | null = null;
                for (let guard = 0; guard < 100; guard += 1) {
                    const rows: MessageTriggerJobEntity[] = await repository.findClientHistoryPageByBranch(
                        "branch-1",
                        { clientId: 7, phoneKey },
                        { snapshotAt: snapshot, after, limit: 51 },
                    );
                    const visible = rows.slice(0, 50);
                    seen.push(...visible.map((job) => job.id));
                    if (rows.length <= 50) break;
                    after = { source: "job", nativeId: visible[visible.length - 1]!.id };
                }

                expect(seen).toHaveLength(2001);
                expect(new Set(seen).size).toBe(2001);
                expect(seen[seen.length - 1]).toBe("job-00000");
            });
        });
    });

    it("upsertPending falls back to findUnique when the guarded update matches no row (sent row stays immutable)", async () => {
        queryRaw.mockResolvedValue([]);
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({
            status: "sent",
            sentAt: new Date("2026-07-09T00:01:00.000Z"),
            attempts: 2,
        }));

        const result = await repository.upsertPending(createJob());

        expect(queryRaw).toHaveBeenCalledTimes(1);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]);
        expect(sqlText).toMatch(
            /INSERT INTO "message_trigger_job" \([\s\S]*next_attempt_at,\s*claim_token,\s*updated_at[\s\S]*\)\s*VALUES/,
        );
        // branch_id is the ONLY uuid-cast parameter: rule_id is a text column and system rules
        // use non-uuid ids ("system:service_record_link") — casting it to uuid breaks the insert.
        expect(sqlText.match(/::uuid/g)).toHaveLength(1);
        expect(sqlText).toMatch(/0,\s*NULL,\s*NULL,\s*date_trunc\('milliseconds', clock_timestamp\(\)\)/);
        const normalizedSqlText = sqlText.replace(/\s+/g, " ");
        expect(normalizedSqlText).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET');
        expect(normalizedSqlText).toContain(
            'AND "message_trigger_job"."status" IN (\'pending\', \'canceled\')',
        );
        expect(messageTriggerJobModel.findUnique).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), dedupeKey: "rule-1:client:1" },
        });
        expect(result.status).toBe("sent");
        expect(result.attempts).toBe(2);
    });

    it("upsertPending reactivates a canceled same-dedupe row with a DB generation timestamp", async () => {
        const job = createJob();
        const rebuiltAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw.mockResolvedValueOnce([{
            id: "job-1",
            branch_id: "branch-1",
            rule_id: "rule-1",
            status: "pending",
            scheduled_for: job.scheduledFor,
            attempts: 0,
            next_attempt_at: null,
            sent_at: null,
            canceled_at: null,
            cancel_reason: null,
            client_id: 1,
            employee_schedule_id: null,
            recipient_type: MessageTriggerRecipientType.CLIENT,
            recipient_phone: "01012345678",
            template_key: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupe_key: job.dedupeKey,
            payload: job.payload,
            created_at: new Date("2026-07-01T00:00:00.000Z"),
            updated_at: rebuiltAt,
        }]);

        const result = await repository.upsertPending(job);

        expect(result.status).toBe("pending");
        expect(result.createdAt).toEqual(new Date("2026-07-01T00:00:00.000Z"));
        expect(result.updatedAt).toEqual(rebuiltAt);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("date_trunc('milliseconds', clock_timestamp())");
        expect(sqlText).toContain('AND "message_trigger_job"."status" IN (\'pending\', \'canceled\')');
    });

    it("does not resurrect a failed same-dedupe job after its message-log retry path takes ownership", async () => {
        queryRaw.mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValueOnce(createRow({
            status: "failed",
            attempts: 1,
            cancelReason: "provider rejected",
        }));

        const result = await repository.upsertPending(createJob());

        expect(result.status).toBe("failed");
        expect(result.attempts).toBe(1);
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain(
            'AND "message_trigger_job"."status" IN (\'pending\', \'canceled\')',
        );
    });

    it("upsertPending's guarded WHERE clause excludes a user-canceled row from resurrection (resurrection guard)", async () => {
        queryRaw.mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValueOnce(createRow({
            status: "canceled",
            canceledAt: new Date("2026-07-08T12:00:00.000Z"),
            cancelReason: "사용자가 발송을 취소함",
        }));

        const result = await repository.upsertPending(createJob());

        // The guarded UPDATE matches nothing, so the repository falls back to
        // reading the row as-is: it is still canceled, not resurrected to pending.
        expect(result.status).toBe("canceled");

        // Mutation-sensitive assertion: pins the guard's exact text so reverting or
        // weakening the clause fails this test. The rule may refresh pending rows and
        // reactivate internal cancellations, but failed rows belong exclusively to the
        // message-log retry path and must not become a second provider submission.
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain(
            "AND \"message_trigger_job\".\"status\" IN ('pending', 'canceled') "
            + "AND NOT (\"message_trigger_job\".\"status\" = 'canceled' AND \"message_trigger_job\".\"canceled_by_user\" = true)",
        );
    });

    it("promotes only an owned automatic scheduling marker to pending", async () => {
        const job = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            employeeScheduleId: 42,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:42:primary`,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 7,
                employeeName: "홍제공",
                memberId: "employee:7",
                recipientName: "홍제공",
                recipientPhone: "01012345678",
                buttonUrl: "https://mobile.test/service-record/efl_token",
                messageBody: "service record link",
                templateVariables: { serviceRecordUrl: "https://mobile.test/service-record/efl_token" },
            },
        });
        queryRaw.mockResolvedValueOnce([{
            id: "claim-1",
            branch_id: "branch-1",
            rule_id: SERVICE_RECORD_LINK_RULE_ID,
            status: "pending",
            scheduled_for: job.scheduledFor,
            attempts: 0,
            next_attempt_at: null,
            sent_at: null,
            canceled_at: null,
            cancel_reason: null,
            client_id: job.clientId,
            employee_schedule_id: job.employeeScheduleId,
            recipient_type: job.recipientType,
            recipient_phone: job.recipientPhone,
            template_key: job.templateKey,
            dedupe_key: job.dedupeKey,
            payload: job.payload,
            created_at: new Date("2026-07-08T00:00:00.000Z"),
            updated_at: new Date("2026-07-09T00:00:00.123Z"),
        }]);

        const result = await repository.promoteAutomaticSchedulingClaim(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            job,
        );

        expect(result).toMatchObject({
            id: "claim-1",
            status: "pending",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            employeeScheduleId: 42,
        });
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain('UPDATE "message_trigger_job"');
        expect(sqlText).toContain("SET status = 'pending'");
        expect(sqlText).toContain("status = 'failed'");
        expect(sqlText).toContain("cancel_reason = ");
        expect(sqlText).toContain("canceled_by_user = false");
        expect(sqlText).toContain("updated_at = ");
        expect(sqlText).toContain("RETURNING *");
    });

    it("fails closed when an automatic scheduling claim version is stale", async () => {
        const job = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
            clientId: 1,
            employeeScheduleId: 42,
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:42:primary`,
            payload: {
                clientId: 1,
                clientName: "김산모",
                employeeId: 7,
                employeeName: "홍제공",
                memberId: "employee:7",
                recipientName: "홍제공",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
        });
        queryRaw.mockResolvedValueOnce([]);

        await expect(repository.promoteAutomaticSchedulingClaim(
            "claim-1",
            "2026-07-09 00:00:00.123456+00",
            job,
        )).resolves.toBeNull();
        expect(messageTriggerJobModel.findUnique).not.toHaveBeenCalled();
        const sqlText = getSqlText(queryRaw.mock.calls[0][0]).replace(/\s+/g, " ");
        expect(sqlText).toContain("updated_at = ");
        expect(sqlText).toContain("dedupe_key = ");
        expect(sqlText).toContain("employee_schedule_id = ");
    });

    it("upsertPendingForRuleGeneration locks and verifies the rule before writing the pending job", async () => {
        const job = createJob();
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([{
                id: "job-1",
                branch_id: "branch-1",
                rule_id: "rule-1",
                status: "pending",
                scheduled_for: job.scheduledFor,
                attempts: 0,
                next_attempt_at: null,
                sent_at: null,
                canceled_at: null,
                cancel_reason: null,
                client_id: 1,
                employee_schedule_id: null,
                recipient_type: MessageTriggerRecipientType.CLIENT,
                recipient_phone: job.recipientPhone,
                template_key: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupe_key: job.dedupeKey,
                payload: job.payload,
                created_at: new Date("2026-07-01T00:00:00.000Z"),
                updated_at: expectedUpdatedAt,
            }]);

        const result = await repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            false,
        );

        expect(result?.status).toBe("pending");
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        expect(getSqlText(queryRaw.mock.calls[1][0])).toContain('INSERT INTO "message_trigger_job"');
    });

    it("preserves an existing intent-generated job while narrowly reactivating approval cancellation", async () => {
        const job = createJob();
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        const existingPending = createRow({
            id: "existing-job",
            dedupeKey: job.dedupeKey,
            status: "pending",
        });
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([]);
        messageTriggerJobModel.findUnique.mockResolvedValue(existingPending);

        const result = await repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            false,
            true,
        );

        expect(result?.id).toBe("existing-job");
        expect(result?.status).toBe("pending");
        const conflictQuery = queryRaw.mock.calls[1][0] as {
            strings?: readonly string[];
            values?: readonly unknown[];
        };
        const sqlText = getSqlText(conflictQuery).replace(/\s+/g, " ");
        expect(sqlText).toContain('ON CONFLICT ("dedupe_key") DO UPDATE SET');
        expect(sqlText).toContain(
            'AND "message_trigger_job"."status" = \'canceled\' '
            + 'AND "message_trigger_job"."canceled_by_user" = false '
            + 'AND "message_trigger_job"."cancel_reason" =',
        );
        expect(conflictQuery.values).toContain(MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON);
    });

    it.each([
        {
            name: "a newer rule generation",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.124Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
        {
            name: "an unexpected stale state",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            jobsStale: true,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
    ])("does not write when upsertPendingForRuleGeneration loses $name", async ({
        ruleUpdatedAt,
        jobsStale,
        expectedUpdatedAt,
        expectedJobsStale,
    }) => {
        const job = createJob();
        queryRaw.mockResolvedValueOnce([{
            id: "rule-1",
            branch_id: "branch-1",
            jobs_stale: jobsStale,
            updated_at: ruleUpdatedAt,
        }]);

        await expect(repository.upsertPendingForRuleGeneration(
            job,
            expectedUpdatedAt,
            expectedJobsStale,
        )).resolves.toBeNull();

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(messageTriggerJobModel.findUnique).not.toHaveBeenCalled();
    });

    it("cancelPendingForRuleGeneration locks the rule and applies only the requested pending context", async () => {
        const expectedUpdatedAt = new Date("2026-07-09T00:00:00.123Z");
        queryRaw
            .mockResolvedValueOnce([{
                id: "rule-1",
                branch_id: "branch-1",
                jobs_stale: false,
                updated_at: expectedUpdatedAt,
            }])
            .mockResolvedValueOnce([{ id: "job-1" }]);

        await expect(repository.cancelPendingForRuleGeneration(
            "branch-1",
            "rule-1",
            expectedUpdatedAt,
            false,
            "Client data changed",
            { clientId: 1 },
        )).resolves.toBe(1);

        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain('FROM "message_trigger_rule"');
        expect(getSqlText(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
        const updateSql = getSqlText(queryRaw.mock.calls[1][0]);
        expect(updateSql).toContain('UPDATE "message_trigger_job"');
        expect(updateSql).toContain("status IN ('pending', 'processing')");
        expect(updateSql).toContain("client_id =");
        expect(updateSql).toContain("branch_id =");
        expect(updateSql).toContain("date_trunc('milliseconds', clock_timestamp())");
    });

    it.each([
        {
            name: "a delayed R1 generation",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.124Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: false,
        },
        {
            name: "a rebuilt R2 rule after worker A cleared it",
            ruleUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            jobsStale: false,
            expectedUpdatedAt: new Date("2026-07-09T00:00:00.123Z"),
            expectedJobsStale: true,
        },
    ])("cancelPendingForRuleGeneration does not touch jobs for $name", async ({
        ruleUpdatedAt,
        jobsStale,
        expectedUpdatedAt,
        expectedJobsStale,
    }) => {
        queryRaw.mockResolvedValueOnce([{
            id: "rule-1",
            branch_id: "branch-1",
            jobs_stale: jobsStale,
            updated_at: ruleUpdatedAt,
        }]);

        await expect(repository.cancelPendingForRuleGeneration(
            "branch-1",
            "rule-1",
            expectedUpdatedAt,
            expectedJobsStale,
            "stale worker",
        )).resolves.toBeNull();

        expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("locks a provider-rejected source and creates one action-bound retry atomically", async () => {
        const source = MessageTriggerJobEntity.reconstitute(
            "job-1",
            "branch-1",
            "rule-1",
            "failed",
            new Date("2026-07-09T01:00:00.000Z"),
            null,
            null,
            "provider rejected",
            1,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-1:client:1",
            {
                memberId: "1",
                recipientName: "홍길동",
                recipientPhone: "01012345678",
                templateVariables: { retrySafety: "provider-rejected" },
            },
            new Date("2026-07-08T00:00:00.000Z"),
            new Date("2026-07-08T01:00:00.000Z"),
            1,
            null,
        );
        const retry = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: "rule-1",
            scheduledFor: now,
            clientId: 1,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: "agent-sms-retry:action-1",
            payload: source.payload,
        });
        const rawSource = {
            id: source.id,
            branch_id: source.branchId,
            rule_id: source.ruleId,
            status: source.status,
            scheduled_for: source.scheduledFor,
            attempts: source.attempts,
            next_attempt_at: source.nextAttemptAt,
            sent_at: source.sentAt,
            canceled_at: source.canceledAt,
            cancel_reason: source.cancelReason,
            client_id: source.clientId,
            employee_schedule_id: source.employeeScheduleId,
            recipient_type: source.recipientType,
            recipient_phone: source.recipientPhone,
            template_key: source.templateKey,
            dedupe_key: source.dedupeKey,
            payload: source.payload,
            created_at: source.createdAt,
            updated_at: source.updatedAt,
        };
        const txJob = createMockPrismaMessageTriggerJob();
        txJob.findUnique.mockResolvedValue(null);
        txJob.create.mockResolvedValue({
            ...createRow({ id: "retry-1", status: "pending", dedupeKey: retry.dedupeKey, payload: retry.payload }),
        });
        const transaction = { $queryRaw: jest.fn().mockResolvedValue([rawSource]), message_trigger_job: txJob };
        (prisma.$transaction as jest.Mock).mockImplementationOnce(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction));

        const snapshotHash = "snapshot-hash";
        await expect(repository.claimProviderRejectedForRetry(
            "branch-1",
            source.id,
            targetVersion(source, snapshotHash),
            snapshotHash,
            source,
            retry,
        )).resolves.toEqual(expect.objectContaining({ id: "retry-1" }));
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        expect(txJob.create).toHaveBeenCalledTimes(1);
    });

    it("findSentByRuleIdAndEmployeeScheduleId queries sent rows for the schedule", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                ruleId: "rule-employee",
                status: "sent",
                employeeScheduleId: 77,
            }),
        ]);

        const result = await repository.findSentByRuleIdAndEmployeeScheduleId("rule-employee", 77);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                ruleId: "rule-employee",
                employeeScheduleId: 77,
                status: "sent",
            },
        });
        expect(result[0]?.status).toBe("sent");
    });

    it("cancelPendingByRuleId issues one batch updateMany with reason", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 3 });

        await expect(repository.cancelPendingByRuleId("rule-1", "rule disabled")).resolves.toBe(3);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), ruleId: "rule-1", status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "rule disabled",
                claimToken: null,
            },
        });
    });

    it("cancelPendingByClientContext cancels client and assignment jobs in one batch", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelPendingByClientContext("branch-1", 42, "Client deleted"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                status: { in: ["pending", "processing"] },
                OR: [
                    { clientId: 42 },
                    { employeeSchedule: { is: { clientId: 42 } } },
                ],
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Client deleted",
                claimToken: null,
            },
        });
    });

    it("cancelOrphanedPending cancels legacy pending jobs whose relations were deleted", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelOrphanedPending("Related client or schedule deleted", "branch-1"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                status: { in: ["pending", "processing"] },
                clientId: null,
                employeeScheduleId: null,
                NOT: { ruleId: { startsWith: "agent-sms:" } },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "Related client or schedule deleted",
                claimToken: null,
            },
        });
    });

    it("findRecoverableOrphanedClientJobs returns pending and cleanup-canceled client jobs", async () => {
        messageTriggerJobModel.findMany.mockResolvedValue([]);

        await repository.findRecoverableOrphanedClientJobs("branch-1", 25);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                branchId: "branch-1",
                clientId: null,
                employeeScheduleId: null,
                recipientType: MessageTriggerRecipientType.CLIENT,
                NOT: { ruleId: { startsWith: "agent-sms:" } },
                OR: [
                    { status: "pending" },
                    {
                        status: "canceled",
                        cancelReason: {
                            in: ["Client deleted", "Related client or schedule deleted"],
                        },
                    },
                ],
            },
            orderBy: { createdAt: "asc" },
            take: 25,
        });
    });

    it("markOrphanedJobsReconciled records the replacement client", async () => {
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.markOrphanedJobsReconciled(["job-1", "job-2"], 42),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                id: { in: ["job-1", "job-2"] },
                status: "canceled",
                clientId: null,
                employeeScheduleId: null,
            },
            data: {
                cancelReason: "Reconciled to replacement client:42",
            },
        });
    });

    it("cancelPendingOlderThan issues one batch updateMany scoped to old pending jobs", async () => {
        const cutoff = new Date("2026-07-08T00:00:00.000Z");
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 2 });

        await expect(
            repository.cancelPendingOlderThan("rule-1", cutoff, "승인 전 예정 시각 경과"),
        ).resolves.toBe(2);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                ruleId: "rule-1",
                status: { in: ["pending", "processing"] },
                scheduledFor: { lt: cutoff },
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "승인 전 예정 시각 경과",
                claimToken: null,
            },
        });
    });

    it("cancelPendingByUser conditionally cancels a job scoped to id, branch, and pending status", async () => {
        messageTriggerJobModel.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });

        await expect(
            repository.cancelPendingByUser("job-1", "branch-1", "사용자가 발송을 취소함"),
        ).resolves.toBe(true);
        // A second call simulates the job no longer being pending (already sent,
        // currently processing, or already canceled) or belonging to another
        // branch: the conditional where clause matches nothing, so the method
        // reports failure instead of pretending success.
        await expect(
            repository.cancelPendingByUser("job-1", "branch-1", "사용자가 발송을 취소함"),
        ).resolves.toBe(false);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: "job-1", branchId: "branch-1", status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: "사용자가 발송을 취소함",
                canceledByUser: true,
                nextAttemptAt: null,
                claimToken: null,
            },
        });
    });

    it("findStaleProcessingSystemScope queries processing and dispatching rows older than cutoff", async () => {
        const cutoff = new Date("2026-07-09T00:10:00.000Z");
        messageTriggerJobModel.findMany.mockResolvedValue([
            createRow({
                status: "processing",
                updatedAt: new Date("2026-07-08T23:59:00.000Z"),
            }),
            createRow({
                id: "job-dispatching",
                status: "dispatching",
                updatedAt: new Date("2026-07-08T23:58:00.000Z"),
            }),
        ]);

        const result = await repository.findStaleProcessingSystemScope(cutoff, 10);

        expect(messageTriggerJobModel.findMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(),
                status: { in: ["processing", "dispatching"] },
                updatedAt: { lt: cutoff },
            },
            orderBy: { updatedAt: "asc" },
            take: 10,
        });
        expect(result.map((job) => job.status)).toEqual(["processing", "dispatching"]);
    });

    it("findByIdInBranch returns null when the id and branch do not both match", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce(null);

        await expect(repository.findByIdInBranch("branch-1", "job-1")).resolves.toBeNull();

        expect(messageTriggerJobModel.findFirst).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: "job-1", branchId: "branch-1" },
        });
    });

    it("findByIdInBranch resolves the row when the id and branch both match", async () => {
        messageTriggerJobModel.findFirst.mockResolvedValueOnce(createRow());

        const result = await repository.findByIdInBranch("branch-1", "job-1");

        expect(result?.id).toBe("job-1");
        expect(result?.branchId).toBe("branch-1");
    });

    it("update pins branchId into the claim-token updateMany where clause", async () => {
        const job = createJob();
        job.claimToken = "claim-a";
        messageTriggerJobModel.updateMany.mockResolvedValue({ count: 1 });
        messageTriggerJobModel.findUnique.mockResolvedValue(createRow({ claimToken: "claim-a" }));

        await repository.update(job);

        expect(messageTriggerJobModel.updateMany).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: job.id, claimToken: "claim-a", branchId: "branch-1" },
            data: expect.any(Object),
        });
        expect(messageTriggerJobModel.findUnique).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: job.id, branchId: "branch-1" },
        });
    });

    it("update pins branchId into the plain update where clause when there is no claim token", async () => {
        const job = createJob();
        messageTriggerJobModel.update.mockResolvedValue(createRow());

        await repository.update(job);

        expect(messageTriggerJobModel.update).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: job.id, branchId: "branch-1" },
            data: expect.any(Object),
        });
    });

    it("update falls back to an id-only where and warns when the job has no branch", async () => {
        const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        const job = createJob();
        job.branchId = null;
        messageTriggerJobModel.update.mockResolvedValue(createRow({ branchId: null }));

        await repository.update(job);

        expect(messageTriggerJobModel.update).toHaveBeenCalledWith({
            where: { ...ordinaryAutomationJobWhere(), id: job.id },
            data: expect.any(Object),
        });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("message_trigger_job_null_branch_write"),
        );
        warnSpy.mockRestore();
    });
});

/**
 * `replacePendingJobsUnlessInFlight` against a small in-memory database that
 * evaluates the repository's real SQL (bound values and operators) and models
 * the row, rule and advisory locks the fence relies on, including lock-order
 * deadlock detection. The same races run against a real PostgreSQL in
 * `sb.message-trigger-job.manual-send-concurrency.spec.ts` (env-gated).
 */
describe("SbMessageTriggerJobRepository.replacePendingJobsUnlessInFlight (modelled row locks)", () => {
    const RULE_ID = SERVICE_RECORD_LINK_RULE_ID;
    const OTHER_RULE_ID = "system:another_rule";
    const SCHEDULE_ID = 10;
    const OTHER_SCHEDULE_ID = 11;
    const CANCEL_REASON = "Service record link rescheduled";
    const LIVE_STATUSES = ["pending", "processing", "dispatching"];

    type FakeRow = {
        id: string;
        status: string;
        ruleId: string;
        scheduleId: number | null;
        dedupeKey: string;
        claimToken: string | null;
        cancelReason: string | null;
        scheduledFor: Date;
        payload: unknown;
    };
    type Predicate = { column: string; op: string; value: unknown };
    type RawQuery = { text: string; values: unknown[] };

    const sqlText = (value: unknown): string => {
        const candidate = value as { strings?: string[]; text?: string };
        return (candidate.text ?? candidate.strings?.join("?") ?? String(value)).replace(/\s+/g, " ");
    };

    /** Column comparisons the selectors bind as `$n`, read from the real rendered SQL. */
    const boundPredicates = (text: string, values: unknown[]): Predicate[] => (
        [...text.matchAll(/\b(rule_id|employee_schedule_id|id)\s*(=|<>)\s*\$(\d+)/g)]
            .map((match) => ({ column: match[1]!, op: match[2]!, value: values[Number(match[3]) - 1] }))
    );

    /**
     * A small in-memory database that evaluates the repository's real SQL
     * (bound values and operators, not fixed fixtures) and models the locking
     * the manual-send fence depends on: exclusive row locks held to transaction
     * end (job rows, rule rows for `FOR UPDATE`), the foreign-key KEY SHARE lock
     * an INSERT takes on the rule row (it conflicts with `FOR UPDATE`),
     * advisory transaction locks, deadlock detection (40P01), and READ COMMITTED
     * re-evaluation of a blocked statement's WHERE clause after the wait.
     */
    class FakeDatabase {
        readonly rows = new Map<string, FakeRow>();
        readonly rules = new Set<string>([RULE_ID, OTHER_RULE_ID]);
        private nextId = 1;
        private readonly locks = new Map<string, object>();
        private readonly keyShares = new Map<string, Set<object>>();
        private readonly waitingOn = new Map<object, object[]>();
        private readonly finished = new Map<object, { promise: Promise<void>; resolve: () => void }>();
        /** Runs while a replacement transaction holds its job row locks, before it writes. */
        afterRowLocks: (() => Promise<void>) | null = null;
        /** Runs while a claim holds the rule and job locks, before it commits. */
        beforeClaimCommit: (() => Promise<void>) | null = null;

        seed(status: string, overrides: Partial<FakeRow> = {}): FakeRow {
            const id = overrides.id ?? `job-${this.nextId++}`;
            const row: FakeRow = {
                id,
                status,
                ruleId: RULE_ID,
                scheduleId: SCHEDULE_ID,
                dedupeKey: `${overrides.ruleId ?? RULE_ID}:schedule:${overrides.scheduleId ?? SCHEDULE_ID}:primary:${id}`,
                claimToken: status === "processing" || status === "dispatching" ? `claim-${id}` : null,
                cancelReason: null,
                scheduledFor: new Date("2026-07-09T01:00:00.000Z"),
                payload: {},
                ...overrides,
            };
            this.rows.set(row.id, row);
            return row;
        }

        live(ruleId = RULE_ID, scheduleId = SCHEDULE_ID): FakeRow[] {
            return [...this.rows.values()].filter((row) => (
                LIVE_STATUSES.includes(row.status) && row.ruleId === ruleId && row.scheduleId === scheduleId
            ));
        }

        private done(owner: object) {
            let entry = this.finished.get(owner);
            if (!entry) {
                let resolve!: () => void;
                const promise = new Promise<void>((settled) => { resolve = settled; });
                entry = { promise, resolve };
                this.finished.set(owner, entry);
            }
            return entry;
        }

        private blockers(key: string, owner: object, mode: "exclusive" | "share"): object[] {
            const found: object[] = [];
            const holder = this.locks.get(key);
            if (holder && holder !== owner) found.push(holder);
            if (mode === "exclusive") {
                for (const sharer of this.keyShares.get(key) ?? []) if (sharer !== owner) found.push(sharer);
            }
            return found;
        }

        private reaches(from: object[], target: object, seen = new Set<object>()): boolean {
            for (const owner of from) {
                if (owner === target) return true;
                if (seen.has(owner)) continue;
                seen.add(owner);
                if (this.reaches(this.waitingOn.get(owner) ?? [], target, seen)) return true;
            }
            return false;
        }

        private async acquire(key: string, owner: object, mode: "exclusive" | "share" = "exclusive"): Promise<void> {
            for (;;) {
                const blockers = this.blockers(key, owner, mode);
                if (blockers.length === 0) break;
                if (this.reaches(blockers, owner)) {
                    this.waitingOn.delete(owner);
                    throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
                }
                this.waitingOn.set(owner, blockers);
                await Promise.race(blockers.map((blocker) => this.done(blocker).promise));
            }
            this.waitingOn.delete(owner);
            if (mode === "exclusive") {
                this.locks.set(key, owner);
            } else {
                const sharers = this.keyShares.get(key) ?? new Set<object>();
                sharers.add(owner);
                this.keyShares.set(key, sharers);
            }
        }

        private releaseAll(owner: object): void {
            for (const [key, holder] of this.locks) if (holder === owner) this.locks.delete(key);
            for (const sharers of this.keyShares.values()) sharers.delete(owner);
            this.waitingOn.delete(owner);
            this.done(owner).resolve();
        }

        private toRaw(row: FakeRow) {
            return {
                id: row.id,
                branch_id: "branch-1",
                rule_id: row.ruleId,
                status: row.status,
                scheduled_for: row.scheduledFor,
                attempts: 0,
                next_attempt_at: null,
                sent_at: null,
                canceled_at: null,
                cancel_reason: row.cancelReason,
                client_id: 20,
                employee_schedule_id: row.scheduleId,
                recipient_type: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                recipient_phone: "01011112222",
                template_key: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
                dedupe_key: row.dedupeKey,
                payload: row.payload,
                created_at: new Date("2026-07-01T00:00:00.000Z"),
                updated_at: new Date("2026-07-01T00:00:00.000Z"),
                claim_token: row.claimToken,
            };
        }

        /** One statement; `owner` holds any locks it takes until its transaction (or autocommit statement) ends. */
        private async statement(owner: object, query: unknown): Promise<unknown[]> {
            const text = sqlText(query);
            const { values } = query as RawQuery;
            if (text.includes("SET status = 'processing'")) {
                // Dispatcher claim: candidate read, then rule FOR UPDATE, then the job UPDATE.
                expect(text).toContain("AND job.status = 'pending'");
                expect(text).toContain("FOR UPDATE OF rule");
                const id = values.find((value) => typeof value === "string" && this.rows.has(value)) as string;
                const candidate = this.rows.get(id)!;
                if (candidate.status !== "pending") return [];
                await this.acquire(`rule:${candidate.ruleId}`, owner);
                await this.acquire(`job:${id}`, owner);
                const row = this.rows.get(id)!;
                // READ COMMITTED: re-evaluate the WHERE clause on the row's latest version.
                if (row.status !== "pending") return [];
                await this.beforeClaimCommit?.();
                row.status = "processing";
                row.claimToken = `claim-${id}`;
                return [{ id, claim_token: row.claimToken }];
            }
            if (text.includes('FROM "message_trigger_rule"') && text.includes("FOR UPDATE")) {
                const ruleId = boundPredicates(text, values).find((predicate) => predicate.column === "id" && predicate.op === "=")?.value;
                expect(typeof ruleId).toBe("string");
                await this.acquire(`rule:${ruleId as string}`, owner);
                return this.rules.has(ruleId as string) ? [{ id: ruleId }] : [];
            }
            if (text.includes("FOR UPDATE")) {
                const predicates = boundPredicates(text, values);
                // The selector must scope by rule AND schedule; dropping either would lock foreign rows.
                for (const column of ["rule_id", "employee_schedule_id"]) {
                    expect(predicates.some((predicate) => predicate.column === column && predicate.op === "=")).toBe(true);
                }
                const statuses = /status IN \(([^)]*)\)/.exec(text)![1]!
                    .split(",").map((status) => status.trim().replace(/'/g, ""));
                const columnOf = (row: FakeRow, column: string) => (column === "rule_id" ? row.ruleId : row.scheduleId);
                const matches = (row: FakeRow) => statuses.includes(row.status) && predicates.every((predicate) => (
                    (columnOf(row, predicate.column) === predicate.value) === (predicate.op === "=")
                ));
                const locked: FakeRow[] = [];
                for (const candidate of [...this.rows.values()].filter(matches).sort((left, right) => left.id.localeCompare(right.id))) {
                    await this.acquire(`job:${candidate.id}`, owner);
                    // Re-check after the lock wait, like PostgreSQL does.
                    const current = this.rows.get(candidate.id)!;
                    if (matches(current)) locked.push(current);
                }
                await this.afterRowLocks?.();
                return locked.map((row) => ({ id: row.id, status: row.status }));
            }
            if (text.includes("SET status = 'canceled'")) {
                expect(text).toContain("AND status = 'pending'");
                const ids = values.filter((value) => typeof value === "string" && this.rows.has(value)) as string[];
                const canceled: Array<{ id: string }> = [];
                for (const id of ids) {
                    const row = this.rows.get(id)!;
                    if (row.status !== "pending") continue;
                    row.status = "canceled";
                    row.cancelReason = values.find((value) => value === CANCEL_REASON) as string;
                    row.claimToken = null;
                    canceled.push({ id });
                }
                return canceled;
            }
            if (text.includes('INSERT INTO "message_trigger_job"')) {
                const [, ruleId, scheduledFor, , scheduleId, , , , dedupeKey, payload] = values;
                // The foreign key takes a KEY SHARE lock on the rule row, which waits behind a FOR UPDATE holder.
                await this.acquire(`rule:${ruleId as string}`, owner, "share");
                expect(this.rules.has(ruleId as string)).toBe(true);
                const row = this.seed("pending", {
                    id: `new-${this.nextId}`,
                    ruleId: ruleId as string,
                    scheduleId: scheduleId as number,
                    dedupeKey: dedupeKey as string,
                    scheduledFor: scheduledFor as Date,
                    payload: JSON.parse(payload as string),
                });
                return [this.toRaw(row)];
            }
            throw new Error(`Unmodelled statement: ${text}`);
        }

        asPrisma(): PrismaService {
            const transactionClient = (owner: object) => ({
                $executeRaw: async (query: unknown) => {
                    expect(sqlText(query)).toContain("pg_advisory_xact_lock");
                    await this.acquire(`advisory:${String((query as RawQuery).values[0])}`, owner);
                    return 1;
                },
                $queryRaw: (query: unknown) => this.statement(owner, query),
            });
            return {
                $queryRaw: async (query: unknown) => {
                    const owner = {};
                    try {
                        return await this.statement(owner, query);
                    } finally {
                        this.releaseAll(owner);
                    }
                },
                $transaction: async (work: (transaction: unknown) => Promise<unknown>) => {
                    const owner = {};
                    try {
                        return await work(transactionClient(owner));
                    } finally {
                        this.releaseAll(owner);
                    }
                },
            } as unknown as PrismaService;
        }
    }

    const manualJob = (suffix: string) => MessageTriggerJobEntity.create({
        branchId: "branch-1",
        ruleId: RULE_ID,
        scheduledFor: new Date("2026-07-09T02:00:00.000Z"),
        clientId: 20,
        employeeScheduleId: SCHEDULE_ID,
        recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        recipientPhone: "01011112222",
        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        dedupeKey: `${RULE_ID}:schedule:${SCHEDULE_ID}:primary:manual:${suffix}`,
        payload: {
            memberId: "employee:30",
            recipientName: "제공인력",
            recipientPhone: "01011112222",
            templateVariables: {},
        },
    });

    let database: FakeDatabase;
    let repository: SbMessageTriggerJobRepository;

    beforeEach(() => {
        database = new FakeDatabase();
        repository = new SbMessageTriggerJobRepository(database.asPrisma());
    });

    it.each(["dispatching", "processing"])("refuses and writes nothing when a %s job already exists", async (status) => {
        const original = database.seed(status);

        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result).toEqual({ kind: "in_flight", inFlightJobIds: [original.id] });
        expect(database.rows.size).toBe(1);
        expect(original.status).toBe(status);
        expect(original.cancelReason).toBeNull();
    });

    it("also refuses when the in-flight job sits next to a pending one, leaving the pending one untouched", async () => {
        const pending = database.seed("pending");
        const dispatching = database.seed("dispatching");

        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result).toMatchObject({ kind: "in_flight", inFlightJobIds: [dispatching.id] });
        expect(pending.status).toBe("pending");
        expect(database.rows.size).toBe(2);
    });

    it("cancels pending jobs and enqueues exactly one replacement in the same transaction", async () => {
        const first = database.seed("pending");
        const second = database.seed("pending");
        database.seed("sent");

        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result.kind).toBe("replaced");
        if (result.kind !== "replaced") return;
        expect([...result.canceledJobIds].sort()).toEqual([first.id, second.id].sort());
        expect(first).toMatchObject({ status: "canceled", cancelReason: CANCEL_REASON, claimToken: null });
        expect(second.status).toBe("canceled");
        expect(result.job.status).toBe("pending");
        expect(database.live().map((row) => row.id)).toEqual([result.job.id]);
    });

    it("only looks at this schedule and this rule: other schedules' and other rules' jobs neither block nor get cancelled", async () => {
        const otherScheduleInFlight = database.seed("dispatching", { scheduleId: OTHER_SCHEDULE_ID });
        const otherScheduleProcessing = database.seed("processing", { scheduleId: OTHER_SCHEDULE_ID });
        const otherRulePending = database.seed("pending", { ruleId: OTHER_RULE_ID });
        const own = database.seed("pending");

        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result.kind).toBe("replaced");
        if (result.kind !== "replaced") return;
        expect(result.canceledJobIds).toEqual([own.id]);
        expect(own.status).toBe("canceled");
        expect(otherScheduleInFlight.status).toBe("dispatching");
        expect(otherScheduleProcessing.status).toBe("processing");
        expect(otherRulePending).toMatchObject({ status: "pending", cancelReason: null });
        expect(database.live()).toHaveLength(1);
    });

    it("refuses on this schedule's in-flight job and leaves other schedules' pending jobs alone", async () => {
        const own = database.seed("dispatching");
        const otherSchedulePending = database.seed("pending", { scheduleId: OTHER_SCHEDULE_ID });

        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result).toEqual({ kind: "in_flight", inFlightJobIds: [own.id] });
        expect(otherSchedulePending.status).toBe("pending");
        expect(database.rows.size).toBe(2);
    });

    it("enqueues the replacement when nothing is live", async () => {
        const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(result.kind).toBe("replaced");
        expect(database.live()).toHaveLength(1);
    });

    it("takes the advisory lock, then the rule row, then row-locks the live jobs, then cancels, then inserts", async () => {
        const calls: string[] = [];
        const inner = database.asPrisma();
        const spied = {
            $transaction: (work: (transaction: unknown) => Promise<unknown>) => inner.$transaction(async (transaction) => {
                const client = transaction as { $queryRaw: (q: unknown) => unknown; $executeRaw: (q: unknown) => unknown };
                return work({
                    $executeRaw: (query: unknown) => { calls.push(sqlText(query)); return client.$executeRaw(query); },
                    $queryRaw: (query: unknown) => { calls.push(sqlText(query)); return client.$queryRaw(query); },
                });
            }),
        } as unknown as PrismaService;
        database.seed("pending");

        await new SbMessageTriggerJobRepository(spied).replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

        expect(calls).toEqual([
            expect.stringContaining("pg_advisory_xact_lock"),
            expect.stringMatching(/FROM "message_trigger_rule".*FOR UPDATE/),
            expect.stringMatching(/FROM "message_trigger_job".*FOR UPDATE/),
            expect.stringContaining("SET status = 'canceled'"),
            expect.stringContaining('INSERT INTO "message_trigger_job"'),
        ]);
    });

    describe("a dispatcher claim racing the manual replacement", () => {
        it("claim committed first: the replacement is refused and no second job exists", async () => {
            const original = database.seed("pending");

            const claimToken = await repository.claimPendingWithRuleFence(original.id, "branch-1");
            original.status = "dispatching"; // scheduler advanced to the irreversible provider authorization
            const result = await repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);

            expect(claimToken).toBe(`claim-${original.id}`);
            expect(result.kind).toBe("in_flight");
            expect(database.live().map((row) => row.id)).toEqual([original.id]);
            expect(database.rows.size).toBe(1);
        });

        it("claim holds the row lock when the replacement starts: the replacement waits, then refuses", async () => {
            const original = database.seed("pending");
            let claimIsHoldingLock!: () => void;
            const lockHeld = new Promise<void>((resolve) => { claimIsHoldingLock = resolve; });
            let letClaimCommit!: () => void;
            const commitGate = new Promise<void>((resolve) => { letClaimCommit = resolve; });
            database.beforeClaimCommit = async () => { claimIsHoldingLock(); await commitGate; };

            const claim = repository.claimPendingWithRuleFence(original.id, "branch-1");
            await lockHeld;
            const replacement = repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);
            await Promise.resolve();
            letClaimCommit();
            const [claimToken, result] = await Promise.all([claim, replacement]);

            expect(claimToken).not.toBeNull();
            expect(result).toEqual({ kind: "in_flight", inFlightJobIds: [original.id] });
            expect(original.status).toBe("processing");
            expect(database.rows.size).toBe(1);
        });

        it("replacement holds its locks when the claim starts: the claim waits at the rule lock, loses against the canceled row, no deadlock", async () => {
            const original = database.seed("pending");
            let replacementHoldsLocks!: () => void;
            const locksHeld = new Promise<void>((resolve) => { replacementHoldsLocks = resolve; });
            let letReplacementWrite!: () => void;
            const writeGate = new Promise<void>((resolve) => { letReplacementWrite = resolve; });
            database.afterRowLocks = async () => { replacementHoldsLocks(); await writeGate; };

            const replacement = repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON);
            await locksHeld;
            const claim = repository.claimPendingWithRuleFence(original.id, "branch-1");
            await Promise.resolve();
            letReplacementWrite();
            const [result, claimToken] = await Promise.all([replacement, claim]);

            expect(result.kind).toBe("replaced");
            expect(claimToken).toBeNull();
            expect(original.status).toBe("canceled");
            expect(database.live()).toHaveLength(1);
            expect(database.live()[0]!.status).toBe("pending");
        });
    });

    it("two concurrent manual sends never leave two live jobs", async () => {
        database.seed("pending");

        const results = await Promise.all([
            repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON),
            repository.replacePendingJobsUnlessInFlight(manualJob("b"), CANCEL_REASON),
        ]);

        expect(results.map((result) => result.kind)).toEqual(["replaced", "replaced"]);
        expect(database.live()).toHaveLength(1);
    });

    it("two concurrent manual sends with nothing live yet still leave exactly one live job", async () => {
        await Promise.all([
            repository.replacePendingJobsUnlessInFlight(manualJob("a"), CANCEL_REASON),
            repository.replacePendingJobsUnlessInFlight(manualJob("b"), CANCEL_REASON),
        ]);

        expect(database.live()).toHaveLength(1);
    });

    it("refuses a reserved internal record and a job without a schedule scope", async () => {
        const reserved = manualJob("a");
        Object.assign(reserved, { ruleId: MESSAGE_AUTOMATION_INTENT_RULE_ID });
        await expect(repository.replacePendingJobsUnlessInFlight(reserved, CANCEL_REASON))
            .rejects.toThrow("Internal automation records are not delivery jobs");

        const unscoped = manualJob("b");
        unscoped.employeeScheduleId = null;
        await expect(repository.replacePendingJobsUnlessInFlight(unscoped, CANCEL_REASON))
            .rejects.toThrow("employee schedule scope");
    });
});
