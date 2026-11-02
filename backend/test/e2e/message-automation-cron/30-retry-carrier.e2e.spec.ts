import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { Prisma } from "@prisma/client";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    ScriptedAligoStub,
    SCRIPTED_ALIGO_CARRIER_FAIL_STATE,
    SCRIPTED_ALIGO_REJECT_RESULT_CODE,
    SCRIPTED_ALIGO_THROW_MESSAGE,
} from "../helpers/scripted-aligo.stub";
import {
    MESSAGE_CRON_BRANCH_ID,
    MESSAGE_CRON_OWNER_USER_ID,
    type MessageCronHarness,
    bootMessageCronHarness,
} from "../helpers/message-automation-cron.helper";

/**
 * Retry cron + carrier check e2e (task 2.3): drives the real @Cron wrappers —
 * MessageTriggerSchedulerService.dispatchDueJobs (tick.dispatch),
 * MessageRetrySchedulerService (tick.retry), SmsCarrierCheckService
 * (tick.carrier) — against the seeded disposable DB and the ScriptedAligoStub,
 * and asserts on Postgres rows plus the stub's recorded provider calls.
 *
 * Superseded-reason literals below mirror the unexported constants in
 * application/services/message-retry-scheduler.service.ts (line numbers cited
 * next to each) so a silent copy change fails the spec loudly.
 */
const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const RUN = `${Date.now()}`.slice(-7);

// message-retry-scheduler.service.ts:19-20 (same text as
// SMS_UNCERTAIN_RECONCILIATION_MESSAGE in domain/entities/message-log.entity.ts:53-54).
const UNCERTAIN_RETRY_SUPERSEDED_REASON
    = "문자 발송 결과가 불확실하여 자동 재전송을 중단했습니다. 제공자 이력 확인 후 수동 확인이 필요합니다.";
// message-retry-scheduler.service.ts:21-22.
const PARTIAL_RETRY_SUPERSEDED_REASON
    = "부분 발송 결과의 실패 수신자를 식별할 수 없어 자동 재전송을 중단했습니다. 수신자별로 확인 후 수동 발송해 주세요.";
// message-retry-scheduler.service.ts:23-24.
const MANUAL_REJECTION_RETRY_SUPERSEDED_REASON
    = "사용자가 요청한 재발송이 제공자에서 거부되어 자동 재전송을 중단했습니다. 필요하면 명시적으로 다시 요청해 주세요.";
// message-retry-scheduler.service.ts:25-26.
const UNBOUND_RETRY_SUPERSEDED_REASON
    = "발송 작업 소유자를 확인할 수 없어 자동 재전송을 중단했습니다. 필요하면 명시적으로 다시 요청해 주세요.";
// message-retry-scheduler.service.ts:129.
const LEGACY_PROVIDER_RETRY_SUPERSEDED_REASON = "지원이 종료된 메시지 공급자라 재시도하지 않습니다.";
// message-trigger.service.ts dispatchClaimedJob: sendJob/sendPreparedJob returning
// false (provider did not accept) marks the claimed job failed with this reason.
const JOB_DELIVERY_FAILED_REASON = "Provider disabled or delivery failed";

/**
 * Unique 11-digit receiver per scenario. By default it never ends in 0000 (the
 * base stub reports 가입자없음 for such numbers); carrierFail=true forces that
 * suffix to exercise the carrier-failure path.
 */
function phoneDigits(index: number, carrierFail = false): string {
    if (carrierFail) {
        // 11 digits ending in the 0000 suffix the base stub reports as 가입자없음.
        return `010${index % 10}${RUN.slice(0, 3)}0000`;
    }
    const digits = `0108${index % 10}${RUN.slice(0, 6)}`;
    return digits.endsWith("0000") ? `${digits.slice(0, 10)}9` : digits;
}

describeE2E("message-automation cron retry + carrier (real DB)", () => {
    let harness: MessageCronHarness;
    let aligoStub: ScriptedAligoStub;
    let scenarioSeq = 0;

    const ruleIds: string[] = [];
    const clientIds: number[] = [];
    const jobIds: string[] = [];
    const craftedReceivers: string[] = [];

    beforeAll(async () => {
        aligoStub = new ScriptedAligoStub();
        harness = await bootMessageCronHarness({ aligo: aligoStub });
    });

    afterAll(async () => {
        if (!harness) return;
        // FK-safe order: logs -> jobs -> rules; then the policy toggle scenario 5 wrote.
        await harness.prisma.message_log.deleteMany({
            where: {
                OR: [
                    { triggerJobId: { in: jobIds } },
                    { receiver: { in: craftedReceivers } },
                ],
            },
        }).catch(() => undefined);
        await harness.prisma.message_trigger_job.deleteMany({
            where: { id: { in: jobIds } },
        }).catch(() => undefined);
        await harness.prisma.client.deleteMany({ where: { id: { in: clientIds } } }).catch(() => undefined);
        await harness.prisma.message_trigger_rule.deleteMany({ where: { id: { in: ruleIds } } }).catch(() => undefined);
        await harness.prisma.system_setting.deleteMany({
            where: { key: `branch:${MESSAGE_CRON_BRANCH_ID}:message_policy:sms-retry:enabled` },
        }).catch(() => undefined);
        await harness.close();
    });

    /**
     * Own rule + a directly inserted due job (no catch-up batch, no intent
     * sentinels, no co-due siblings): the dispatch tick sees exactly this one
     * job, so a scripted "throw" aborts only this scenario's tick.
     */
    async function makeDueJob(tag: string, receiver: string): Promise<{ ruleId: string; jobId: string }> {
        const ruleId = `e2e:cron-retry:${tag}:${RUN}`;
        const rule = await harness.prisma.message_trigger_rule.create({
            data: {
                id: ruleId,
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: `cron-retry-${tag}-${RUN}`,
                isActive: true,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                isDefault: false,
                jobsStale: false,
                targetClientStatus: "all",
                retryOnFailure: true,
            },
        });
        ruleIds.push(rule.id);

        const recipientName = `재시도산모${tag}${RUN}`;
        // A real client row: cancelOrphanedPending cancels CLIENT jobs whose
        // clientId is null (message-trigger-job.repository.ts:982-990), and the
        // safeguard reads this client's smsAutomationEnabled flag.
        const client = await harness.prisma.client.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: recipientName,
                phone: receiver,
                phoneNormalized: receiver,
                voucherClient: false,
                smsAutomationEnabled: true,
            },
            select: { id: true },
        });
        clientIds.push(client.id);
        const job = await harness.prisma.message_trigger_job.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                ruleId,
                status: "pending",
                scheduledFor: new Date(Date.now() - 60_000),
                clientId: client.id,
                recipientType: MessageTriggerRecipientType.CLIENT,
                recipientPhone: receiver,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupeKey: `e2e-cron-retry-${tag}-${RUN}`,
                payload: {
                    memberId: "",
                    recipientName,
                    recipientPhone: receiver,
                    templateVariables: {
                        name: recipientName,
                        phone: receiver,
                        clientName: recipientName,
                    },
                } as unknown as Prisma.InputJsonValue,
            },
        });
        jobIds.push(job.id);
        return { ruleId, jobId: job.id };
    }

    /** The single aligo_sms log row the first dispatch of a job produced. */
    async function readLogByJobId(jobId: string) {
        return harness.prisma.message_log.findFirst({
            where: { triggerJobId: jobId, provider: "aligo_sms" },
            orderBy: { id: "asc" },
        });
    }

    /** Later retry-attempt rows carry the source id in variables.retryOfLogId. */
    async function readRetryAttempt(sourceLogId: number) {
        return harness.prisma.message_log.findFirst({
            where: {
                triggerJobId: { in: jobIds },
                variables: { path: ["retryOfLogId"], equals: `${sourceLogId}` } as unknown as Prisma.InputJsonObject,
            },
            orderBy: { id: "desc" },
        });
    }

    async function readJob(jobId: string) {
        return harness.prisma.message_trigger_job.findUnique({ where: { id: jobId } });
    }

    const digits = (value: string) => value.replace(/\D/g, "");

    /**
     * A manual, fully prisma-built "sent" job to anchor handcrafted message_log
     * rows for the pure-supersede scenarios (no provider call involved).
     */
    async function makeSentJob(tag: string): Promise<string> {
        const ruleId = `e2e:cron-retry-sent:${tag}:${RUN}`;
        const rule = await harness.prisma.message_trigger_rule.create({
            data: {
                id: ruleId,
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: `cron-retry-sent-${tag}-${RUN}`,
                isActive: true,
                eventType: MessageTriggerEventType.CLIENT_CREATED,
                offsetType: MessageTriggerOffsetType.IMMEDIATE,
                offsetDays: 0,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                targetClientStatus: "all",
                retryOnFailure: true,
            },
        });
        ruleIds.push(rule.id);
        const now = new Date();
        const job = await harness.prisma.message_trigger_job.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                ruleId,
                status: "sent",
                scheduledFor: new Date(now.getTime() - 60_000),
                sentAt: now,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
                dedupeKey: `e2e-cron-retry-sent-${tag}-${RUN}`,
            },
        });
        jobIds.push(job.id);
        return job.id;
    }

    async function craftFailedLog(tag: string, params: {
        jobId: string | null;
        receiver: string;
        variables: Record<string, string>;
        providerAcceptanceState?: string;
        provider?: string;
    }): Promise<number> {
        craftedReceivers.push(params.receiver);
        const log = await harness.prisma.message_log.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                provider: params.provider ?? "aligo_sms",
                templateKey: "service_info_sms",
                triggerJobId: params.jobId,
                receiver: params.receiver,
                messageBody: `crafted retry row ${tag} ${RUN}`,
                variables: params.variables as unknown as Prisma.InputJsonValue,
                status: "failed",
                attempts: 1,
                lastAttemptAt: new Date(Date.now() - 5_000),
                nextRetryAt: new Date(Date.now() - 60_000),
                ...(params.providerAcceptanceState === undefined
                    ? {}
                    : { providerAcceptanceState: params.providerAcceptanceState }),
            },
        });
        return log.id;
    }

    it("1. rejected send → retry cron sends a second, accepted attempt", async () => {
        const index = ++scenarioSeq;
        const receiver = phoneDigits(index);
        aligoStub.script(receiver, "reject");
        const { jobId } = await makeDueJob("rj", receiver);
        const sendCountBefore = aligoStub.sendCalls.length;

        await harness.tick.dispatch();

        const log = await readLogByJobId(jobId);
        expect(log).not.toBeNull();
        const source = log!;
        expect(source.provider).toBe("aligo_sms");
        expect(source.status).toBe("failed");
        expect(source.providerAcceptanceState).toBe("rejected");
        expect(source.attempts).toBe(1);
        // The scripted reject is result_code -101, which
        // classifySmsProviderRejection (sms-provider-outcome.service.ts) maps to
        // a PERMANENT rejection, so sms-trigger-delivery writes nextRetryAt=null
        // — deliberately not a 5-minute schedule. Asserted as the real value.
        expect(source.nextRetryAt).toBeNull();
        expect(source.errorMessage).toContain("인증 오류");
        expect(SCRIPTED_ALIGO_REJECT_RESULT_CODE).toBe(-101);
        expect(source.aligoMid).toBeNull();
        expect(source.carrierCheckDueAt).toBeNull();
        expect(aligoStub.sendCalls.length).toBe(sendCountBefore + 1);
        expect(aligoStub.sendCalls.map((call) => digits(call.receiver))).toContain(receiver);

        const jobAfterReject = await readJob(jobId);
        expect(jobAfterReject?.status).toBe("failed");
        expect(jobAfterReject?.cancelReason).toBe(JOB_DELIVERY_FAILED_REASON);
        expect(jobAfterReject?.attempts).toBe(0);

        // Re-script the receiver to accept and force the failed row retry-due.
        aligoStub.script(receiver, "accept");
        await harness.forceRetryDue(source.id);
        await harness.tick.retry();

        const attempt = await readRetryAttempt(source.id);
        expect(attempt).not.toBeNull();
        expect(attempt!.status).toBe("sent");
        expect(attempt!.attempts).toBe(2);
        expect(attempt!.providerAcceptanceState).toBe("accepted");
        expect(attempt!.aligoMid).not.toBeNull();
        expect(attempt!.nextRetryAt).toBeNull();
        expect(attempt!.carrierCheckDueAt).not.toBeNull();
        // The forced retry is exactly one more provider call, same receiver.
        expect(aligoStub.sendCalls.length).toBe(sendCountBefore + 2);
        expect(digits(aligoStub.sendCalls[sendCountBefore + 1]!.receiver)).toBe(receiver);

        // The source row stays failed with no reschedule once the attempt landed.
        const sourceAfter = await readLogByJobId(jobId);
        expect(sourceAfter?.id).toBe(source.id);
        expect(sourceAfter?.status).toBe("failed");
        expect(sourceAfter?.nextRetryAt).toBeNull();
    });

    it("2. uncertain (thrown) provider call is never auto-retried", async () => {
        const index = ++scenarioSeq;
        const receiver = phoneDigits(index);
        aligoStub.script(receiver, "throw");
        const { jobId } = await makeDueJob("un", receiver);
        const sendCountBefore = aligoStub.sendCalls.length;

        // Only this job is due, so the throwing send cannot abort other jobs' dispatches.
        await harness.tick.dispatch();

        const log = await readLogByJobId(jobId);
        expect(log).not.toBeNull();
        const source = log!;
        // Without a provider receipt the delivery layer fences the attempt uncertain.
        expect(source.providerAcceptanceState).toBe("uncertain");
        expect(source.status).toBe("pending");
        expect(source.nextRetryAt).toBeNull();
        expect(source.errorMessage).toContain(SCRIPTED_ALIGO_THROW_MESSAGE);
        expect(source.errorMessage).toContain(UNCERTAIN_RETRY_SUPERSEDED_REASON);
        expect(aligoStub.sendCalls.length).toBe(sendCountBefore + 1);
        expect(aligoStub.sendCalls.map((call) => digits(call.receiver))).toContain(receiver);

        // The claimed job ended failed, not re-queued for another tick.
        const jobAfterThrow = await readJob(jobId);
        expect(jobAfterThrow?.status).toBe("failed");

        // The retry cron must supersede the uncertain row instead of resending.
        await harness.forceRetryDue(source.id);
        await harness.tick.retry();

        const superseded = await readLogByJobId(jobId);
        expect(superseded?.id).toBe(source.id);
        expect(superseded?.status).toBe("failed");
        expect(superseded?.errorMessage).toBe(UNCERTAIN_RETRY_SUPERSEDED_REASON);
        expect(superseded?.nextRetryAt).toBeNull();
        expect(superseded?.providerAcceptanceState).toBe("uncertain");
        // No provider call happened for the forced retry: the throw of the first
        // dispatch is still the only send on record.
        expect(aligoStub.sendCalls.length).toBe(sendCountBefore + 1);
    });

    it("3. supersede branches terminate rows without touching the provider", async () => {
        const sentJobId = await makeSentJob("ss");
        const index = ++scenarioSeq;
        const base = phoneDigits(index);
        const partialLogId = await craftFailedLog("partial", {
            jobId: sentJobId,
            receiver: `${base}1`,
            // isPartialProviderOutcome() keys on variables.retrySafety
            // (domain/entities/message-log.entity.ts:412-414, SMS_PARTIAL_RETRY_SAFETY).
            variables: { retrySafety: "partial" },
        });
        const manualLogId = await craftFailedLog("manual", {
            jobId: sentJobId,
            receiver: `${base}2`,
            // isManualProviderRejection() keys on variables.retrySafety
            // (message-log.entity.ts:416-418, SMS_MANUAL_PROVIDER_REJECTED_RETRY_SAFETY).
            variables: { retrySafety: "manual-provider-rejected" },
        });
        const startedLogId = await craftFailedLog("started", {
            jobId: sentJobId,
            receiver: `${base}3`,
            variables: {},
            providerAcceptanceState: "started",
        });
        const unboundLogId = await craftFailedLog("unbound", {
            jobId: null,
            receiver: `${base}4`,
            variables: {},
        });

        const sendCountBefore = aligoStub.sendCalls.length;
        await harness.tick.retry();

        const expectations: Array<[number, string]> = [
            [partialLogId, PARTIAL_RETRY_SUPERSEDED_REASON],
            [manualLogId, MANUAL_REJECTION_RETRY_SUPERSEDED_REASON],
            [startedLogId, UNCERTAIN_RETRY_SUPERSEDED_REASON],
            [unboundLogId, UNBOUND_RETRY_SUPERSEDED_REASON],
        ];
        for (const [id, reason] of expectations) {
            const row = await harness.prisma.message_log.findUnique({ where: { id } });
            expect(row?.status).toBe("failed");
            expect(row?.errorMessage).toBe(reason);
            expect(row?.nextRetryAt).toBeNull();
        }
        expect(aligoStub.sendCalls).toHaveLength(sendCountBefore);
    });

    it("4. legacy provider rows are superseded, never retried", async () => {
        const sentJobId = await makeSentJob("lg");
        const index = ++scenarioSeq;
        const logId = await craftFailedLog("legacy", {
            jobId: sentJobId,
            receiver: phoneDigits(index),
            variables: {},
            provider: "aligo_sms_legacy",
        });

        const sendCountBefore = aligoStub.sendCalls.length;
        await harness.tick.retry();

        const row = await harness.prisma.message_log.findUnique({ where: { id: logId } });
        expect(row?.status).toBe("failed");
        expect(row?.errorMessage).toBe(LEGACY_PROVIDER_RETRY_SUPERSEDED_REASON);
        expect(row?.nextRetryAt).toBeNull();
        expect(aligoStub.sendCalls).toHaveLength(sendCountBefore);
    });

    it("5. sms-retry policy off leaves retry-due rows untouched", async () => {
        const sentJobId = await makeSentJob("pl");
        const index = ++scenarioSeq;
        const nextRetryAt = new Date(Date.now() - 60_000);
        const logId = await craftFailedLog("policy", {
            jobId: sentJobId,
            receiver: phoneDigits(index),
            variables: {},
            providerAcceptanceState: "rejected",
        });
        await harness.prisma.message_log.update({
            where: { id: logId },
            data: { nextRetryAt, errorMessage: "pending policy gate" },
        });

        const settings = harness.app.get(SystemSettingService, { strict: false });
        const policyActor = { userId: MESSAGE_CRON_OWNER_USER_ID, globalRole: "owner", branchRole: "owner" };
        await settings.setMessageSettingsPolicyEnabled(MESSAGE_CRON_BRANCH_ID, "sms-retry", false, policyActor);
        try {
            const sendCountBefore = aligoStub.sendCalls.length;
            await harness.tick.retry();

            const row = await harness.prisma.message_log.findUnique({ where: { id: logId } });
            expect(row?.status).toBe("failed");
            expect(row?.errorMessage).toBe("pending policy gate");
            expect(row?.attempts).toBe(1);
            expect(row?.nextRetryAt).not.toBeNull();
            expect(row?.nextRetryAt?.getTime()).toBe(nextRetryAt.getTime());
            expect(aligoStub.sendCalls).toHaveLength(sendCountBefore);
        } finally {
            // Restore (and the afterAll cleanup removes the toggled row).
            await settings.setMessageSettingsPolicyEnabled(MESSAGE_CRON_BRANCH_ID, "sms-retry", true, policyActor);
        }
    });

    it("6. carrier failure closes the log and never resends the job", async () => {
        const index = ++scenarioSeq;
        const receiver = phoneDigits(index, true);
        expect(receiver.endsWith("0000")).toBe(true);
        const { jobId } = await makeDueJob("cf", receiver);

        await harness.tick.dispatch();

        const log = await readLogByJobId(jobId);
        expect(log).not.toBeNull();
        expect(log!.status).toBe("sent");
        expect(log!.aligoMid).not.toBeNull();
        expect(log!.carrierCheckDueAt).not.toBeNull();
        const mid = log!.aligoMid as string;

        // Pull the one-shot check into the past and run the carrier cron.
        await harness.prisma.message_log.update({
            where: { id: log!.id },
            data: { carrierCheckDueAt: new Date(Date.now() - 60_000) },
        });
        await harness.tick.carrier();

        const checked = await harness.prisma.message_log.findUnique({ where: { id: log!.id } });
        expect(checked?.carrierResultState).toBe("failed");
        expect(checked?.carrierCheckDueAt).toBeNull();
        expect(checked?.carrierCheckedAt).not.toBeNull();
        // saveCarrierCheckResult flips the sent row itself (sb.message-log.repository.ts:504-523).
        expect(checked?.status).toBe("failed");
        expect(checked?.nextRetryAt).toBeNull();
        expect(checked?.errorMessage)
            .toBe(`통신사 전달 실패: ${receiver.slice(-4)} ${SCRIPTED_ALIGO_CARRIER_FAIL_STATE}`);
        const results = checked?.carrierResults as Array<Record<string, unknown>> | null;
        expect(results?.some((entry) => entry["verdict"] === "failure"
            && String(entry["smsState"]) === SCRIPTED_ALIGO_CARRIER_FAIL_STATE)).toBe(true);
        expect(aligoStub.deliveryDetailCalls).toContain(mid);

        // Restore the job as due: the carrier-failed log must fence the resend
        // (findSentTriggerJobIdsSystemScope counts carrierResultState='failed'
        // as sent — sb.message-log.repository.ts:425-445).
        await harness.prisma.message_trigger_job.update({
            where: { id: jobId },
            data: {
                status: "pending",
                cancelReason: null,
                canceledAt: null,
                sentAt: null,
                scheduledFor: new Date(Date.now() - 60_000),
            },
        });
        const sendCountBefore = aligoStub.sendCalls.length;
        await harness.tick.dispatch();

        const job = await readJob(jobId);
        expect(job?.status).toBe("sent");
        expect(job?.cancelReason).toBeNull();
        expect(aligoStub.sendCalls).toHaveLength(sendCountBefore);
        const logCount = await harness.prisma.message_log.count({
            where: { triggerJobId: jobId, provider: "aligo_sms" },
        });
        expect(logCount).toBe(1);
    });

    it("7. carrier success records delivered and clears the due date", async () => {
        const index = ++scenarioSeq;
        const receiver = phoneDigits(index);
        expect(receiver.endsWith("0000")).toBe(false);
        const { jobId } = await makeDueJob("cs", receiver);

        await harness.tick.dispatch();

        const log = await readLogByJobId(jobId);
        expect(log).not.toBeNull();
        const mid = log!.aligoMid as string;
        expect(mid).not.toBeNull();
        expect(log!.carrierCheckDueAt).not.toBeNull();

        await harness.prisma.message_log.update({
            where: { id: log!.id },
            data: { carrierCheckDueAt: new Date(Date.now() - 60_000) },
        });
        await harness.tick.carrier();

        const checked = await harness.prisma.message_log.findUnique({ where: { id: log!.id } });
        expect(checked?.carrierResultState).toBe("delivered");
        expect(checked?.carrierCheckDueAt).toBeNull();
        expect(checked?.carrierCheckedAt).not.toBeNull();
        expect(checked?.status).toBe("sent");
        const results = checked?.carrierResults as Array<Record<string, unknown>> | null;
        expect(results?.every((entry) => entry["verdict"] === "success")).toBe(true);
        expect(aligoStub.deliveryDetailCalls).toContain(mid);
    });
});
