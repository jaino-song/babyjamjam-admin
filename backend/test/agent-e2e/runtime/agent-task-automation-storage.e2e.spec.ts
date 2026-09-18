import type { PrismaClient, message_trigger_job } from "@prisma/client";
import { SbMessageTriggerJobRepository } from "../../../infrastructure/database/repositories/sb.message-trigger-job.repository";
import type { PrismaService } from "../../../infrastructure/database/prisma.service";
import { MessageTriggerJobEntity } from "../../../domain/entities/message-trigger-job.entity";
import { MessageTriggerEventType, MessageTriggerRecipientType, MessageTriggerOffsetType, MessageTriggerTemplateKey } from "../../../domain/constants/message-trigger-catalog";
import { MESSAGE_AUTOMATION_INTENT_RULE_ID } from "../../../domain/constants/message-automation-intent";
import { AGENT_AUTOMATION_RECORD_CANCEL_REASON, AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "../../../domain/constants/agent-automation-storage";
import { createApprovedAgentTaskPersistenceClient, assertApprovedAgentTaskPersistenceDatabaseTarget } from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "b8100000-0000-4000-8000-000000000001";
const ruleId = "agent-task-internal-storage-proof";
const now = new Date("2026-09-17T00:00:00.000Z");
const until = new Date("2099-01-01T00:00:00.000Z");
const carriers = ["internal", "dedupe", "null-payload", "object-payload"] as const;

describeAgentE2E("internal automation storage is isolated from delivery jobs", () => {
    let prisma: PrismaClient;
    let repository: SbMessageTriggerJobRepository;
    let ruleUpdatedAt: Date;

    async function cleanup() {
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await cleanup();
        await prisma.branch.create({ data: { id: branchId, name: "합성 내부 기록 검증", slug: "agent-task-internal-storage-proof" } });
        const ruleData = {
            name: "합성 내부 기록 검증", eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE, recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.CLIENT_GREETING, isActive: true,
        };
        const rule = await prisma.message_trigger_rule.create({ data: { ...ruleData, id: ruleId, branchId } });
        ruleUpdatedAt = rule.updatedAt;
        // Shared sentinel belongs to its existing intent owner; never delete or update it here.
        await prisma.message_trigger_rule.upsert({ where: { id: MESSAGE_AUTOMATION_INTENT_RULE_ID },
            create: { ...ruleData, id: MESSAGE_AUTOMATION_INTENT_RULE_ID, branchId: null, isActive: false }, update: {} });
        repository = new SbMessageTriggerJobRepository(prisma as unknown as PrismaService);
    });
    beforeEach(async () => { await prisma.message_trigger_job.deleteMany({ where: { branchId } }); });
    afterAll(async () => { if (prisma) { await cleanup(); await prisma.$disconnect(); } });

    async function seed(carrier: typeof carriers[number], status = "canceled") {
        return prisma.message_trigger_job.create({ data: {
            branchId, ruleId: carrier === "internal" ? MESSAGE_AUTOMATION_INTENT_RULE_ID : ruleId,
            status, scheduledFor: now, canceledAt: status === "canceled" ? now : null,
            cancelReason: status === "canceled" ? AGENT_AUTOMATION_RECORD_CANCEL_REASON : null,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            dedupeKey: carrier === "dedupe" || carrier === "internal"
                ? `${AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX}${branchId}:${carrier}` : `${ruleId}:${carrier}`,
            payload: carrier === "internal" || carrier === "object-payload" ? { [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: { version: 1 } }
                : carrier === "null-payload" ? { [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: null } : {},
        } });
    }

    // Caller removes every reserved marker. The repository must fence the stored row,
    // not trust the caller's replacement values or only reject after changing the row.
    function stripped(row: message_trigger_job, claimToken: string | null = null) {
        return MessageTriggerJobEntity.reconstitute(row.id, branchId, ruleId, "pending", now, null, null, null,
            null, null, MessageTriggerRecipientType.CLIENT, "01000000001", MessageTriggerTemplateKey.CLIENT_GREETING,
            `${ruleId}:ordinary`, { memberId: "synthetic", recipientName: "합성", recipientPhone: "01000000001", templateVariables: {} },
            row.createdAt, row.updatedAt, 0, null, claimToken);
    }

    it("hides terminal records and preserves them during orphan reconciliation", async () => {
        const rows = await Promise.all(carriers.map((carrier) => seed(carrier)));
        expect(await repository.findTerminalByBranch(branchId)).toEqual([]);
        expect(await repository.findHistoryByBranch(branchId)).toEqual([]);
        expect(await repository.findRecentUndeliveredByBranch(branchId, now, until, 100)).toEqual([]);
        expect(await repository.countRecentUndeliveredByBranch(branchId, now, until)).toBe(0);
        expect(await repository.markOrphanedJobsReconciled(rows.map(({ id }) => id), 999)).toBe(0);
        for (const row of rows) {
            expect(await repository.findByIdInBranch(branchId, row.id)).toBeNull();
            expect(await prisma.message_trigger_job.findUnique({ where: { id: row.id } })).toEqual(row);
        }
    });

    it("never claims or cancels malformed pending carriers, including JSON null markers", async () => {
        const rows = await Promise.all(carriers.map((carrier) => seed(carrier, "pending")));
        expect(await repository.findUpcomingPendingByBranch(branchId)).toEqual([]);
        expect(await repository.findRecoverableOrphanedClientJobs(branchId)).toEqual([]);
        expect(await repository.hasActiveJobsBefore(branchId, ruleId, until)).toBe(false);
        for (const row of rows) {
            expect(await repository.claimPendingWithRuleFence(row.id, branchId)).toBeNull();
            expect(await repository.cancelPendingByUser(row.id, branchId, "synthetic cancellation")).toBe(false);
        }
        expect(await repository.cancelOrphanedPending("synthetic cleanup", branchId)).toBe(0);
        expect(await repository.cancelPendingByRuleId(ruleId, "synthetic rule change")).toBe(0);
        expect(await repository.cancelPendingOlderThan(ruleId, until, "synthetic expiry")).toBe(0);
        expect(await repository.cancelPendingForRuleGeneration(branchId, ruleId, ruleUpdatedAt, false, "synthetic generation")).toBe(0);
        for (const row of rows) expect(await prisma.message_trigger_job.findUnique({ where: { id: row.id } })).toEqual(row);
    });

    it.each(carriers)("rejects stripped update requests against stored %s carriers", async (carrier) => {
        const row = await seed(carrier);
        await expect(repository.update(stripped(row))).rejects.toThrow();
        await expect(repository.update(stripped(row, "forged-claim"))).rejects.toThrow();
        expect(await prisma.message_trigger_job.findUnique({ where: { id: row.id } })).toEqual(row);
    });

    it.each(["null-payload", "object-payload"] as const)("does not overwrite a %s carrier on a dedupe conflict", async (carrier) => {
        const row = await seed(carrier);
        const job = stripped(row);
        Object.assign(job, { dedupeKey: row.dedupeKey });
        await expect(repository.upsertPending(job)).rejects.toThrow();
        await expect(repository.upsertPendingForRuleGeneration(job, ruleUpdatedAt, false)).rejects.toThrow();
        expect(await prisma.message_trigger_job.findUnique({ where: { id: row.id } })).toEqual(row);
    });

    it("preserves ordinary create, update, lookup, claim, cancellation and rebuild behavior", async () => {
        const job = MessageTriggerJobEntity.create({ branchId, ruleId, scheduledFor: now,
            recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
            recipientPhone: "01000000001", dedupeKey: `${ruleId}:ordinary`,
            payload: { memberId: "synthetic", recipientName: "합성", recipientPhone: "01000000001", templateVariables: {} } });
        const created = await repository.create(job);
        expect((await repository.findByIdInBranch(branchId, created.id))?.id).toBe(created.id);
        expect((await repository.update(created)).id).toBe(created.id);
        expect(await repository.claimPendingWithRuleFence(created.id, branchId)).toEqual(expect.any(String));
        expect(await repository.cancelPendingByRuleId(ruleId, "synthetic internal refresh")).toBe(1);
        expect((await repository.upsertPending(job)).status).toBe("pending");
        expect((await repository.upsertPendingForRuleGeneration(job, ruleUpdatedAt, false))?.status).toBe("pending");
        expect(await repository.cancelPendingByUser(created.id, branchId, "synthetic user cancellation")).toBe(true);
        expect((await repository.upsertPending(job)).status).toBe("canceled");
        expect(await repository.countRecentUndeliveredByBranch(branchId, now, until)).toBe(0);
    });
});
