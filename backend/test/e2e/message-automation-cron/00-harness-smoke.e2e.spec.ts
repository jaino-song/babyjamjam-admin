import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import {
    MESSAGE_CRON_BRANCH_ID,
    type MessageCronHarness,
    bootMessageCronHarness,
} from "../helpers/message-automation-cron.helper";

const describeE2E = process.env["E2E_VENDOR_STUBS"] === "1" ? describe : describe.skip;
const RUN = `${Date.now()}`.slice(-7);

describeE2E("message-automation cron harness smoke (real DB)", () => {
    let harness: MessageCronHarness;
    let standbyHarness: MessageCronHarness;
    let sendSmsSpy: jest.SpyInstance;
    let standbySendSmsSpy: jest.SpyInstance;
    const createdRuleIds: string[] = [];
    const createdJobIds: string[] = [];
    const createdLogIds: number[] = [];

    beforeAll(async () => {
        const stub = new E2eAligoApiStub();
        sendSmsSpy = jest.spyOn(stub, "sendSms");
        harness = await bootMessageCronHarness({ aligo: stub });

        const standbyStub = new E2eAligoApiStub();
        standbySendSmsSpy = jest.spyOn(standbyStub, "sendSms");
        standbyHarness = await bootMessageCronHarness({ aligo: standbyStub, standby: true });
    });

    afterAll(async () => {
        // Throwaway rows first (FK-safe order: logs -> jobs -> rule), then the apps.
        if (harness) {
            await harness.prisma.message_log.deleteMany({ where: { id: { in: [...createdLogIds] } } });
            await harness.prisma.message_trigger_job.deleteMany({ where: { id: { in: [...createdJobIds] } } });
            await harness.prisma.message_trigger_rule.deleteMany({ where: { id: { in: [...createdRuleIds] } } });
        }
        await standbyHarness?.close();
        await harness?.close();
    });

    it("default harness holds the lease and every tick resolves without sending SMS", async () => {
        expect(harness.lease.holdsLease()).toBe(true);

        await harness.tick.dispatch();
        await harness.tick.retry();
        await harness.tick.intents();
        await harness.tick.dueDate();
        await harness.tick.linkRepair();
        await harness.tick.carrier();

        expect(sendSmsSpy).not.toHaveBeenCalled();
    });

    it("standby harness never holds the lease and dispatch is a no-op", async () => {
        expect(standbyHarness.lease.holdsLease()).toBe(false);

        await standbyHarness.tick.dispatch();

        expect(standbySendSmsSpy).not.toHaveBeenCalled();
    });

    // Declared last so the tick tests above never observe these throwaway rows.
    // Rows are cleaned up in afterAll.
    it("backdate and forceRetryDue update the rows they target", async () => {
        const seededClient = await harness.prisma.client.findFirst({
            where: { branchId: MESSAGE_CRON_BRANCH_ID, deletedAt: null },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        expect(seededClient).not.toBeNull();

        const future = new Date(Date.now() + 60 * 60 * 1000);
        const rule = await harness.prisma.message_trigger_rule.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                name: `cron-harness-smoke-${RUN}`,
                eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            },
        });
        createdRuleIds.push(rule.id);

        const job = await harness.prisma.message_trigger_job.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                ruleId: rule.id,
                status: "pending",
                scheduledFor: future,
                nextAttemptAt: future,
                clientId: seededClient!.id,
                recipientType: MessageTriggerRecipientType.CLIENT,
                templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
                dedupeKey: `cron-harness-smoke-${RUN}`,
            },
        });
        createdJobIds.push(job.id);

        const log = await harness.prisma.message_log.create({
            data: {
                branchId: MESSAGE_CRON_BRANCH_ID,
                provider: "aligo_sms",
                templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
                receiver: "01012345678",
                clientId: seededClient!.id,
                messageBody: "cron harness smoke retry row",
                status: "pending",
                nextRetryAt: future,
            },
        });
        createdLogIds.push(log.id);

        const past = new Date(Date.now() - 60_000);
        await harness.backdate(job.id, past);
        const updatedJob = await harness.prisma.message_trigger_job.findUnique({ where: { id: job.id } });
        expect(updatedJob?.scheduledFor.toISOString()).toBe(past.toISOString());
        expect(updatedJob?.nextAttemptAt).toBeNull();

        await harness.forceRetryDue(log.id);
        const updatedLog = await harness.prisma.message_log.findUnique({ where: { id: log.id } });
        expect(updatedLog?.nextRetryAt).not.toBeNull();
        expect(updatedLog?.nextRetryAt?.getTime()).toBeLessThanOrEqual(Date.now());
    });
});
