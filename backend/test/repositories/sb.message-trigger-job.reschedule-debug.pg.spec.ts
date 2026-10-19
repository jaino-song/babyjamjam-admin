import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

// Real-PostgreSQL proof for rescheduleDebugPending. Runs only when
// RESCHEDULE_PG_URL points at a THROWAWAY database whose schema was pushed with
// `prisma db push`; the suite creates and deletes its own rows.
const url = process.env["RESCHEDULE_PG_URL"];
const describePg = url ? describe : describe.skip;

describePg("rescheduleDebugPending on real PostgreSQL", () => {
    const branchId = randomUUID();
    const farFuture = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
    const target = () => new Date(Date.now() + 48 * 60 * 60 * 1000);
    let prisma: PrismaClient;
    let repository: SbMessageTriggerJobRepository;
    const created: string[] = [];

    async function insert(overrides: { ruleId?: string; dedupeKey?: string; payload?: unknown; status?: string; scheduledFor?: Date }): Promise<string> {
        const id = randomUUID();
        // The throwaway DB has no branch/rule rows; skip FK triggers for the insert only.
        await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
            await tx.$executeRaw`
                INSERT INTO "message_trigger_job"
                    (id, branch_id, rule_id, status, scheduled_for, recipient_type, template_key, dedupe_key, payload, updated_at)
                VALUES (${id}, ${branchId}::uuid, ${overrides.ruleId ?? "rule-ordinary"}, ${overrides.status ?? "pending"},
                    ${overrides.scheduledFor ?? farFuture()}::timestamptz, 'CLIENT', 'CLIENT_GREETING',
                    ${overrides.dedupeKey ?? `dedupe-${id}`}, ${JSON.stringify(overrides.payload ?? { memberId: "m" })}::jsonb, now())`;
        });
        created.push(id);
        return id;
    }

    async function scheduledFor(id: string): Promise<number> {
        const row = await prisma.message_trigger_job.findUniqueOrThrow({ where: { id } });
        return row.scheduledFor.getTime();
    }

    beforeAll(() => {
        prisma = new PrismaClient({ datasources: { db: { url } } });
        repository = new SbMessageTriggerJobRepository(prisma as unknown as PrismaService);
    });

    afterAll(async () => {
        if (created.length > 0) await prisma.message_trigger_job.deleteMany({ where: { id: { in: created } } });
        await prisma.$disconnect();
    });

    it("moves an ordinary pending job", async () => {
        const id = await insert({});
        const to = target();
        await expect(repository.rescheduleDebugPending(id, branchId, to)).resolves.toBe(true);
        expect(await scheduledFor(id)).toBe(to.getTime());
    });

    it.each([
        ["a sealed agent-automation job", { payload: { memberId: "m", agentAutomationSeal: { digest: "x" } } }],
        ["a job with a null seal key", { payload: { memberId: "m", agentAutomationSeal: null } }],
        ["a manual agent-sms job (rule prefix)", { ruleId: "agent-sms:abc" }],
        ["a manual agent-sms retry job (dedupe prefix)", { dedupeKey: "agent-sms-retry:abc" }],
    ])("leaves %s untouched and reports false", async (_label, overrides) => {
        const id = await insert(overrides);
        const before = await scheduledFor(id);
        await expect(repository.rescheduleDebugPending(id, branchId, target())).resolves.toBe(false);
        expect(await scheduledFor(id)).toBe(before);
    });
});
