import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { MessageExternalAgentCapabilitiesProvider } from "application/usecases/message/message-external-agent-capabilities.provider";
import { SERVICE_END_NOTICE_RULE_ID } from "domain/constants/service-end-notice-message";

// Real-PostgreSQL proof that agent-scheduled SMS can never leave a pending/processing job behind
// for a client whose automatic sending is off. Runs only when AGENT_SMS_PG_URL points at a
// THROWAWAY database whose schema was pushed with `prisma db push`; the suite creates and deletes
// its own rows (one branch per run).
const url = process.env["AGENT_SMS_PG_URL"];
const describePg = url ? describe : describe.skip;

// Lock waits are bounded at 1s in the code under test; the old code waited out a 15s transaction.
jest.setTimeout(60_000);

const OFF_MESSAGE = "이 고객은 자동 발송이 꺼져 있어 예약할 수 없습니다.";

describePg("agent SMS to a client whose automatic sending is off, on real PostgreSQL", () => {
    const slug = randomUUID();
    let branchId: string;
    let prisma: PrismaClient;
    let repository: SbMessageTriggerJobRepository;
    let provider: MessageExternalAgentCapabilitiesProvider;
    let phoneSeq = 0;

    const agentRuleId = () => `agent-sms:${branchId}`;
    const nextPhone = () => `0109${String(++phoneSeq).padStart(7, "0")}`;

    async function createClient(smsAutomationEnabled = true): Promise<{ id: number; phone: string }> {
        const phone = nextPhone();
        const client = await prisma.client.create({
            data: { name: `고객 ${phone}`, phone, phoneNormalized: phone, voucherClient: false, smsAutomationEnabled, branchId },
        });
        return { id: client.id, phone };
    }

    function enqueue(phone: string, actionId: string): Promise<{ id: string; clientId: number | null; dedupeKey: string }> {
        const context = { principal: { userId: "user-a", branchId, globalRole: "admin", branchRole: "admin" }, actionId };
        return (provider as unknown as {
            enqueueSms(ctx: unknown, input: unknown, scheduledFor: Date, ruleName: string): Promise<{ id: string; clientId: number | null; dedupeKey: string }>;
        }).enqueueSms(context, { receiver: phone, message: "안내", title: "AI 문자 예약" }, new Date(Date.now() + 3_600_000), "AI 예약 문자");
    }

    async function turnOff(clientId: number): Promise<void> {
        // The client service commits the flag first; the re-sync then cancels under the branch lock.
        await prisma.client.update({ where: { id: clientId }, data: { smsAutomationEnabled: false } });
        await repository.cancelAutomaticClientJobsForClient(branchId, clientId, "SMS automation disabled for client");
    }

    async function liveJobs(where: Prisma.message_trigger_jobWhereInput) {
        return prisma.message_trigger_job.findMany({
            where: { branchId, status: { in: ["pending", "processing"] }, ...where },
            select: { id: true, dedupeKey: true, clientId: true, status: true },
        });
    }

    async function insertJob(params: {
        ruleId: string; dedupeKey: string; clientId: number | null; phone: string; status?: string; branchScoped?: boolean;
    }): Promise<string> {
        const id = randomUUID();
        await prisma.$executeRaw`
            INSERT INTO "message_trigger_job"
                (id, branch_id, rule_id, status, scheduled_for, client_id, recipient_type, recipient_phone, template_key, dedupe_key, payload, claim_token, updated_at)
            VALUES (${id}, ${branchId}::uuid, ${params.ruleId}, ${params.status ?? "pending"}, now() + interval '1 hour', ${params.clientId},
                'CLIENT', ${params.phone}, 'INFO', ${params.dedupeKey}, ${JSON.stringify({ memberId: "m", recipientPhone: params.phone })}::jsonb,
                ${params.status === "processing" ? "token" : null}, now())`;
        return id;
    }

    async function statusOf(id: string): Promise<{ status: string; claimToken: string | null; cancelReason: string | null }> {
        return prisma.message_trigger_job.findUniqueOrThrow({ where: { id }, select: { status: true, claimToken: true, cancelReason: true } });
    }

    /** Holds `statement` (row locks / uncommitted inserts) in an open transaction until `release()`. */
    async function hold(statement: (tx: Prisma.TransactionClient) => Promise<void>): Promise<{ release: (commit?: boolean) => Promise<void> }> {
        let release!: (commit: boolean) => void;
        const gate = new Promise<boolean>((resolve) => { release = resolve; });
        let acquired!: () => void;
        const ready = new Promise<void>((resolve) => { acquired = resolve; });
        const finished = prisma.$transaction(async (tx) => {
            await statement(tx);
            acquired();
            if (!(await gate)) throw new Error("rollback requested");
        }, { timeout: 60_000 }).catch((error: Error) => {
            if (error.message !== "rollback requested") throw error;
        });
        await ready;
        return { release: async (commit = false) => { release(commit); await finished; } };
    }

    beforeAll(async () => {
        const separator = url!.includes("?") ? "&" : "?";
        prisma = new PrismaClient({ datasources: { db: { url: `${url}${separator}connection_limit=20` } } });
        const branch = await prisma.branch.create({ data: { name: `agent-sms-pg ${slug}`, slug } });
        branchId = branch.id;
        for (const id of [SERVICE_END_NOTICE_RULE_ID]) {
            await prisma.message_trigger_rule.upsert({
                where: { id },
                create: {
                    id, name: id, isActive: true, eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", recipientType: "CLIENT", templateKey: "INFO",
                },
                update: {},
            });
        }
        repository = new SbMessageTriggerJobRepository(prisma as unknown as PrismaService);
        provider = new MessageExternalAgentCapabilitiesProvider(
            prisma as unknown as PrismaService,
            {} as never,
            repository,
            {} as never,
            { ensureApproved: async () => undefined } as never,
        );
    });

    afterAll(async () => {
        await prisma.message_trigger_job.deleteMany({ where: { branchId } });
        await prisma.message_trigger_rule.deleteMany({ where: { OR: [{ branchId }, { id: SERVICE_END_NOTICE_RULE_ID }] } });
        await prisma.client.deleteMany({ where: { branchId } });
        await prisma.branch.delete({ where: { id: branchId } });
        await prisma.$disconnect();
    });

    it("queues an ON client's agent job under the client's id", async () => {
        const client = await createClient();

        const job = await enqueue(client.phone, `on-${randomUUID()}`);

        expect(job.clientId).toBe(client.id);
        expect(await liveJobs({ clientId: client.id })).toHaveLength(1);
    });

    it("refuses an OFF client and leaves no job behind", async () => {
        const client = await createClient(false);

        await expect(enqueue(client.phone, `off-${randomUUID()}`)).rejects.toMatchObject({ message: OFF_MESSAGE });

        expect(await liveJobs({ recipientPhone: client.phone })).toEqual([]);
    });

    describe("(i) a write that blocks past the guard cannot outlive an OFF commit", () => {
        it("rule row held by another transaction: the enqueue aborts as a whole while OFF + cancellation commit", async () => {
            const client = await createClient();
            // Make sure the synthetic rule row exists, then hold it FOR UPDATE (what blocked the old upsert).
            await enqueue((await createClient()).phone, `seed-${randomUUID()}`);
            const held = await hold(async (tx) => {
                await tx.$queryRaw`SELECT id FROM message_trigger_rule WHERE id = ${agentRuleId()} FOR UPDATE`;
            });
            const actionId = `blocked-rule-${randomUUID()}`;

            const attempt = enqueue(client.phone, actionId).then(() => "queued", (error: Error) => error.message);
            await turnOff(client.id);
            const outcome = await attempt;
            await held.release(true);

            expect(outcome).toContain("다시 시도");
            expect(await liveJobs({ dedupeKey: `agent-sms:${actionId}` })).toEqual([]);
            expect(await liveJobs({ clientId: client.id })).toEqual([]);
            expect(await liveJobs({ recipientPhone: client.phone })).toEqual([]);
        });

        it("job insert blocked behind an uncommitted row with the same dedupe key: aborts after the guard, nothing survives", async () => {
            const client = await createClient();
            const actionId = `blocked-insert-${randomUUID()}`;
            const dedupeKey = `agent-sms:${actionId}`;
            await enqueue((await createClient()).phone, `seed-${randomUUID()}`);
            // Another transaction has inserted (not committed) the very key this action writes.
            const held = await hold(async (tx) => {
                await tx.$executeRaw`
                    INSERT INTO "message_trigger_job"
                        (id, branch_id, rule_id, status, scheduled_for, recipient_type, recipient_phone, template_key, dedupe_key, payload, updated_at)
                    VALUES (${randomUUID()}, ${branchId}::uuid, ${agentRuleId()}, 'pending', now(), 'CLIENT', ${client.phone}, 'INFO', ${dedupeKey}, '{}'::jsonb, now())`;
            });

            const attempt = enqueue(client.phone, actionId).then(() => "queued", (error: Error) => error.message);
            // The guard's FOR SHARE is held while the insert waits, so OFF waits for the aborted transaction.
            await turnOff(client.id);
            const outcome = await attempt;
            await held.release(false);

            expect(outcome).toContain("다시 시도");
            expect(await liveJobs({ clientId: client.id })).toEqual([]);
            expect(await prisma.message_trigger_job.count({ where: { dedupeKey } })).toBe(0);
        });

        it("racing enqueues against OFF + cancellation always end with no live job for the client", async () => {
            for (let round = 0; round < 12; round += 1) {
                const client = await createClient();
                const delays = [0, 2, 5, 10, 20, 40];
                const enqueues = Array.from({ length: 3 }, (_, index) =>
                    new Promise<void>((resolve) => setTimeout(resolve, delays[(round + index * 2) % delays.length]))
                        .then(() => enqueue(client.phone, `race-${round}-${index}-${randomUUID()}`))
                        .then(() => "queued", (error: Error) => error.message));
                const off = new Promise<void>((resolve) => setTimeout(resolve, delays[round % delays.length])).then(() => turnOff(client.id));

                const outcomes = await Promise.all([...enqueues, off]);

                expect(outcomes.slice(0, 3).every((outcome) => outcome === "queued" || outcome === OFF_MESSAGE || String(outcome).includes("다시 시도"))).toBe(true);
                expect(await liveJobs({ clientId: client.id })).toEqual([]);
                expect(await liveJobs({ recipientPhone: client.phone })).toEqual([]);
            }
        });
    });

    describe("(ii) an agent job queued while the client was ON is cancelled when the client is turned OFF", () => {
        it("cancels the job written under the client's id", async () => {
            const client = await createClient();
            const job = await enqueue(client.phone, `then-off-${randomUUID()}`);
            expect(await statusOf(job.id)).toMatchObject({ status: "pending" });

            await turnOff(client.id);

            expect(await statusOf(job.id)).toEqual({
                status: "canceled", claimToken: null, cancelReason: "SMS automation disabled for client",
            });
        });

        it("cancels a processing agent job and clears its claim token, but not dispatching or sent ones", async () => {
            const client = await createClient();
            const processing = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: client.id, phone: client.phone, status: "processing" });
            const dispatching = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: client.id, phone: client.phone, status: "dispatching" });
            const sent = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: client.id, phone: client.phone, status: "sent" });
            const retry = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms-retry:${randomUUID()}`, clientId: client.id, phone: client.phone });

            await turnOff(client.id);

            expect(await statusOf(processing)).toMatchObject({ status: "canceled", claimToken: null });
            expect(await statusOf(retry)).toMatchObject({ status: "canceled" });
            expect((await statusOf(dispatching)).status).toBe("dispatching");
            expect((await statusOf(sent)).status).toBe("sent");
        });

        it("cancels a legacy agent job with no client id by the client's phone, and leaves other clients' jobs", async () => {
            const client = await createClient();
            const other = await createClient();
            const legacy = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: null, phone: client.phone });
            const legacyHyphenated = await insertJob({
                ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: null,
                phone: `${client.phone.slice(0, 3)}-${client.phone.slice(3, 7)}-${client.phone.slice(7)}`,
            });
            const otherLegacy = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: null, phone: other.phone });
            const otherOwned = await insertJob({ ruleId: agentRuleId(), dedupeKey: `agent-sms:${randomUUID()}`, clientId: other.id, phone: other.phone });

            await turnOff(client.id);

            expect((await statusOf(legacy)).status).toBe("canceled");
            expect((await statusOf(legacyHyphenated)).status).toBe("canceled");
            expect((await statusOf(otherLegacy)).status).toBe("pending");
            expect((await statusOf(otherOwned)).status).toBe("pending");
        });
    });

    describe("(iii) admin-manual jobs for the same client", () => {
        it("are left untouched while the client's agent job and ordinary rule job are cancelled", async () => {
            const client = await createClient();
            const manual = await insertJob({
                ruleId: SERVICE_END_NOTICE_RULE_ID,
                dedupeKey: `${SERVICE_END_NOTICE_RULE_ID}:client:${client.id}:manual:${randomUUID()}`,
                clientId: client.id,
                phone: client.phone,
            });
            const ordinaryRule = await prisma.message_trigger_rule.create({
                data: { name: "일반 규칙", branchId, isActive: true, eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", recipientType: "CLIENT", templateKey: "INFO" },
            });
            const ordinary = await insertJob({ ruleId: ordinaryRule.id, dedupeKey: `${ordinaryRule.id}:client:${client.id}`, clientId: client.id, phone: client.phone });
            const agent = await enqueue(client.phone, `mixed-${randomUUID()}`);

            await turnOff(client.id);

            expect((await statusOf(manual)).status).toBe("pending");
            expect((await statusOf(ordinary)).status).toBe("canceled");
            expect((await statusOf(agent.id)).status).toBe("canceled");
        });
    });
});
