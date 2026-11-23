import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { CanceledAutomationRetrySettingsService } from "application/services/canceled-automation-retry-settings.service";
import { ClientService } from "application/services/client.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { buildSmsProviderAcceptanceFingerprint, buildSmsProviderAcceptanceKey, SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { CreateClientUsecase } from "application/usecases/client/create-client.usecase";
import { FindClientByIdUsecase } from "application/usecases/client/find-client-by-id.usecase";
import { UpdateClientUsecase } from "application/usecases/client/update-client.usecase";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import {
    SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
    getServiceRecordLinkScheduledFor,
} from "domain/constants/service-record-link-message";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { CanceledAutomationRetryRepository } from "infrastructure/database/repositories/canceled-automation-retry.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { createBranch, createClient, createEformsignDoc, createEmployee, createEmployeeSchedule } from "../helpers/factories";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { noopApprovalStub, RecordingDeliveryStub, wireMessageTriggerService } from "./sms-wiring.local";

type TriggerFixture = ReturnType<typeof wireMessageTriggerService>;

class RecordingRecordLinkDelivery extends RecordingDeliveryStub {
    accepts = true;
    private readonly acceptance: SmsProviderAcceptanceService;

    constructor(database: PrismaService, ...rest: Tail<ConstructorParameters<typeof RecordingDeliveryStub>>) {
        super(database, ...rest);
        this.acceptance = new SmsProviderAcceptanceService(new SbMessageLogRepository(database));
    }

    protected override async completePreparedDelivery(job: MessageTriggerJobEntity): Promise<boolean> {
        const log = await this.acceptance.prepare(MessageLogEntity.create({
            branchId: job.branchId!,
            clientId: job.clientId!,
            triggerJobId: job.id,
            provider: "aligo_sms",
            templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
            receiver: job.recipientPhone!,
            messageBody: job.payload.messageBody!,
            variables: { scheduleId: String(job.employeeScheduleId), employeeId: String(job.payload.employeeId) },
            providerAcceptanceKey: buildSmsProviderAcceptanceKey("record-link-fixture", job.id),
            providerAcceptanceFingerprint: buildSmsProviderAcceptanceFingerprint({ id: job.id }),
            providerAcceptanceState: "prepared",
        }));
        const started = await this.acceptance.beginProviderCall(log);
        await super.completePreparedDelivery(job);
        started.recordProviderResult({ accepted: this.accepts,
            ...(this.accepts ? { providerMessageId: randomUUID() } : { errorMessage: "synthetic transport rejection" }) });
        if (!this.accepts) {
            started.status = "failed";
            started.nextRetryAt = new Date();
            job.markFailed("synthetic transport rejection");
        }
        await this.acceptance.persist(started);
        return this.accepts;
    }
}

type Tail<T extends readonly unknown[]> = T extends readonly [unknown, ...infer Rest] ? Rest : never;

describeReal("service-record-link recovery through customer writes (PostgreSQL)", () => {
    let db: IntegrityPrisma;
    let tracker: RowTracker;
    let branchIds: string[];
    const dates = { startDate: "2026-11-27", endDate: "2026-12-15" };
    const due = getServiceRecordLinkScheduledFor(new Date(dates.startDate));

    beforeAll(async () => { db = await createIntegrityPrisma(); });

    beforeEach(() => {
        tracker = new RowTracker();
        branchIds = [];
        jest.useFakeTimers({ doNotFake: ["nextTick", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "hrtime", "performance"] });
        jest.setSystemTime(new Date("2026-11-23T04:00:00Z"));
    });

    afterEach(async () => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        for (const branchId of branchIds) {
            await db.raw.message_occurrence_manual_attempt.deleteMany({ where: { branchId } });
            await db.raw.message_occurrence_claim.deleteMany({ where: { branchId } });
            await db.raw.message_log.deleteMany({ where: { branchId } });
            await db.raw.message_trigger_job.deleteMany({ where: { branchId, originalJobId: { not: null } } });
            await db.raw.message_trigger_job.deleteMany({ where: { branchId } });
            await db.raw.service_record_token.deleteMany({ where: { branchId } });
            await db.raw.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
            await db.raw.system_setting.deleteMany({ where: { key: { startsWith: `branch:${branchId}:` } } });
        }
        await tracker.cleanup(db.raw);
    });

    afterAll(async () => { if (db) await closeIntegrityPrisma(db); });

    async function fixture(withRecordLifecycle = false) {
        const { id: branchId } = await createBranch(db.raw, tracker, { smsSenderApprovalStatus: "approved" });
        branchIds.push(branchId);
        const employee = await createEmployee(db.raw, tracker, { branchId, smsAutomationEnabled: true, openToNextWork: true });
        const lock = new MessageAutomationBranchLockService(db.service);
        const activation = new MessageAutomationActivationService(db.service, lock, new AdminAuditEventWriter(db.service));
        const retry = new CanceledAutomationRetrySettingsService(new CanceledAutomationRetryRepository(db.service), lock, activation);
        const trigger = wireMessageTriggerService(db, branchId, RecordingRecordLinkDelivery);
        const calendar = { forBranch: async () => KR_BUILTIN_CALENDAR } as unknown as ConstructorParameters<typeof ClientService>[11];
        const lifecycle = withRecordLifecycle ? new ServiceRecordLifecycleService(db.service, calendar) : undefined;
        const newLinkWorker = () => new ServiceRecordLinkService(db.service, new ServiceRecordTokenService(db.service), new ConfigService(),
            trigger.jobRepository, trigger.logRepository, new SbMessageTriggerRuleBranchOverrideRepository(db.service),
            new MessageTemplateAutomationLockService(db.service), lifecycle, lock, activation);
        const link = newLinkWorker();
        const intent = new MessageAutomationIntentService(db.service, trigger.service, link, {} as ConstructorParameters<typeof MessageAutomationIntentService>[3]);
        const repository = new SbClientRepository(db.service);
        const systemRepo = new SbSystemSettingRepository(db.service);
        const clients = new ClientService(new CreateClientUsecase(repository, calendar), new FindClientByIdUsecase(repository),
            {} as ConstructorParameters<typeof ClientService>[2], {} as ConstructorParameters<typeof ClientService>[3],
            new UpdateClientUsecase(repository, calendar), {} as ConstructorParameters<typeof ClientService>[5],
            db.service, repository, new SystemSettingService(new GetSettingUsecase(systemRepo), new UpdateSettingUsecase(systemRepo)),
            {} as ConstructorParameters<typeof ClientService>[9], intent, calendar, undefined, link,
            lifecycle, undefined, undefined, undefined, undefined, lock);
        await db.raw.message_trigger_rule.upsert({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: { id: SERVICE_RECORD_LINK_RULE_ID, name: "제공기록지 작성 링크", eventType: MessageTriggerEventType.SERVICE_START,
                offsetType: MessageTriggerOffsetType.SAME_DAY, recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
                templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK, isActive: true },
            update: {},
        });
        const toggle = (on: boolean) => retry.update(branchId, SERVICE_RECORD_LINK_RULE_ID, on);
        const create = async (serviceStatus = "pre_booking", applyMessageAutomation = false, period = dates) => {
            const client = await clients.create(branchId, {
                ...period, name: "QA-제공기록 링크 테스트", primaryEmployeeId: employee.id, serviceStatus, applyMessageAutomation,
                careCenter: false, voucherClient: false, birthday: null, dueDate: null, birthDate: null, breastPump: false,
            });
            const schedule = await db.raw.employee_schedule.findFirstOrThrow({ where: { branchId, clientId: client.id } });
            tracker.track("client", client.id);
            tracker.track("employee_schedule", schedule.id);
            return { client, schedule };
        };
        return { branchId, employee, link, newLinkWorker, clients, trigger, toggle, create, lock };
    }

    async function acceptedFor(branchId: string) {
        return db.raw.message_log.findMany({ where: { branchId, templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
            providerAcceptanceState: "accepted" } });
    }

    async function deliver(trigger: TriggerFixture, id: string, branchId: string): Promise<void> {
        await trigger.service.dispatchPendingJobNow(id, { expectedBranchId: branchId });
    }

    it("keeps a pre-booking attachment inert with the actual record lifecycle wired", async () => {
        const { branchId, create, toggle } = await fixture(true);
        await toggle(true);
        const { schedule } = await create("pre_booking", true);
        expect(await db.raw.message_trigger_job.findFirst({ where: { employeeScheduleId: schedule.id } }))
            .toMatchObject({ status: "canceled", recoveryState: "awaiting_transition" });
        expect(await db.raw.service_record_case.count({ where: { branchId } })).toBe(0);
        expect(await db.raw.service_record_token.count({ where: { branchId } })).toBe(0);
        expect(await db.raw.message_log.count({ where: { branchId } })).toBe(0);
    });

    it.each([false, true])("observes a new pre-booking assignment with automation=%s and leaves OFF inert", async apply => {
        const { branchId, link, clients, create, toggle } = await fixture();
        const { client, schedule } = await create("pre_booking", apply);
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID } });
        expect(original).toMatchObject({ status: "canceled", recoveryEpoch: null, recoveryState: "awaiting_transition", scheduledFor: due });
        expect(await db.raw.service_record_token.count({ where: { branchId } })).toBe(0);
        await toggle(true); // OFF at observation stays excluded.
        await clients.confirmBooking(branchId, client.id);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: original.id } })).toBe(0);
        expect(await db.raw.message_log.count({ where: { branchId } })).toBe(0);
    });

    it.each(["waiting", "active"])("records %s before a worker crash and admits and sends exactly once", async status => {
        const { branchId, employee, link, newLinkWorker, clients, create, toggle, trigger } = await fixture();
        const { enabledAt } = await toggle(true);
        const { client, schedule } = await create();
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        expect(original.recoveryEpoch?.toISOString()).toBe(enabledAt);
        if (status === "active") jest.setSystemTime(new Date("2026-11-27T04:00:00Z"));
        const hook = jest.spyOn(link, "recheckClientRecovery").mockResolvedValueOnce(undefined);
        await clients.confirmBooking(branchId, client.id);
        expect(hook).toHaveBeenCalledTimes(1);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: original.id } })).toMatchObject({
            recoveryState: "eligible", recoveryTransitionStatus: status, scheduledFor: due, status: "canceled",
        });
        if (status === "waiting") {
            jest.setSystemTime(new Date(due.getTime() - 1));
            expect(await link.sweepRecovery()).toBe(0);
            jest.setSystemTime(due);
        }
        await Promise.all([link.recheckClientRecovery(branchId, client.id),
            newLinkWorker().recheckClientRecovery(branchId, client.id), newLinkWorker().sweepRecovery()]);
        const successor = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });
        expect(successor).toMatchObject({ dedupeKey: `record-retry:${original.id}`, recipientPhone: employee.phone, scheduledFor: new Date() });
        const secondWorker = wireMessageTriggerService(db, branchId, RecordingRecordLinkDelivery);
        await Promise.all([deliver(trigger, successor.id, branchId), deliver(secondWorker, successor.id, branchId)]);
        expect([...trigger.delivery.providerCalls, ...secondWorker.delivery.providerCalls]).toHaveLength(1);
        expect(await acceptedFor(branchId)).toHaveLength(1);
        expect(await db.raw.message_log.count({ where: { triggerJobId: original.id } })).toBe(0);
        jest.setSystemTime(new Date("2026-11-28T04:00:00Z"));
        await clients.update(branchId, client.id, { name: "QA-진행 상태" });
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: original.id } })).toBe(1);
    });

    it.each(["off", "new-epoch", "legacy", "completed"])("keeps %s terminal including after a later edit", async mode => {
        const { branchId, employee, link, clients, create, toggle } = await fixture();
        await toggle(true);
        const { client, schedule } = mode === "legacy" ? await (async () => {
            const client = await createClient(db.raw, tracker, { branchId, serviceStatus: "pre_booking",
                startDate: new Date(dates.startDate), endDate: new Date(dates.endDate) });
            const schedule = await createEmployeeSchedule(db.raw, tracker, { clientId: client.id, primaryEmployeeId: employee.id },
                { branchId, startDate: new Date(dates.startDate), endDate: new Date(dates.endDate) });
            return { client, schedule };
        })() : await create();
        if (mode === "off" || mode === "new-epoch") await toggle(false);
        if (mode === "new-epoch") await toggle(true);
        const missedHook = mode === "completed" ? jest.spyOn(link, "recheckClientRecovery").mockResolvedValue(undefined) : undefined;
        if (missedHook) jest.setSystemTime(new Date("2026-12-16T04:00:00Z"));
        await clients.confirmBooking(branchId, client.id);
        if (missedHook) {
            missedHook.mockRestore();
            expect(await db.raw.message_trigger_job.findFirst({ where: { employeeScheduleId: schedule.id } }))
                .toMatchObject({ recoveryState: "ineligible_terminal", recoveryTransitionStatus: "completed" });
            await clients.update(branchId, client.id, { endDate: "2026-12-30" });
        } else jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await link.scheduleForServiceStart(schedule.id)).toBe(false);
        expect(await db.raw.message_trigger_job.findMany({ where: { employeeScheduleId: schedule.id } }))
            .toEqual([expect.objectContaining({ status: "canceled", cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON, originalJobId: null })]);
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it.each([false, true])("gives a confirmed fresh assignment its first ordinary send with automation=%s and retry OFF", async apply => {
        const { branchId, create, trigger } = await fixture();
        const { schedule } = await create("waiting", apply);
        const job = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id, ruleId: SERVICE_RECORD_LINK_RULE_ID } });
        expect(job).toMatchObject({ status: "pending", originalJobId: null, recoveryReason: null, scheduledFor: due });
        jest.setSystemTime(new Date(due.getTime() - 1));
        await deliver(trigger, job.id, branchId);
        expect(trigger.delivery.providerCalls).toHaveLength(0);
        jest.setSystemTime(due);
        await deliver(trigger, job.id, branchId);
        expect(await acceptedFor(branchId)).toHaveLength(1);
    });

    it("keeps the first due time and honors a delayed schedule, even when a date refresh rechecks it", async () => {
        const { branchId, lock, create, toggle, clients, link, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        const moved = new Date("2026-12-01");
        await lock.runExclusive(branchId, tx => tx.employee_schedule.update({ where: { id: schedule.id }, data: { startDate: moved } }));
        await clients.confirmBooking(branchId, client.id);
        const movedDue = getServiceRecordLinkScheduledFor(moved);
        for (const time of [due, new Date(movedDue.getTime() - 1)]) {
            jest.setSystemTime(time);
            await link.scheduleForServiceStart(schedule.id, { rescheduleAutomatic: true, branchId });
            expect(await link.sweepRecovery()).toBe(0);
        }
        jest.setSystemTime(movedDue);
        expect(await link.sweepRecovery()).toBe(1);
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id, originalJobId: null } });
        const successor = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { originalJobId: original.id } });
        expect(original.scheduledFor).toEqual(due);
        expect(successor.scheduledFor).toEqual(movedDue);
        await deliver(trigger, successor.id, branchId);
        expect(await acceptedFor(branchId)).toHaveLength(1);
    });

    it.each(["direct dispatch", "dispatch tick"])("makes denied sender terminal at a real due attempt via %s, even after approval", async entry => {
        const { branchId, create, clients, toggle, link, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create("waiting");
        const job = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        await clients.update(branchId, client.id, { startDate: null });
        await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "pending" } });
        if (entry === "dispatch tick") {
            jest.spyOn(trigger.service["messageSenderApprovalService"], "getApprovedBranchIds").mockResolvedValue(new Set());
            jest.setSystemTime(new Date(due.getTime() - 1));
            await trigger.service.dispatchDueJobs();
            expect(await db.raw.message_trigger_job.findUnique({ where: { id: job.id } }))
                .toMatchObject({ status: "pending", recoveryReason: null, scheduledFor: due });
        }
        jest.setSystemTime(due);
        if (entry === "dispatch tick") await trigger.service.dispatchDueJobs();
        else await deliver(trigger, job.id, branchId);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: job.id } })).toMatchObject({
            status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON, recoveryReason: null, recoveryEpoch: null,
        });
        await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        await clients.update(branchId, client.id, { startDate: dates.startDate });
        expect(await link.sweepRecovery()).toBe(0);
        expect(await link.scheduleForServiceStart(schedule.id)).toBe(false);
        expect(trigger.delivery.providerCalls).toHaveLength(0);
        expect(await db.raw.message_log.count({ where: { branchId } })).toBe(0);
    });

    it.each([false, true])("captures the %s epoch at a pending original's first actual cancellation", async enabled => {
        const { branchId, create, clients, toggle, link, trigger } = await fixture();
        const epoch = enabled ? (await toggle(true)).enabledAt : null;
        const { client, schedule } = await create("waiting");
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        await clients.update(branchId, client.id, { startDate: null });
        jest.setSystemTime(new Date(due.getTime() - 1));
        await deliver(trigger, original.id, branchId);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: original.id } }))
            .toMatchObject({ status: "pending", recoveryReason: null, scheduledFor: due });
        jest.setSystemTime(due);
        await deliver(trigger, original.id, branchId);
        const blocked = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: original.id } });
        expect(blocked).toMatchObject({ status: "canceled", cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
            firstBlockedAt: due, scheduledFor: due, recoveryState: "awaiting_transition" });
        expect(blocked.recoveryEpoch?.toISOString() ?? null).toBe(epoch);
        if (!enabled) await toggle(true);
        await clients.update(branchId, client.id, { startDate: dates.startDate });
        await link.sweepRecovery();
        const successor = await db.raw.message_trigger_job.findUnique({ where: { originalJobId: original.id } });
        if (enabled) await deliver(trigger, successor!.id, branchId);
        else expect(successor).toBeNull();
        expect(await acceptedFor(branchId)).toHaveLength(enabled ? 1 : 0);
        expect(await db.raw.message_log.count({ where: { triggerJobId: original.id } })).toBe(0);
    });

    it("keeps an unattempted pre-due original on its normal path with retry OFF", async () => {
        const { branchId, create, clients, trigger } = await fixture();
        const { client, schedule } = await create("waiting");
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        await clients.update(branchId, client.id, { startDate: null });
        await clients.update(branchId, client.id, { startDate: dates.startDate });
        jest.setSystemTime(new Date(due.getTime() - 1));
        await deliver(trigger, original.id, branchId);
        expect(await acceptedFor(branchId)).toHaveLength(0);
        jest.setSystemTime(due);
        await deliver(trigger, original.id, branchId);
        expect(await db.raw.message_trigger_job.findMany({ where: { employeeScheduleId: schedule.id } }))
            .toEqual([expect.objectContaining({ id: original.id, status: "sent", scheduledFor: due, originalJobId: null })]);
        expect(await acceptedFor(branchId)).toHaveLength(1);
    });

    it("rechecks the exact epoch at the provider fence after a successor is admitted", async () => {
        const { branchId, create, clients, link, toggle, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        await clients.confirmBooking(branchId, client.id);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(1);
        const successor = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id, originalJobId: { not: null } } });
        const realPrepare = trigger.delivery.prepareJob.bind(trigger.delivery);
        jest.spyOn(trigger.delivery, "prepareJob").mockImplementationOnce(async job => {
            const prepared = await realPrepare(job);
            await toggle(false);
            await toggle(true);
            return prepared;
        });
        await deliver(trigger, successor.id, branchId);
        expect(trigger.delivery.providerCalls).toHaveLength(0);
        expect(await acceptedFor(branchId)).toHaveLength(0);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: successor.id } }))
            .toMatchObject({ status: "canceled" });
    });

    it("keeps a provider-rejected attempt terminal after pre-booking supersedes transport retry", async () => {
        const { branchId, create, clients, link, toggle, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create("waiting");
        const job = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        (trigger.delivery as RecordingRecordLinkDelivery).accepts = false;
        jest.setSystemTime(due);
        await deliver(trigger, job.id, branchId);
        expect(trigger.delivery.providerCalls).toHaveLength(1);
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "failed" });
        const { id: logId } = await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: job.id } });
        const source = await trigger.logRepository.findByIdInBranch(branchId, logId);
        await clients.update(branchId, client.id, { startDate: null });
        const retryProvider = { sendSms: jest.fn() };
        const retry = new SmsRetryService(trigger.logRepository,
            retryProvider as unknown as ConstructorParameters<typeof SmsRetryService>[1],
            noopApprovalStub() as unknown as ConstructorParameters<typeof SmsRetryService>[2],
            undefined, undefined, undefined, undefined, trigger.jobRepository);
        await retry.retry(source!, "automatic");
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: job.id } }))
            .toMatchObject({ status: "canceled", recoveryReason: null, recoveryEpoch: null });
        await clients.update(branchId, client.id, { startDate: dates.startDate });
        expect(await link.sweepRecovery()).toBe(0);
        expect(retryProvider.sendSms).not.toHaveBeenCalled();
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("closes a terminated transition and retains the pre-booking replacement restriction", async () => {
        const { branchId, employee, create, clients, link, toggle } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        const replacement = await createEmployee(db.raw, tracker, { branchId });
        await expect(clients.requestReplacement(branchId, client.id, replacement.id)).rejects.toThrow();
        expect(await db.raw.employee_schedule.count({ where: { clientId: client.id } })).toBe(1);
        await clients.terminateService(branchId, client.id);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.findFirst({ where: { employeeScheduleId: schedule.id } }))
            .toMatchObject({ recoveryState: "ineligible_terminal", recoveryTransitionStatus: "terminated",
                payload: expect.objectContaining({ employeeId: employee.id }) });
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("blocks a legacy canceled occurrence under an alternate ordinary key", async () => {
        const { branchId, create, clients, trigger, toggle } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        await db.raw.message_trigger_job.update({ where: { id: original.id }, data: {
            recoveryReason: null, recoveryEpoch: null, firstBlockedAt: null, recoveryState: null,
        } });
        await clients.confirmBooking(branchId, client.id);
        const rekey = MessageTriggerJobEntity.create({
            branchId, ruleId: SERVICE_RECORD_LINK_RULE_ID, clientId: client.id, employeeScheduleId: schedule.id,
            scheduledFor: new Date("2026-11-26T04:00:00Z"), recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            recipientPhone: original.recipientPhone, templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            dedupeKey: `system:service_record_link:schedule:${schedule.id}:primary:alternate`,
            payload: { memberId: "", recipientName: "", recipientPhone: "", templateVariables: {} },
        });
        expect((await trigger.jobRepository.upsertPending(rekey)).id).toBe(original.id);
        expect(await db.raw.message_trigger_job.count({ where: { employeeScheduleId: schedule.id } })).toBe(1);
    });

    it("records an exit to replacement requested as terminal, including after replacement completion", async () => {
        const { branchId, create, clients, link, toggle, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create("waiting");
        const original = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id } });
        await clients.update(branchId, client.id, { startDate: null });
        jest.setSystemTime(due);
        await deliver(trigger, original.id, branchId);
        await clients.update(branchId, client.id, { startDate: dates.startDate, serviceStatus: "replacement_requested" });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: original.id } }))
            .toMatchObject({ recoveryState: "ineligible_terminal", recoveryTransitionStatus: "replacement_requested" });
        await clients.completeReplacement(branchId, client.id);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("does not infer a booking transition from a signed contract or a later name edit", async () => {
        const { branchId, create, clients, link, toggle } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        const signed = await createEformsignDoc(db.raw, tracker, { branchId, clientId: client.id });
        await db.raw.client.update({ where: { id: client.id }, data: { eDocId: signed.documentId } });
        await clients.update(branchId, client.id, { name: "QA-서명된 예약 전 고객" });
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.findFirst({ where: { employeeScheduleId: schedule.id } }))
            .toMatchObject({ recoveryState: "awaiting_transition", recoveryTransitionStatus: null });
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("honors an operator cancellation of an admitted successor", async () => {
        const { branchId, create, clients, link, toggle, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        await clients.confirmBooking(branchId, client.id);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(1);
        const successor = await db.raw.message_trigger_job.findFirstOrThrow({ where: { employeeScheduleId: schedule.id, originalJobId: { not: null } } });
        await trigger.service.cancelJobByUser(branchId, successor.id);
        await deliver(trigger, successor.id, branchId);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.count({ where: { originalJobId: successor.originalJobId } })).toBe(1);
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("persists an explicit no-send choice across worker restart", async () => {
        const { branchId, create, clients, link, toggle } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        const record = link.recordClientTransitionInTransaction.bind(link);
        jest.spyOn(link, "recordClientTransitionInTransaction")
            .mockImplementationOnce((tx, branch, id, before) => record(tx, branch, id, before, false));
        await clients.confirmBooking(branchId, client.id);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await db.raw.message_trigger_job.findFirst({ where: { employeeScheduleId: schedule.id } }))
            .toMatchObject({ recoveryState: "ineligible_terminal", recoveryTransitionStatus: "waiting" });
        expect(await acceptedFor(branchId)).toHaveLength(0);
    });

    it("counts accepted manual sends and still permits an explicit resend", async () => {
        const { branchId, create, clients, toggle, link, trigger } = await fixture();
        await toggle(true);
        const { client, schedule } = await create();
        await clients.confirmBooking(branchId, client.id);
        const manual = await link.sendNow(schedule.id);
        await deliver(trigger, manual.jobId, branchId);
        jest.setSystemTime(due);
        expect(await link.sweepRecovery()).toBe(0);
        expect(await acceptedFor(branchId)).toHaveLength(1);
        const resend = await link.sendNow(schedule.id);
        await deliver(trigger, resend.jobId, branchId);
        expect(await acceptedFor(branchId)).toHaveLength(2);
    });
});
