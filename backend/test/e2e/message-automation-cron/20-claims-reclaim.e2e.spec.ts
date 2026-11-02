import { Prisma } from "@prisma/client";

import {
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { ALIGO_SMS_API_PORT } from "domain/ports/aligo-sms-api.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ScriptedAligoStub } from "../helpers/scripted-aligo.stub";
import {
    MESSAGE_CRON_BRANCH_ID,
    type MessageCronHarness,
    bootMessageCronHarness,
} from "../helpers/message-automation-cron.helper";

/**
 * Claim concurrency + stale reclaim E2E — real DB, real trigger/dispatch
 * slices, vendor stubs.
 *
 * WHAT: the dispatch tick's claim CAS invariants.
 *   1. Two harnesses in ONE process (each with its own ScriptedAligoStub and
 *      therefore no shared in-process guard) racing on the same due job must
 *      produce exactly one provider send and exactly one message_log.
 *   2. A stale `processing` row (updatedAt < now-10min) is reclaimed as a
 *      transient defer: attempts+1, back to pending, nextAttemptAt ~now+5min,
 *      and NOT sent in the same tick.
 *   3. A stale `dispatching` row (crossed the irreversible provider
 *      authorization boundary) is terminally failed with the uncertain
 *      acceptance reason and is NEVER re-sent by later ticks.
 *   4. A stale `processing` row that still carries a non-null cancel reason
 *      (a manual-resend claim, BJJ-444) returns to needs_setup with the
 *      reason and attempts untouched.
 *   5. A pending job whose client row disappeared (client deleted →
 *      message_trigger_job.client_id set to NULL by the FK) is canceled by
 *      cancelOrphanedPending with the orphan reason, no provider call.
 *   6. A reclaimed stale row at the attempt cap is failed terminally by the
 *      entity's defer() (domain/entities/message-trigger-job.entity.ts
 *      defer: attempts+=1 then attempts>=TRIGGER_JOB_MAX_ATTEMPTS →
 *      markFailed with the reclaim reason) — the exact cap behavior asserted
 *      below is the one the entity contract defines.
 *
 * All assertions are on Postgres rows via prisma; the stubs only count calls.
 *
 * HOW: rows are created directly with prisma mirroring
 * application/services/message-trigger-recipes.ts's buildClientMessageRecipe
 * payload (clientId/clientName/memberId/recipientName/recipientPhone/
 * templateVariables) for the seeded SERVICE_INFO system template
 * (test/e2e-env/seed-e2e.ts `tpl-service`). No production code is touched.
 */
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;

const BRANCH_ID = MESSAGE_CRON_BRANCH_ID;
/** Unique per run tag (other specs share this DB in the same --runInBand run). */
const RUN = `${Date.now()}`.slice(-7);

/** application/services/message-trigger.service.ts:537 (not exported). */
const SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON =
    "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";
/** application/services/message-trigger.service.ts:159 (not exported). */
const ORPHANED_TRIGGER_JOB_CANCEL_REASON = "Related client or schedule deleted";
/** application/services/message-trigger.service.ts:4599 defer("transient", …) reclaim reason. */
const RECLAIM_DEFER_REASON = "Reclaimed stale processing job";
/** application/services/message-trigger.service.ts:4565 (TRIGGER_JOB_PROCESSING_RECLAIM_MS). */
const STALE_UPDATE_DELAY_MINUTES = 11;

jest.setTimeout(180_000);

describeE2E("message-automation cron claim concurrency + stale reclaim (real DB)", () => {
    let harnessA: MessageCronHarness;
    let harnessB: MessageCronHarness;
    let stubA: ScriptedAligoStub;
    let stubB: ScriptedAligoStub;
    let prisma: PrismaService;

    let ruleId: string;
    let senderClientId: number | undefined;
    let senderName: string;
    let senderPhone: string;
    let orphanClientId: number | undefined;

    /** Jobs created by this spec (cleanup). */
    const createdJobIds: string[] = [];

    beforeAll(async () => {
        stubA = new ScriptedAligoStub();
        harnessA = await bootMessageCronHarness({ aligo: stubA });
        stubB = new ScriptedAligoStub();
        harnessB = await bootMessageCronHarness({ aligo: stubB });
        prisma = harnessA.prisma;

        // The runner pins SCHEDULER_LEASE_MODE=off, so neither harness can
        // lose the lease to the other; serialization must come from the DB.
        expect(harnessA.lease.holdsLease()).toBe(true);
        expect(harnessB.lease.holdsLease()).toBe(true);
        // The ALIGO_SMS_API_PORT override identity must hold for BOTH harnesses
        // (same assertion the 00-harness-smoke spec makes for one).
        expect(harnessA.app.get(ALIGO_SMS_API_PORT, { strict: false })).toBe(stubA);
        expect(harnessB.app.get(ALIGO_SMS_API_PORT, { strict: false })).toBe(stubB);

        const branch = await prisma.branch.findUnique({
            where: { id: BRANCH_ID },
            select: { smsSenderApprovalStatus: true },
        });
        expect(branch?.smsSenderApprovalStatus).toBe("approved");

        // An ACTIVE branch rule for the FK + safeguard/claim rule fence. jobsStale
        // stays false so processStaleRuleRebuilds never rewrites jobs for it.
        ruleId = `e2e:claims-reclaim:${RUN}`;
        await prisma.message_trigger_rule.create({
            data: {
                id: ruleId,
                branchId: BRANCH_ID,
                name: `claims-reclaim ${RUN}`,
                isActive: true,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
                offsetDays: 7,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                jobsStale: false,
            },
        });

        // Receiver client (created over the real HTTP API): automatic rule sync is
        // suppressed (applyMessageAutomation:false → no rule jobs), the per-client
        // safeguard switch is on, and the row is alive for checkRecipient().
        senderName = `재청구테스트${RUN}`;
        senderPhone = `0109${RUN}`;
        const created = await harnessA.http().post("/clients").send({
            name: senderName,
            phone: `010-9${RUN.slice(0, 3)}-${RUN.slice(3)}`,
            voucherClient: false,
            breastPump: false,
            smsAutomationEnabled: true,
            applyMessageAutomation: false,
            suppressGreetingSms: true,
        });
        expect(created.status).toBe(201);
        senderClientId = created.body.id as number;

        // Gate: no leftover automation rows for this client, otherwise the
        // send-count assertions below would be measuring untracked noise.
        const syncJobs = await prisma.message_trigger_job.findMany({
            where: { clientId: senderClientId, ruleId: { not: "system:message_automation_intent" } },
            select: { id: true },
        });
        expect(syncJobs).toEqual([]);

        orphanClientId = (await prisma.client.create({
            data: {
                name: `고아테스트${RUN}`,
                phone: `0108${RUN}`,
                phoneNormalized: `0108${RUN}`,
                voucherClient: false,
                branchId: BRANCH_ID,
            },
        })).id;
    });

    afterAll(async () => {
        if (harnessA) {
            // FK-safe order: logs (trigger_job_id/client SetNull) → jobs → rule → clients.
            await prisma.message_log.deleteMany({ where: { triggerJobId: { in: [...createdJobIds] } } }).catch(() => undefined);
            await prisma.message_log.deleteMany({ where: { clientId: { in: [senderClientId, orphanClientId].filter((id): id is number => id !== undefined) } } }).catch(() => undefined);
            await prisma.message_trigger_job.deleteMany({ where: { id: { in: [...createdJobIds] } } }).catch(() => undefined);
            await prisma.message_trigger_job.deleteMany({ where: { clientId: { in: [senderClientId, orphanClientId].filter((id): id is number => id !== undefined) } } }).catch(() => undefined);
            if (ruleId) {
                await prisma.message_trigger_rule.deleteMany({ where: { id: ruleId } }).catch(() => undefined);
            }
            await prisma.client.deleteMany({ where: { id: { in: [orphanClientId].filter((id): id is number => id !== undefined) } } }).catch(() => undefined);
        }
        await harnessB?.close();
        await harnessA?.close();
    });

    async function createDueJob(overrides: Partial<Prisma.message_trigger_jobUncheckedCreateInput> = {}) {
        if (senderClientId === undefined) throw new Error("sender client fixture missing");
        const job = await harnessA.prisma.message_trigger_job.create({
            data: {
                branchId: BRANCH_ID,
                ruleId,
                status: "pending",
                scheduledFor: new Date(Date.now() - 60_000),
                attempts: 0,
                clientId: senderClientId,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone: senderPhone,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupeKey: `e2e:claims-reclaim:${RUN}:${createdJobIds.length}:${Date.now()}`,
                payload: {
                    clientId: senderClientId,
                    clientName: senderName,
                    memberId: String(senderClientId),
                    recipientName: senderName,
                    recipientPhone: senderPhone,
                    templateVariables: { name: senderName, clientName: senderName, phone: senderPhone },
                } as unknown as Prisma.InputJsonValue,
                ...overrides,
            },
        });
        createdJobIds.push(job.id);
        return job;
    }

    /** Force `updatedAt` into the stale past (@updatedAt ignores the client lib; raw SQL does not). */
    async function makeStale(jobId: string, minutesAgo = STALE_UPDATE_DELAY_MINUTES): Promise<void> {
        await harnessA.prisma.$executeRaw`
            UPDATE "message_trigger_job"
            SET "updated_at" = ${new Date(Date.now() - minutesAgo * 60_000)}
            WHERE "id" = ${jobId}`;
    }

    const digits = (value: string): string => value.replace(/\D/g, "");
    const jobRow = (jobId: string) =>
        prisma.message_trigger_job.findUnique({ where: { id: jobId } });
    const logsForJob = (jobId: string) =>
        prisma.message_log.findMany({ where: { triggerJobId: jobId } });

    // ---------------------------------------------------------------------
    // 1. Two racing dispatchers: exactly one claim, one send, one log.
    // ---------------------------------------------------------------------
    it("1. five dispatch races on separate due jobs send each job exactly once across both harnesses", async () => {
        const doubleSentIterations: Array<{ iteration: number; stubACalls: number; stubBCalls: number; logCount: number }> = [];
        const attemptsPerIteration: Array<{ stubACalls: number; stubBCalls: number; logCount: number }> = [];

        for (let iteration = 0; iteration < 5; iteration += 1) {
            const job = await createDueJob();
            stubA.reset();
            stubB.reset();

            await Promise.all([harnessA.tick.dispatch(), harnessB.tick.dispatch()]);

            const callsA = stubA.sendCalls.length;
            const callsB = stubB.sendCalls.length;
            const logs = await logsForJob(job.id);
            const row = await jobRow(job.id);

            attemptsPerIteration.push({ stubACalls: callsA, stubBCalls: callsB, logCount: logs.length });

            const doubleSent = callsA + callsB !== 1 || logs.length !== 1;
            if (doubleSent) {
                doubleSentIterations.push({ iteration, stubACalls: callsA, stubBCalls: callsB, logCount: logs.length });
                continue; // keep asserting the invariant rows even on a defect iteration
            }

            const sentTo = callsA > 0 ? stubA.sendCalls[0]! : stubB.sendCalls[0]!;
            expect(digits(sentTo.receiver)).toBe(digits(senderPhone));
            expect(row?.status).toBe("sent");
            expect(row?.claimToken).not.toBeNull();
            expect(row?.claimToken).not.toBe("");
            expect(row?.sentAt).not.toBeNull();
            expect(logs.length).toBe(1);
            expect(logs[0]?.status).toBe("sent");
            expect(logs[0]?.providerAcceptanceState).toBe("accepted");
            expect(logs[0]?.attempts).toBe(1);
        }

        // Every iteration must have sent exactly once. If any iteration
        // double-sent or double-logged, that is a REAL claim defect — it is
        // only ever documented, never patched, by this spec.
        expect(doubleSentIterations).toEqual([]);
        expect(attemptsPerIteration).toHaveLength(5);
    });

    // ---------------------------------------------------------------------
    // 2. Stale `processing` → transient defer, never sent in the same tick.
    // ---------------------------------------------------------------------
    it("2. a stale processing row defers (attempts+1, pending, nextAttemptAt ~now+5min) and sends on the next due tick", async () => {
        const job = await createDueJob({
            status: "processing",
            claimToken: `e2e-stale-processing:${RUN}`,
        });
        await makeStale(job.id);
        expect((await jobRow(job.id))?.status).toBe("processing");

        const beforeTick = Date.now();
        const stubCallsBefore = stubA.sendCalls.length;
        await harnessA.tick.dispatch();

        const row = await jobRow(job.id);
        expect(row).not.toBeNull();
        // Between the tick reads the row cannot disappear; narrow once for TS.
        const deferredRow = row as NonNullable<typeof row>;
        // Reclaim decision: processing + no cancel reason → defer("transient").
        expect(deferredRow.status).toBe("pending");
        expect(deferredRow.attempts).toBe(1); // 0 + 1
        expect(deferredRow.nextAttemptAt).not.toBeNull();
        expect(deferredRow.claimToken).not.toBeNull();
        expect(deferredRow.cancelReason).toBeNull();
        const nextAttemptAtMs = deferredRow.nextAttemptAt?.getTime() ?? 0;
        const delayMs = nextAttemptAtMs - beforeTick;
        expect(delayMs).toBeGreaterThan(TRIGGER_JOB_RETRY_DELAY_MS - 60_000); // ≥ +4min
        expect(delayMs).toBeLessThanOrEqual(TRIGGER_JOB_RETRY_DELAY_MS + 60_000); // ≤ +6min
        // Not sent in the same tick: nextAttemptAt is in the future.
        expect(nextAttemptAtMs > beforeTick).toBe(true);
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(0);
        expect(await logsForJob(job.id)).toEqual([]);

        // Backdate → the deferred job is due again and dispatches exactly once.
        await harnessA.backdate(job.id, new Date(Date.now() - 60_000));
        await harnessA.tick.dispatch();
        const sentRow = await jobRow(job.id);
        expect(sentRow?.status).toBe("sent");
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(1);
        expect(digits(stubA.sendCalls.at(-1)!.receiver)).toBe(digits(senderPhone));
        expect((await logsForJob(job.id)).length).toBe(1);
    });

    // ---------------------------------------------------------------------
    // 3. Stale `dispatching` → terminal failed, never re-sent.
    // ---------------------------------------------------------------------
    it("3. a stale dispatching row fails terminally with the uncertain-acceptance reason and later ticks never re-send", async () => {
        const job = await createDueJob({
            status: "dispatching",
            claimToken: `e2e-stale-dispatching:${RUN}`,
        });
        await makeStale(job.id);

        const stubCallsBefore = stubA.sendCalls.length;
        const stubBCallsBefore = stubB.sendCalls.length;
        await harnessA.tick.dispatch();
        const row = await jobRow(job.id);
        expect(row?.status).toBe("failed");
        expect(row?.cancelReason).toBe(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
        // The claim token survives as the CAS fence; the row is simply terminal.
        expect(row?.claimToken).toBe(`e2e-stale-dispatching:${RUN}`);

        // Time passes; later ticks must never touch the row again.
        for (let extra = 0; extra < 3; extra += 1) {
            await harnessA.backdate(job.id, new Date(Date.now() - 60_000));
            await harnessA.tick.dispatch();
        }
        const finalRow = await jobRow(job.id);
        expect(finalRow?.status).toBe("failed");
        expect(finalRow?.cancelReason).toBe(SMS_PROVIDER_ACCEPTANCE_UNCERTAIN_REASON);
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(0);
        expect(stubB.sendCalls.length - stubBCallsBefore).toBe(0);
        expect(await logsForJob(job.id)).toEqual([]);
    });

    // ---------------------------------------------------------------------
    // 4. Stale processing with a resend (non-null cancel) reason → needs_setup.
    // ---------------------------------------------------------------------
    it("4. a stale processing row carrying a manual-resend cancel reason returns to needs_setup with attempts untouched", async () => {
        const job = await createDueJob({
            status: "processing",
            claimToken: `e2e-stale-resend:${RUN}`,
            cancelReason: "수동 재전송 남음 (e2e)",
            nextAttemptAt: new Date(Date.now() - 60_000),
        });
        await makeStale(job.id);
        const stubCallsBefore = stubA.sendCalls.length;

        await harnessA.tick.dispatch();

        const row = await jobRow(job.id);
        // markNeedsSetup keeps the reason (BJJ-444) and does not touch attempts.
        expect(row?.status).toBe("needs_setup");
        expect(row?.cancelReason).toBe("수동 재전송 남음 (e2e)");
        expect(row?.attempts).toBe(0);
        expect(row?.nextAttemptAt).toBeNull();
        expect(row?.claimToken).toBe(`e2e-stale-resend:${RUN}`);

        // The re-setup row is never automatically re-sent.
        await harnessA.backdate(job.id, new Date(Date.now() - 60_000));
        await harnessA.tick.dispatch();
        expect((await jobRow(job.id))?.status).toBe("needs_setup");
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(0);
        expect(await logsForJob(job.id)).toEqual([]);
    });

    // ---------------------------------------------------------------------
    // 5. Orphaned pending job (client deleted) → canceled, no provider call.
    // ---------------------------------------------------------------------
    it("5. a pending job whose client row is deleted is canceled as an orphaned job with no provider call", async () => {
        if (orphanClientId === undefined) throw new Error("orphan client fixture missing");
        const job = await createDueJob({ clientId: orphanClientId });
        // cancelOrphanedPending keys on client_id = NULL (and employee_schedule_id
        // = NULL) — deleting the client row makes the FK set the job's client_id NULL.
        expect((await jobRow(job.id))?.clientId).toBe(orphanClientId);
        await harnessA.prisma.client.delete({ where: { id: orphanClientId } });
        const orphanedRow = await jobRow(job.id);
        expect(orphanedRow?.clientId).toBeNull();
        expect(orphanedRow?.status).toBe("pending");
        const stubCallsBefore = stubA.sendCalls.length;

        await harnessA.tick.dispatch();

        const row = await jobRow(job.id);
        expect(row?.status).toBe("canceled");
        expect(row?.cancelReason).toBe(ORPHANED_TRIGGER_JOB_CANCEL_REASON);
        expect(row?.canceledAt).not.toBeNull();
        expect(row?.claimToken).toBeNull();
        // Cleanup bookkeeping: the client removal must not have orphaned any log.
        await prisma.message_log.deleteMany({ where: { triggerJobId: job.id } }).catch(() => undefined);
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(0);
        expect(await logsForJob(job.id)).toEqual([]);
    });

    // ---------------------------------------------------------------------
    // 6. Stale processing at the attempt cap → defer fails it terminally.
    // ---------------------------------------------------------------------
    it("6. defer of a stale row at the attempt cap fails it terminally with the reclaim reason", async () => {
        const job = await createDueJob({
            status: "processing",
            claimToken: `e2e-stale-cap:${RUN}`,
            attempts: TRIGGER_JOB_MAX_ATTEMPTS - 1, // 2 of 3
        });
        await makeStale(job.id);
        const stubCallsBefore = stubA.sendCalls.length;

        await harnessA.tick.dispatch();

        // Entity contract (domain/entities/message-trigger-job.entity.ts defer):
        // attempts becomes MAX_ATTEMPTS (3), which is >= the cap, so whatever the
        // reclaim outcome, defer itself consumes the final attempt → markFailed.
        const row = await jobRow(job.id);
        expect(row?.attempts).toBe(TRIGGER_JOB_MAX_ATTEMPTS);
        expect(row?.status).toBe("failed");
        expect(row?.cancelReason).toBe(RECLAIM_DEFER_REASON);
        expect(stubA.sendCalls.length - stubCallsBefore).toBe(0);
        expect(await logsForJob(job.id)).toEqual([]);
    });
});
