import { AligoService } from "application/services/aligo.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { createBranch, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { RowTracker } from "../helpers/tracker";
import { invariant } from "../helpers/known-defect";
import { deleteAreaRowsByBranch, waitUntilBlocked, wireSmsProviderAcceptanceService } from "./sms-wiring.local";

/**
 * SI-SMS-03 — duplicate-send prevention under two dispatchers.
 *
 * Two scheduler ticks (or two processes) reaching the same pending job must
 * produce exactly one provider call and one message_log. The fence has two
 * halves, both audited here with forced interleaving (a row lock held on a
 * second connection and `pg_stat_activity` wait evidence, never two blind
 * promises):
 *
 * 1. The claim: `claimPendingWithRuleFence` is one UPDATE gated on
 *    `status = 'pending'` + a rule lock; a second claim must find nothing.
 * 2. The provider acceptance boundary: the durable attempt row is keyed by
 *    `providerAcceptanceKey = sms:digest({scope:"automation", identity:
 *    "branchId:jobId"})` with a UNIQUE constraint; a duplicate dispatch
 *    converges on the started row and must refuse to cross the provider
 *    boundary again ("already in progress or requires reconciliation").
 */
describeReal("SMS duplicate dispatch prevention (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let jobRepository: SbMessageTriggerJobRepository;
    let branchId: string;
    let ruleId: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        jobRepository = new SbMessageTriggerJobRepository(handle.service);
    });

    afterAll(async () => {
        if (tracker) {
            if (branchId) await deleteAreaRowsByBranch(handle.raw, [branchId]);
            await tracker.cleanup(handle.raw);
        }
        if (handle) await closeIntegrityPrisma(handle);
    });

    async function seedPendingJob(): Promise<{ jobId: string; claimToken: string | null }> {
        if (!branchId) {
            const branchRow = await createBranch(handle.raw, tracker);
            branchId = branchRow.id;
            const ruleRow = await createMessageTriggerRule(handle.raw, tracker, { branchId });
            ruleId = ruleRow.id;
        }
        const job = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            dedupeKey: `si-03-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: "pending",
            scheduledFor: new Date(Date.now() - 60 * 1000),
        });
        return { jobId: job.id, claimToken: job.claimToken };
    }

    function toLiveEntity(row: Awaited<ReturnType<typeof createMessageTriggerJob>>): MessageTriggerJobEntity {
        return MessageTriggerJobEntity.reconstitute(
            row.id, row.branchId, row.ruleId, row.status as MessageTriggerJobEntity["status"],
            row.scheduledFor, row.sentAt, row.canceledAt, row.cancelReason,
            row.clientId, row.employeeScheduleId,
            row.recipientType as MessageTriggerRecipientType, row.recipientPhone,
            row.templateKey as MessageTriggerTemplateKey, row.dedupeKey,
            row.payload as unknown as MessageTriggerJobEntity["payload"],
            row.createdAt, row.updatedAt, row.attempts, row.nextAttemptAt, row.claimToken,
        );
    }

    function payloadMessageJob(row: Awaited<ReturnType<typeof createMessageTriggerJob>>): MessageTriggerJobEntity {
        const entity = toLiveEntity(row);
        entity.payload = {
            ...entity.payload,
            memberId: "si-03-member",
            recipientName: "무결성 수신자",
            recipientPhone: "01000000001",
            templateVariables: { triggerType: "agent_scheduled", retrySafety: "" },
            messageBody: "SI-SMS-03 duplicate dispatch probe",
        };
        return entity;
    }

    invariant("SI-SMS-03", "a claimed job cannot be re-claimed by a second dispatcher (row-lock serialization)", async () => {
        const { jobId } = await seedPendingJob();

        // Dispatcher A wins the job row lock (its claim's UPDATE would take it).
        const lock = await handle.raw.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "message_trigger_job" WHERE id = ${jobId} FOR UPDATE`;
            // Dispatcher B's claim is now queued behind this lock; prove the wait
            // from the database's own view before deciding the race.
            const claimB = jobRepository.claimPendingWithRuleFence(jobId, branchId);
            await waitUntilBlocked(handle.raw, /candidate_job AS MATERIALIZED/);
            // A commits a state the claim predicate no longer matches.
            await tx.$executeRaw`UPDATE "message_trigger_job" SET status = 'sent', sent_at = now() WHERE id = ${jobId}`;
            return { claimB, txDone: true };
        });
        const claimBToken = await lock.claimB;

        if (claimBToken !== null) {
            throw new Error(`second dispatcher claimed a sent job: claimToken=${claimBToken}`);
        }
        const winners = await handle.raw.message_trigger_job.findMany({ where: { id: jobId, status: "sent" } });
        if (winners.length !== 1) throw new Error("sent job row vanished after the race");
    });

    invariant("SI-SMS-03", "two queued claims of one pending job yield exactly one claim token", async () => {
        const { jobId } = await seedPendingJob();

        // Hold the row lock, queue BOTH claims behind it, prove both wait, then
        // release without changing the row: both UPDATEs then run for real,
        // serialized by the row lock. Exactly one may flip pending -> processing.
        const bothClaims: Array<Promise<string | null>> = [];
        await handle.raw.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "message_trigger_job" WHERE id = ${jobId} FOR UPDATE`;
            bothClaims.push(jobRepository.claimPendingWithRuleFence(jobId, branchId));
            bothClaims.push(jobRepository.claimPendingWithRuleFence(jobId, branchId));
            await waitUntilBlocked(handle.raw, /candidate_job AS MATERIALIZED/);
        }, { timeout: 30_000 });
        const tokens = await Promise.all(bothClaims);
        const winners = tokens.filter((token) => token !== null);

        if (winners.length !== 1) {
            throw new Error(`expected exactly one claim token, got ${winners.length} of ${tokens.length}`);
        }
        const row = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: jobId } });
        if (row.status !== "processing" || row.claimToken !== winners[0]) {
            throw new Error(`claim winner not persisted: status=${row.status} token match=${row.claimToken === winners[0]}`);
        }
    });

    invariant("SI-SMS-03", "a duplicate dispatch converges on the started attempt and never calls the provider twice", async () => {
        const created = await createMessageTriggerJob(handle.raw, tracker, { ruleId }, {
            branchId,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: `si-03-conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: "dispatching",
            claimToken: `si-03-dispatch-${Date.now()}`,
            scheduledFor: new Date(Date.now() - 60 * 1000),
        });
        const jobA = payloadMessageJob(created);
        const jobB = payloadMessageJob(created);

        let releaseFirstSend: ((result: unknown) => void) | undefined;
        const firstSendResult = new Promise((resolve) => { releaseFirstSend = resolve; });
        const sendSms = jest.fn().mockImplementationOnce(() => firstSendResult).mockImplementation(async () => {
            throw new Error("provider must never be called a second time");
        });
        const aligoMock = { sendSms } as unknown as AligoService;
        const logRepository = new SbMessageLogRepository(handle.service);
        const acceptanceService = wireSmsProviderAcceptanceService(handle);
        const delivery = new SmsTriggerDeliveryService(
            aligoMock,
            { getByKeyForBranch: async () => { throw new Error("system templates are not wired in this spec"); } } as unknown as ConstructorParameters<typeof SmsTriggerDeliveryService>[1],
            logRepository,
            acceptanceService,
            undefined,
            // A gate stub that permits: this audit targets the acceptance-boundary
            // fence, not the agent gate refusing the job before it starts.
            { permitsDirectManualJob: async () => true } as unknown as ConstructorParameters<typeof SmsTriggerDeliveryService>[5],
            new SbMessageTriggerRuleRepository(handle.service),
        );

        // Dispatcher A: crosses the provider boundary and hangs inside the
        // provider call (the crash/in-flight window).
        let failureOfA: unknown;
        const dispatchA = delivery.sendJob(jobA).catch((error) => {
            failureOfA = error;
            return null;
        });
        let attemptRow: { providerAcceptanceState: string; id: number } | null | undefined;
        for (let waited = 0; waited < 400; waited += 1) {
            attemptRow = await handle.raw.message_log.findFirst({
                where: { triggerJobId: created.id },
                select: { providerAcceptanceState: true, id: true },
            });
            if (attemptRow?.providerAcceptanceState === "started") break;
            if (failureOfA !== undefined) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const waitMs = 400 * 20;
        if (attemptRow?.providerAcceptanceState !== "started") {
            throw new Error(
                `dispatcher A never started the attempt after ${waitMs}ms: ${attemptRow?.providerAcceptanceState ?? "no row"}; error=${failureOfA instanceof Error ? failureOfA.stack : String(failureOfA)}`,
            );
        }

        // Dispatcher B (second tick, same job id): must converge on the started
        // attempt row and refuse a second provider crossing.
        await expect(delivery.sendJob(jobB)).rejects.toThrow(
            /SMS provider attempt is already in progress or requires reconciliation/,
        );
        if (sendSms.mock.calls.length !== 1) {
            throw new Error(`provider called ${sendSms.mock.calls.length} times before A finished`);
        }

        releaseFirstSend?.({
            request: { receiver: "01000000001" },
            response: { result_code: 1, message: "정상 접수", success_cnt: 1, error_cnt: 0, msg_id: "si-03-mid-1", msgType: "SMS" },
        });
        const sentA = await dispatchA;
        if (sentA !== true) throw new Error("dispatcher A did not report a successful send");

        const attemptRows = await handle.raw.message_log.findMany({ where: { triggerJobId: created.id } });
        if (attemptRows.length !== 1) {
            throw new Error(`expected exactly one message_log for the job, found ${attemptRows.length}`);
        }
        if (attemptRows[0]!.providerAcceptanceState !== "accepted" || attemptRows[0]!.status !== "sent") {
            throw new Error(`attempt row not accepted: state=${attemptRows[0]!.providerAcceptanceState} status=${attemptRows[0]!.status}`);
        }
        expect(sendSms).toHaveBeenCalledTimes(1);
    });
});
