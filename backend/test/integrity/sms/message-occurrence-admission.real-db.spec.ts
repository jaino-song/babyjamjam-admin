import { ServiceRecordLinkService } from "application/services/service-record-link.service";
import { MessageRetrySchedulerService } from "application/services/message-retry-scheduler.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";
import { MessageQuietHoursService } from "application/services/message-quiet-hours.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AligoDefaultSenderPolicyService } from "application/services/aligo-default-sender-policy.service";
import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { describeClientMessageEffect } from "application/services/client-message-effect-recipe";
import { buildClientMessageRecipe } from "application/services/message-trigger-recipes";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import type { SendSmsMessageDto } from "interface/dto/message-delivery.dto";
import { buildWebhookHarness, createContractDoc, documentEventPayload, mirrorDetail } from "../contracts/contracts-fixture";
import { randomUUID } from "node:crypto";
import type { client, message_log, message_trigger_job, message_trigger_rule, Prisma } from "@prisma/client";
import {
    SmsOccurrenceBlockedError,
    SmsProviderAcceptanceService,
} from "application/services/sms-provider-acceptance.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import type { MessageLogEntity } from "domain/entities/message-log.entity";
import {
    MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import {
    getServiceRecordLinkScheduledFor, serviceRecordAutomaticJobKey, SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
    SERVICE_RECORD_LINK_RULE_ID, SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY,
} from "domain/constants/service-record-link-message";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { OCCURRENCE_ALREADY_ACCEPTED, SMS_OCCURRENCE_HOLD_FIELD } from "domain/entities/message-occurrence";
import { parseMessageQuietHold } from "domain/message-policy-evaluator";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";
import { manualTemplateVariables } from "infrastructure/database/repositories/message-occurrence-ledger";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";
import { SbMessageTriggerRuleBranchOverrideRepository } from "infrastructure/database/repositories/sb.message-trigger-rule-branch-override.repository";
import { SbMessageTriggerRuleRepository } from "infrastructure/database/repositories/sb.message-trigger-rule.repository";
import { RECORD_LINK_RECOVERY_REASON } from "infrastructure/database/repositories/record-link-recovery.repository";
import { createBranch, createClient, createEmployee, createEmployeeSchedule, createEformsignDoc, createMessageLog, createMessageTriggerJob, createMessageTriggerRule } from "../helpers/factories";
import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { noopApprovalStub, waitUntilBlocked, withDeadline } from "./sms-wiring.local";

type Result = "accepted" | "rejected" | "uncertain";
const { CLIENT, PRIMARY_EMPLOYEE, SECONDARY_EMPLOYEE } = MessageTriggerRecipientType;
const { SERVICE_START, SERVICE_END } = MessageTriggerEventType;
const { PRICE_INFO, SERVICE_INFO, SERVICE_END_NOTICE, SERVICE_RECORD_LINK, CAREGIVER_SERVICE_START_NOTICE } = MessageTriggerTemplateKey;

describeReal("message occurrence provider admission (PostgreSQL)", () => {
    let db: IntegrityPrisma;
    let tracker: RowTracker;
    let logs: SbMessageLogRepository;
    let boundary: SmsProviderAcceptanceService;
    let branchId: string;
    let customer: client;
    let rule: message_trigger_rule;
    const send = jest.fn<Promise<Result>, [string]>();

    beforeAll(async () => {
        assertThrowawayTarget();
        db = await createIntegrityPrisma();
    });
    afterAll(async () => {
        if (db) await closeIntegrityPrisma(db);
    });
    beforeEach(async () => {
        tracker = new RowTracker();
        send.mockReset().mockResolvedValue("accepted");
        logs = new SbMessageLogRepository(db.service);
        boundary = new SmsProviderAcceptanceService(logs);
        branchId = (await createBranch(db.raw, tracker)).id;
        customer = await createClient(db.raw, tracker, { branchId });
        rule = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: SERVICE_START, templateKey: PRICE_INFO });
    });
    afterEach(async () => {
        if (!db || !branchId) return;
        await db.raw.message_occurrence_manual_attempt.deleteMany({ where: { branchId } });
        await db.raw.message_occurrence_claim.deleteMany({ where: { branchId } });
        await db.raw.message_trigger_rule_branch_override.deleteMany({ where: { branchId } });
        await db.raw.service_record_token.deleteMany({ where: { branchId } });
        await db.raw.message_log.deleteMany({ where: { branchId } });
        await db.raw.message_template.deleteMany({ where: { branchId } });
        await db.raw.message_trigger_rule.updateMany({ where: { branchId, groupId: { not: null } }, data: { groupId: null } });
        await db.raw.message_trigger_rule_group.deleteMany({ where: { branchId } });
        await tracker.cleanup(db.raw);
    });

    const settings = {
        getMessageAutomationPolicyConfig: async () => ({ configuration: defaultMessageAutomationPolicy(), version: "test" }),
        getMessageSettingsPolicyEnabled: async () => true,
    };

    function quietHours() {
        return new MessageQuietHoursService(settings as never, logs, new MessageAutomationBranchLockService(db.service));
    }

    function providerMock() {
        return { sendSms: async (request: { receiver: string }) => {
            const result = await send(request.receiver);
            if (result === "uncertain") throw new Error("Synthetic provider outcome unknown");
            const success = result === "accepted";
            return {
                request: { ...request, msgType: "SMS", testModeYn: "N" },
                response: {
                    result_code: success ? 1 : -101, success_cnt: success ? 1 : 0, error_cnt: success ? 0 : 1,
                    message: success ? "접수됨" : "로그인 정보 불일치",
                    ...(success ? { msg_id: 123 } : {}),
                },
            };
        } };
    }

    function compose(ensureApproved = async () => {}) {
        return new MessageDeliveryController(providerMock() as never, { ensureApproved } as never, db.service,
            { assertCanSend: async () => {} } as never, quietHours(), undefined, undefined,
            { getByKeyForBranch: async () => ({ content: "비용 안내" }) } as never);
    }

    function scheduler() {
        const activation = {
            runAutomaticRetryIfEnabled: async (_branch: string, _job: string, work: (tx: Prisma.TransactionClient) => Promise<unknown>) => ({
                applies: true, allowed: true, value: await db.service.$transaction(work),
            }),
            readJobRuleRetryPermission: async () => "on",
        };
        const retry = new SmsRetryService(logs, providerMock() as never, { ensureApproved: async () => {} } as never,
            boundary, activation as never, undefined, undefined, undefined, undefined, settings as never, quietHours());
        return new MessageRetrySchedulerService(logs, retry, { holdsLease: () => true } as never, settings as never);
    }

    function worker(configuration = defaultMessageAutomationPolicy(), usePersistedAuthority = false) {
        const lock = new MessageAutomationBranchLockService(db.service);
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const rules = new SbMessageTriggerRuleRepository(db.service);
        const settings = { getMessageAutomationPolicyConfig: async () => ({ configuration, version: "occurrence-test" }) };
        const activation = new MessageAutomationActivationService(db.service, lock, {} as never);
        const senderApproval = new MessageSenderApprovalService(db.service);
        const authority = usePersistedAuthority
            ? new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(new AgentAutomationRecordStoreService(lock)),
                new ClientAutomationSourceReader(db.service, rules, new SbMessageTriggerRuleBranchOverrideRepository(db.service),
                    senderApproval, undefined, activation), new AligoDefaultSenderPolicyService(providerMock() as never))
            : { checkAutomaticJob: async () => ({ status: "legacy" }) } as never;
        const gate = new AgentAutomationDeliveryGateService(db.service, lock, authority);
        const templates = { getByKeyForBranch: async () => ({ id: "fixture", content: "비용 안내", updatedAt: new Date(0) }) };
        const delivery = new SmsTriggerDeliveryService(providerMock() as never, templates as never, logs, boundary, undefined, gate, rules,
            settings as never, undefined, new MessageQuietHoursService(settings as never, logs, lock), jobs);
        const core = new MessageTriggerService(db.service, new MessageTriggerDeliveryService(delivery),
            usePersistedAuthority ? senderApproval : noopApprovalStub() as never,
            rules, jobs, logs, templates as never, {} as never, settings as never, undefined,
            activation, lock, undefined, gate, undefined, new SmsAutomationSafeguardService(db.service, activation));
        return { delivery, jobs, rules, dispatch: (id: string, expectedBranchId = branchId) => core.dispatchPendingJobNow(id, { expectedBranchId }) };
    }

    function scheduledPriceInfo(at: Date) {
        return job(rule, customer, {
            scheduledFor: at,
            payload: {
                clientId: customer.id, memberId: String(customer.id), recipientName: customer.name!, recipientPhone: customer.phone!,
                templateVariables: { name: customer.name!, weeks: "2", duration: "10", type: "A", fullPrice: "1000",
                    grant: "800", actualPrice: "200", bankName: "은행", accNum: "123" },
            },
        });
    }

    function pendingEntity(dedupeKey: string = randomUUID(), source = rule) {
        return MessageTriggerJobEntity.create({
            branchId, ruleId: source.id, clientId: customer.id, templateKey: PRICE_INFO,
            recipientType: CLIENT, recipientPhone: customer.phone, scheduledFor: new Date(), dedupeKey,
            payload: { memberId: String(customer.id), recipientName: customer.name!, recipientPhone: customer.phone!, templateVariables: {} },
        });
    }

    function providerStartsFor(jobIds: string[]) {
        return db.raw.message_log.count({ where: { branchId, triggerJobId: { in: jobIds }, providerCallStartedAt: { not: null } } });
    }

    function composeRequest(recipient = customer): SendSmsMessageDto {
        return {
            receiver: recipient.phone!, clientId: recipient.id, message: "비용 안내",
            idempotencyKey: randomUUID(), templateRef: { kind: "system", key: PRICE_INFO },
        };
    }

    function job(source = rule, recipient = customer, overrides: Partial<Prisma.message_trigger_jobUncheckedCreateInput> = {}) {
        return createMessageTriggerJob(db.raw, tracker, { ruleId: source.id }, {
            branchId, clientId: recipient.id, recipientPhone: recipient.phone,
            recipientType: source.recipientType, templateKey: source.templateKey, ...overrides,
        });
    }

    async function ruleInGroup(templateKey = PRICE_INFO, eventType = SERVICE_START) {
        const group = await db.raw.message_trigger_rule_group.create({ data: { branchId, name: "slot", recipientMode: CLIENT } });
        return createMessageTriggerRule(db.raw, tracker, { branchId, eventType, templateKey, groupId: group.id });
    }

    function prepared(source?: message_trigger_job, overrides: Partial<Prisma.message_logUncheckedCreateInput> = {}) {
        return createMessageLog(db.raw, tracker, {
            branchId, clientId: source?.clientId ?? customer.id, receiver: source?.recipientPhone ?? customer.phone!,
            triggerJobId: source?.id,
            templateKey: source ? `${source.templateKey.toLowerCase()}_sms` : "manual_sms",
            variables: source ? {} : manualTemplateVariables({ kind: "system", key: PRICE_INFO }),
            providerAcceptanceState: "prepared", providerAcceptanceKey: randomUUID(), providerAcceptanceFingerprint: randomUUID(),
            ...overrides,
        });
    }

    async function attempt(row: message_log): Promise<Result | "blocked" | "held" | "duplicate"> {
        let log;
        try {
            log = await boundary.beginProviderCall(MessageLogMapper.toDomain(row));
        } catch (error) {
            if (error instanceof SmsOccurrenceBlockedError) return error.disposition === "accepted" ? "blocked" : "held";
            if (error instanceof Error && error.name === "ConflictException") return "duplicate";
            throw error;
        }
        return sendAdmitted(log);
    }

    async function sendAdmitted(log: MessageLogEntity): Promise<Result> {
        const result = await send(log.receiver);
        log.providerAcceptanceState = result;
        log.status = result === "accepted" ? "sent" : "failed";
        if (result === "accepted") log.providerAcceptedAt = new Date();
        if (result === "rejected") log.nextRetryAt = new Date();
        await boundary.persist(log);
        return result;
    }

    function reconcile(row: message_log, outcome: "delivered" | "not-delivered") {
        return boundary.reconcile({ branchId, logId: row.id, actor: "test", reason: "provider history", outcome });
    }

    function autoClaims() {
        return db.raw.message_occurrence_claim.findMany({ where: { branchId, slot: { not: null } } });
    }

    it("T1 admits exactly one of eight parallel jobs for one occurrence", async () => {
        const requests = await Promise.all(Array.from({ length: 8 }, async () => prepared(await job())));
        const results = await Promise.all(requests.map(attempt));
        expect(send).toHaveBeenCalledTimes(1);
        expect(results.filter(result => result === "blocked" || result === "held")).toHaveLength(7);
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "accepted", acceptedVia: "automatic" })]);
        expect(await db.raw.message_log.count({ where: { branchId, providerAcceptanceState: "accepted" } })).toBe(1);
    });

    it("T2/T3/T21 blocks both events after general compose, preserves the first proof, and treats branch templates independently", async () => {
        const controller = compose();
        const request = composeRequest();
        expect(await controller.sendSms({ branchId }, request)).toMatchObject({ result: { successCount: 1 } });
        const proof = await db.raw.message_occurrence_claim.findFirstOrThrow({ where: { branchId, state: "accepted" } });
        expect(proof.acceptedVia).toBe("manual");
        expect(await controller.sendSms({ branchId }, request)).toMatchObject({ result: { successCount: 1 } });
        const endRule = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: SERVICE_END, templateKey: PRICE_INFO });
        expect(await attempt(await prepared(await job()))).toBe("blocked");
        expect(await attempt(await prepared(await job(endRule)))).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(1);
        await controller.sendSms({ branchId }, composeRequest());
        expect(send).toHaveBeenCalledTimes(2);
        expect(await db.raw.message_occurrence_claim.findFirstOrThrow({ where: { branchId, state: "accepted" } }))
            .toMatchObject({ acceptedLogId: proof.acceptedLogId, acceptedVia: "manual" });

        const other = await createClient(db.raw, tracker, { branchId });
        const branchTemplate = await db.raw.message_template.create({
            data: { id: randomUUID(), branchId, name: "비용 안내", content: request.message, updatedAt: new Date() },
        });
        await expect(controller.sendSms({ branchId }, { ...request, templateRef: { kind: "branch", id: branchTemplate.id } }))
            .rejects.toMatchObject({ status: 409 });
        await controller.sendSms({ branchId }, { ...composeRequest(other), templateRef: { kind: "branch", id: branchTemplate.id } });
        expect(await attempt(await prepared(await job(rule, other), { messageBody: request.message }))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(4);
    });

    it.each([true, false])("checks manual acceptance at provider admission for a pending ordinary CLIENT job (accepted=%s)", async accepted => {
        const at = new Date("2026-11-23T04:00:00Z");
        jest.useFakeTimers({ now: at, doNotFake: ["nextTick", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] });
        try {
            await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
            customer = await db.raw.client.update({ where: { id: customer.id }, data: {
                startDate: at, endDate: new Date("2026-12-15"), bookingConfirmedAt: at,
                serviceStatus: "active", smsAutomationEnabled: true,
            } });
            const policy = defaultMessageAutomationPolicy();
            policy.quietHours.enabled = false;
            const { jobs, rules, dispatch } = worker(policy, true);
            const source = await createMessageTriggerRule(db.raw, tracker, { branchId, templateKey: SERVICE_INFO });
            const activeRule = await rules.findByIdIncludingGlobal(branchId, source.id);
            const recipe = activeRule && buildClientMessageRecipe(activeRule, { ...customer, name: customer.name! }, at);
            if (!recipe) throw new Error("Expected a canonical client job recipe");
            // Materialize before the operator send so this exercises dispatch admission of an already-pending job.
            const pending = await jobs.create(MessageTriggerJobEntity.create(recipe));
            tracker.track("message_trigger_job", pending.id);
            expect(pending).toMatchObject({ status: "pending", recipientType: CLIENT, templateKey: SERVICE_INFO, employeeScheduleId: null });
            expect(await db.raw.message_trigger_job.count({ where: { branchId, templateKey: SERVICE_RECORD_LINK } })).toBe(0);

            if (accepted) {
                const sender = new MessageSenderApprovalService(db.service);
                await expect(compose(() => sender.ensureApproved(branchId)).sendSms({ branchId }, {
                    ...composeRequest(), templateRef: { kind: "system", key: SERVICE_INFO },
                })).resolves.toMatchObject({ result: { successCount: 1 } });
                expect(send).toHaveBeenCalledTimes(1);
                expect(await db.raw.message_occurrence_claim.findFirst({ where: { branchId, state: "accepted" } }))
                    .toMatchObject({ acceptedVia: "manual" });
                send.mockClear();
            }

            await dispatch(pending.id);
            expect(send).toHaveBeenCalledTimes(accepted ? 0 : 1);
            expect(await providerStartsFor([pending.id])).toBe(accepted ? 0 : 1);
            expect(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject(
                accepted ? { status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED } : { status: "sent" },
            );
            expect(await db.raw.message_log.findFirstOrThrow({ where: { branchId, triggerJobId: pending.id } })).toMatchObject(
                accepted ? { providerAcceptanceState: "prepared", errorMessage: OCCURRENCE_ALREADY_ACCEPTED }
                    : { providerAcceptanceState: "accepted" },
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it.each(["manual", "automatic"] as const)("T4 serializes behind the %s winner on a second PostgreSQL connection", async winner => {
        const first = winner === "manual" ? await prepared() : await prepared(await job());
        const second = winner === "manual" ? await prepared(await job()) : await prepared();
        let wait: Promise<MessageLogEntity | "held"> | undefined;
        const admitted = await db.raw.$transaction(async tx => {
            const firstAdmission = await boundary.beginProviderCall(MessageLogMapper.toDomain(first), tx);
            wait = boundary.beginProviderCall(MessageLogMapper.toDomain(second)).catch(error => {
                if (error instanceof SmsOccurrenceBlockedError && error.disposition === "held") return "held" as const;
                throw error;
            });
            await waitUntilBlocked(db.raw, /INSERT INTO message_occurrence_claim|FROM message_occurrence_claim/);
            return firstAdmission;
        }, { timeout: 10_000 });
        const competing = await wait;
        expect(await sendAdmitted(admitted)).toBe("accepted");
        if (winner === "manual") {
            expect(competing).toBe("held");
            expect(await attempt(second)).toBe("blocked");
            expect(send).toHaveBeenCalledTimes(1);
        } else {
            if (!competing || competing === "held") throw new Error("Explicit manual send was not admitted");
            expect(await sendAdmitted(competing)).toBe("accepted");
            expect(await attempt(await prepared(await job()))).toBe("blocked");
            expect(send).toHaveBeenCalledTimes(2);
        }
    });

    it("T5 treats recipients, cases, events and independent rule groups separately", async () => {
        const other = await createClient(db.raw, tracker, { branchId });
        const groups = await Promise.all([ruleInGroup(), ruleInGroup(), ruleInGroup(PRICE_INFO, SERVICE_END)]);
        const jobs = [await job(groups[0]!), await job(groups[1]!), await job(groups[2]!), await job(groups[0]!, other)];
        const first = await createEmployee(db.raw, tracker, { branchId });
        const second = await createEmployee(db.raw, tracker, { branchId });
        const schedule = await createEmployeeSchedule(db.raw, tracker, { clientId: customer.id, primaryEmployeeId: first.id },
            { branchId, secondaryEmployeeId: second.id });
        for (const [recipientType, employee] of [[PRIMARY_EMPLOYEE, first], [SECONDARY_EMPLOYEE, second]] as const) {
            const providerRule = await createMessageTriggerRule(db.raw, tracker, {
                branchId, recipientType, eventType: SERVICE_START, templateKey: CAREGIVER_SERVICE_START_NOTICE,
            });
            jobs.push(await job(providerRule, customer, {
                employeeScheduleId: schedule.id, recipientPhone: employee.phone, payload: { employeeId: employee.id },
            }));
        }
        for (const candidate of jobs) {
            expect(await attempt(await prepared(candidate))).toBe("accepted");
            expect(await attempt(await prepared(candidate))).toBe("blocked");
        }
        expect(send).toHaveBeenCalledTimes(6);
    });

    it.each(["delivered", "not-delivered"] as const)("T6/T14 holds uncertainty and rechecks a %s result (auto and manual)", async outcome => {
        for (const manual of [false, true]) {
            if (manual) customer = await createClient(db.raw, tracker, { branchId });
            send.mockClear().mockResolvedValueOnce("uncertain");
            const first = await prepared(manual ? undefined : await job());
            expect(await attempt(first)).toBe("uncertain");
            expect(await attempt(await prepared(await job()))).toBe("held");
            expect(send).toHaveBeenCalledTimes(1);
            if (!manual) expect(await autoClaims()).toContainEqual(expect.objectContaining({ state: "uncertain" }));
            await reconcile(first, outcome);
            await reconcile(first, outcome);
            expect(await attempt(await prepared(await job()))).toBe(outcome === "delivered" ? "blocked" : "accepted");
            expect(send).toHaveBeenCalledTimes(outcome === "delivered" ? 1 : 2);
        }
    });

    it("T7 releases on confirmed rejection and an inherited retry owns the same slot", async () => {
        send.mockResolvedValueOnce("rejected");
        const original = await prepared(await job());
        expect(await attempt(original)).toBe("rejected");
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "released", epoch: 1 })]);
        const source = (await logs.findByIdInBranch(branchId, original.id))!;
        const child = MessageLogMapper.toDomain({ ...original, variables: { retryOfLogId: String(source.id) } });
        child.providerAcceptanceKey = randomUUID();
        const retry = await logs.startRetryAttempt(source, child, "automatic");
        if (retry.kind !== "started") throw new Error("Expected an inherited retry");
        tracker.track("message_log", retry.log.id);
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "released", holderLogId: retry.log.id, epoch: 1 })]);
        const row = await db.raw.message_log.findUniqueOrThrow({ where: { id: retry.log.id } });
        expect(await attempt(row)).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(2);
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "accepted", acceptedLogId: row.id, epoch: 1 })]);
    });

    it("T7 stops scheduling after a permanent provider rejection", async () => {
        const original = await prepared(await job());
        send.mockResolvedValueOnce("rejected");
        await attempt(original);
        send.mockClear().mockResolvedValueOnce("rejected");
        await scheduler().retryFailedMessages();
        await scheduler().retryFailedMessages();
        expect(send).toHaveBeenCalledTimes(1);
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "released", epoch: 2 })]);
        expect(await db.raw.message_log.findFirst({ where: { branchId, id: { not: original.id } } }))
            .toMatchObject({ nextRetryAt: null, providerAcceptanceState: "rejected", variables: expect.objectContaining({ retrySafety: "permanent-provider-rejected" }) });
    });

    it("holds a due automatic retry without retaining a child attempt while a manual attempt is in flight", async () => {
        const original = await prepared(await job());
        send.mockResolvedValueOnce("rejected");
        expect(await attempt(original)).toBe("rejected");
        const before = await db.raw.message_log.findUniqueOrThrow({ where: { id: original.id } });
        const manual = await prepared();
        const manualAttempt = await boundary.beginProviderCall(MessageLogMapper.toDomain(manual));
        send.mockClear();
        const at = Date.now();
        jest.useFakeTimers({ now: at, doNotFake: [
            "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask",
        ] });
        try {
            await scheduler().retryFailedMessages();
            expect(send).not.toHaveBeenCalled();
            expect(await db.raw.message_log.count({ where: { triggerJobId: original.triggerJobId } })).toBe(1);
            expect(await db.raw.message_log.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
                attempts: before.attempts, nextRetryAt: new Date(at + 60_000), providerAcceptanceState: "rejected",
            });
            send.mockResolvedValueOnce("uncertain");
            await sendAdmitted(manualAttempt);
            await reconcile(manual, "not-delivered");
            send.mockClear();
            jest.setSystemTime(at + 60_001);
            await scheduler().retryFailedMessages();
            expect(send).toHaveBeenCalledTimes(1);
            expect(await db.raw.message_log.count({ where: { triggerJobId: original.triggerJobId, providerAcceptanceState: "accepted" } })).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("T8 admits once after duplicate contract completion and concurrent automatic retry claims", async () => {
        const harness = buildWebhookHarness(db);
        const initialAt = new Date("2026-10-01");
        const completedAt = new Date("2026-10-02");
        const doc = await createContractDoc(db, tracker, branchId, {
            clientId: customer.id, createdDate: initialAt, updatedDate: initialAt, statusType: "060",
        });
        const payload = documentEventPayload({
            webhookId: randomUUID(), documentId: doc.documentId, status: "doc_complete", updatedDate: completedAt,
        });
        const projection = {
            mirroredDocument: mirrorDetail({ documentId: doc.documentId, statusType: "050", updatedDate: completedAt }),
            deferCompletionEvent: true, deferCompletionEffects: false,
        };
        expect(await harness.service.processWebhook(payload, projection)).toMatchObject({ completionClaim: "claimed" });
        expect(await harness.service.processWebhook(payload, projection)).toMatchObject({ completionClaim: "duplicate" });

        const original = await prepared(await job());
        send.mockResolvedValueOnce("rejected");
        expect(await attempt(original)).toBe("rejected");
        send.mockClear();
        await Promise.all([scheduler().retryFailedMessages(), scheduler().retryFailedMessages()]);
        expect(await db.raw.message_log.count({ where: { branchId, providerAcceptanceState: "accepted" } })).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("T11 denies absent sender approval or a lost job lease before claiming an occurrence", async () => {
        await expect(compose(async () => { throw new Error("sender denied in fixture"); })
            .sendSms({ branchId }, composeRequest())).rejects.toThrow("sender denied");
        expect(await db.raw.message_log.count({ where: { branchId } })).toBe(0);

        const row = await job(rule, customer, { status: "dispatching", claimToken: "expired",
            processingDeadlineAt: new Date(Date.now() - 1000), payload: {
                clientId: customer.id, memberId: String(customer.id), recipientName: customer.name!,
                recipientPhone: customer.phone!, templateVariables: {
                    name: customer.name!, weeks: "2", duration: "10", type: "A", fullPrice: "1000",
                    grant: "800", actualPrice: "200", bankName: "은행", accNum: "123",
                },
            } });
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const expired = (await jobs.findByIdInBranch(branchId, row.id))!;
        const service = new SmsTriggerDeliveryService({ sendSms: send } as never,
            { getByKeyForBranch: async () => ({ content: "비용 안내" }) } as never,
            logs, boundary, undefined, { permitsDirectManualJob: async () => true } as never,
            undefined, { getMessageAutomationPolicyConfig: async () => ({ configuration: defaultMessageAutomationPolicy() }) } as never,
            undefined, quietHours());
        await expect(service.sendJob(expired)).rejects.toMatchObject({ name: "AgentAutomationDispatchUncertainError" });
        expect(send).not.toHaveBeenCalled();
        expect(await db.raw.message_occurrence_claim.count({ where: { branchId, state: "in_flight" } })).toBe(0);
    });

    it("T9/T19 retains the same service and slot when date and rule offset change", async () => {
        const grouped = await ruleInGroup();
        expect(await attempt(await prepared(await job(grouped)))).toBe("accepted");
        expect(await attempt(await prepared(await job()))).toBe("accepted");
        const revised = await createEformsignDoc(db.raw, tracker, { branchId, clientId: customer.id });
        customer = await db.raw.client.update({
            where: { id: customer.id }, data: { endDate: new Date("2027-05-01"), eDocId: revised.documentId },
        });
        await db.raw.message_trigger_rule.updateMany({ where: { id: { in: [rule.id, grouped.id] } }, data: { offsetDays: 5 } });
        for (const source of [grouped, rule]) expect(await attempt(await prepared(await job(source)))).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("admits one fresh worker, then refuses the same service after a date edit and admits a new client row", async () => {
        const first = await scheduledPriceInfo(new Date());
        const second = await scheduledPriceInfo(first.scheduledFor);
        const a = worker();
        const b = worker();
        await Promise.all([a.dispatch(first.id), b.dispatch(second.id)]);
        expect(await providerStartsFor([first.id, second.id])).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);

        customer = await db.raw.client.update({ where: { id: customer.id }, data: { startDate: new Date("2027-05-01") } });
        const rescheduled = await scheduledPriceInfo(new Date());
        await a.dispatch(rescheduled.id);
        expect(await providerStartsFor([rescheduled.id])).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
        const { phone, phoneNormalized } = customer;
        await db.raw.client.update({ where: { id: customer.id }, data: { deletedAt: new Date(), phoneNormalized: null } });
        customer = await createClient(db.raw, tracker, { branchId, phone, phoneNormalized });
        const fresh = await scheduledPriceInfo(new Date());
        await b.dispatch(fresh.id);
        expect(await providerStartsFor([fresh.id])).toBe(1);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("does not admit another production attempt after an uncertain automatic provider result", async () => {
        const first = await scheduledPriceInfo(new Date());
        const retry = await scheduledPriceInfo(first.scheduledFor);
        send.mockResolvedValueOnce("uncertain");
        await worker().dispatch(first.id);
        expect(await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: first.id } }))
            .toMatchObject({ providerAcceptanceState: "uncertain" });
        await worker().dispatch(retry.id);
        expect(await providerStartsFor([first.id, retry.id])).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "uncertain" })]);
    });

    it.each(["manual acceptance", "quiet release", "wrong caller", "lost claim"])("checks %s for a pending record-link successor", async mode => {
        const now = new Date(mode === "quiet release" ? "2026-11-26T13:00:00Z" : "2026-11-26T03:00:00Z");
        const startDate = new Date("2026-11-27");
        const endDate = new Date("2026-12-04");
        jest.useFakeTimers({ now, doNotFake: [
            "nextTick", "setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "hrtime", "performance",
        ] });
        const { id: employeeId, phone } = await createEmployee(db.raw, tracker, { branchId, smsAutomationEnabled: true });
        const schedule = await createEmployeeSchedule(db.raw, tracker, { clientId: customer.id, primaryEmployeeId: employeeId }, {
            branchId, startDate, endDate,
        });
        await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        customer = await db.raw.client.update({ where: { id: customer.id },
            data: { startDate, endDate, serviceStatus: "waiting", bookingConfirmedAt: now } });
        const recordRule = await db.raw.message_trigger_rule.upsert({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: { id: SERVICE_RECORD_LINK_RULE_ID, name: "record", eventType: SERVICE_START, offsetType: "SAME_DAY",
                recipientType: PRIMARY_EMPLOYEE, templateKey: SERVICE_RECORD_LINK },
            update: {},
        });
        const link = randomUUID();
        const linkUrl = `https://example.invalid/service-record/${link}`;
        await db.raw.service_record_token.create({ data: { branchId, scheduleId: schedule.id, employeeId,
            expectedPhoneHash: "fixture", linkTokenHash: link, expiresAt: new Date("2099-01-01") } });
        await db.raw.message_trigger_rule_branch_override.create({ data: { branchId, ruleId: recordRule.id,
            isActive: true, canceledRetryEnabledAt: now, canceledRetryLastEnabledAt: now } });
        const data = { employeeScheduleId: schedule.id, recipientPhone: phone, scheduledFor: getServiceRecordLinkScheduledFor(startDate),
            payload: { memberId: String(employeeId), employeeId, scheduleId: schedule.id, scheduleIncarnationId: schedule.incarnationId,
                recipientName: "QA-제공인력", recipientPhone: phone, templateVariables: {
                    employeeName: "QA-제공인력", clientName: customer.name!, serviceStartDate: "2026-11-27",
                    serviceEndDate: "2026-12-04", serviceRecordUrl: linkUrl,
                }, buttonUrl: linkUrl } };
        const original = await job(recordRule, customer, { ...data, status: "canceled", cancelReason: SERVICE_RECORD_LINK_PRE_BOOKING_REASON,
            recoveryReason: RECORD_LINK_RECOVERY_REASON, recoveryEpoch: now, firstBlockedAt: now,
            recoveryState: "admitted", recoveryTransitionStatus: "waiting" });
        const recovery = await job(recordRule, customer, { ...data, dedupeKey: `record-retry:${original.id}`,
            originalJobId: original.id, recoveryReason: RECORD_LINK_RECOVERY_REASON, recoveryEpoch: now });
        const policy = defaultMessageAutomationPolicy();
        policy.quietHours.enabled = mode === "quiet release";
        const a = worker(policy);
        try {
            if (mode === "manual acceptance") {
                const ordinary = await job(recordRule, customer, data);
                for (let index = 0; index < 2; index++) {
                    const manual = await job(recordRule, customer, { ...data,
                        dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary:manual:${randomUUID()}` });
                    expect(await a.dispatch(manual.id)).toMatchObject({ status: "sent" });
                    expect(await providerStartsFor([manual.id])).toBe(1);
                    expect(await db.raw.message_log.findFirstOrThrow({ where: { triggerJobId: manual.id } }))
                        .toMatchObject({ providerAcceptanceState: "accepted" });
                }
                const competingIds = [ordinary.id, recovery.id];
                expect(await db.raw.message_trigger_job.count({ where: { id: { in: competingIds }, status: "pending" } })).toBe(2);
                expect(await db.raw.message_occurrence_manual_attempt.count({ where: { branchId, state: "accepted" } })).toBe(2);
                await Promise.all([a.dispatch(ordinary.id), worker().dispatch(recovery.id)]);
                expect(await providerStartsFor(competingIds)).toBe(0);
                expect(send).toHaveBeenCalledTimes(2);
            } else if (mode === "quiet release") {
                const release = new Date("2026-11-26T23:00:00Z");
                expect(await a.dispatch(recovery.id)).toMatchObject({ status: "pending", nextAttemptAt: release, claimToken: null, attempts: 0 });
                expect(await providerStartsFor([recovery.id])).toBe(0);
                expect(send).not.toHaveBeenCalled();
                jest.setSystemTime(release);
                expect(await a.dispatch(recovery.id)).toMatchObject({ status: "sent" });
                await a.dispatch(recovery.id);
                expect(await providerStartsFor([recovery.id])).toBe(1);
                expect(send).toHaveBeenCalledTimes(1);
            } else if (mode === "wrong caller") {
                await expect(a.dispatch(recovery.id, randomUUID())).rejects.toMatchObject({ status: 404 });
                expect(await db.raw.message_trigger_job.findUnique({ where: { id: recovery.id } }))
                    .toMatchObject({ status: "pending", claimToken: null, attempts: 0 });
                expect(await providerStartsFor([recovery.id])).toBe(0);
                expect(send).not.toHaveBeenCalled();
            } else {
                const rightfulClaim = randomUUID();
                const realPrepare = a.delivery.prepareJob.bind(a.delivery);
                const prepare = jest.spyOn(a.delivery, "prepareJob").mockImplementationOnce(async job => {
                    const prepared = await realPrepare(job);
                    await db.raw.message_trigger_job.update({ where: { id: recovery.id }, data: { claimToken: rightfulClaim } });
                    return prepared;
                });
                await a.dispatch(recovery.id);
                expect(prepare).toHaveBeenCalledTimes(1);
                expect(await db.raw.message_trigger_job.findUnique({ where: { id: recovery.id } }))
                    .toMatchObject({ status: "processing", claimToken: rightfulClaim, attempts: 0 });
                expect(await providerStartsFor([recovery.id])).toBe(0);
                expect(send).not.toHaveBeenCalled();
            }
        } finally {
            jest.useRealTimers();
            // The successor has a non-cascading FK to its canceled predecessor.
            await db.raw.message_trigger_job.deleteMany({ where: { id: recovery.id } });
        }
    });

    it("T10/T10b distinguishes exact historical slots, detached history, stamps and carrier failure", async () => {
        const d3 = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        const d1 = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        const acceptedAt = new Date("2026-06-13T00:00:00.000Z");
        const historical = await job(d3, customer, { status: "canceled" });
        await createMessageLog(db.raw, tracker, {
            branchId, clientId: customer.id, templateKey: "service_end_notice_sms", triggerJobId: historical.id,
            providerAcceptanceState: "accepted", providerAcceptedAt: acceptedAt, status: "failed", carrierResultState: "failed",
        });
        await db.raw.client.update({ where: { id: customer.id }, data: { serviceEndNoticeSentAt: acceptedAt } });
        expect(await attempt(await prepared(await job(d3)))).toBe("blocked");
        expect(await attempt(await prepared(await job(d1)))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(1);

        customer = await createClient(db.raw, tracker, { branchId, serviceEndNoticeSentAt: acceptedAt });
        expect(await attempt(await prepared(await job(d3)))).toBe("blocked");
        expect(await attempt(await prepared(await job(d1)))).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(1);
        expect(await db.raw.message_occurrence_claim.findFirst({ where: { branchId, lifecycleId: customer.id, state: "accepted" } }))
            .toMatchObject({ proofSource: "legacy_stamp" });

        customer = await createClient(db.raw, tracker, { branchId });
        await createMessageLog(db.raw, tracker, {
            branchId, clientId: customer.id, templateKey: "MANUAL_SMS", receiver: customer.phone!, status: "sent",
        });
        expect(await attempt(await prepared(await job(d3)))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("T10 never credits an accepted template log from a different branch with the same phone", async () => {
        const otherBranch = (await createBranch(db.raw, tracker)).id;
        const otherClient = await createClient(db.raw, tracker, { branchId: otherBranch, phone: customer.phone,
            phoneNormalized: customer.phoneNormalized });
        const otherRule = await createMessageTriggerRule(db.raw, tracker, { branchId: otherBranch, eventType: SERVICE_START, templateKey: PRICE_INFO });
        const otherJob = await job(otherRule, otherClient, { branchId: otherBranch });
        await createMessageLog(db.raw, tracker, { branchId: otherBranch, clientId: otherClient.id, receiver: customer.phone!,
            triggerJobId: otherJob.id, templateKey: "price_info_sms", status: "sent" });
        expect(await attempt(await prepared(await job()))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("previews only unaccepted end-notice slots without writing occurrence claims", async () => {
        const d3 = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        const d1 = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        await db.raw.message_trigger_rule.updateMany({ where: { id: { in: [d3.id, d1.id] } }, data: {
            isActive: true, offsetType: MessageTriggerOffsetType.BEFORE_DAYS, offsetDays: 3,
        } });
        await db.raw.message_trigger_rule.update({ where: { id: d1.id }, data: { offsetDays: 1 } });
        const rules = new SbMessageTriggerRuleRepository(db.service);
        const { delivery } = worker();
        const at = new Date("2026-11-03T12:00:00.000Z");
        const stamp = new Date("2026-11-01T12:00:00.000Z");
        const preview = async (id: string) => (await describeClientMessageEffect({
            branchId, delivery, rule: (await rules.findByIdIncludingGlobal(branchId, id))!,
            client: { ...customer, name: customer.name!, endDate: new Date("2026-11-10") },
            subject: { kind: "client", clientId: customer.id, clientIdentity: "c".repeat(64) },
            policy: { dispatchEnabled: true, senderApproved: true, senderIdentityDigest: "a".repeat(64),
                senderApprovedAt: null, pastTriggerEnabled: true, pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] } },
            now: at, change: "create",
        })).status;
        const claimCount = () => db.raw.message_occurrence_claim.count({ where: { branchId } });
        await db.raw.client.update({ where: { id: customer.id }, data: { serviceEndNoticeSentAt: stamp } });
        expect(await preview(d3.id)).toBe("none");
        expect(await preview(d1.id)).toBe("none");
        expect(await claimCount()).toBe(0);

        const historical = await job(d3, customer, { status: "sent" });
        await createMessageLog(db.raw, tracker, {
            branchId, clientId: customer.id, templateKey: "service_end_notice_sms", triggerJobId: historical.id,
            providerAcceptanceState: "accepted", providerAcceptedAt: stamp, status: "sent",
        });
        expect(await preview(d3.id)).toBe("none");
        expect(await preview(d1.id)).toBe("effect");
        expect(await claimCount()).toBe(0);

        const next = await job(d1);
        send.mockResolvedValueOnce("rejected");
        expect(await attempt(await prepared(next))).toBe("rejected");
        const count = await claimCount();
        expect(count).toBe(3);
        expect(await preview(d1.id)).toBe("effect");
        expect(await attempt(await prepared(next))).toBe("accepted");
        expect(await preview(d1.id)).toBe("none");
        expect(await claimCount()).toBe(count);
    });

    it.each(["provider", "historical slot", "stamp only"])("dispatches already-pending end notices against %s proof", async proof => {
        const matched = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        const other = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        const payload = { memberId: String(customer.id), recipientName: customer.name!, recipientPhone: customer.phone!,
            templateVariables: { name: customer.name!, receiptUrl: "https://example.invalid/receipt/test" } };
        const pending = await job(matched, customer, { payload, scheduledFor: new Date() });
        const independent = await job(other, customer, { payload, scheduledFor: new Date() });
        const stamp = new Date(Date.now() - 1_000);
        if (proof === "provider") {
            const prior = await job(matched, customer, { payload, status: "sent" });
            expect(await attempt(await prepared(prior))).toBe("accepted");
            send.mockClear();
        } else {
            if (proof === "historical slot") {
                const prior = await job(matched, customer, { payload, status: "sent" });
                await createMessageLog(db.raw, tracker, {
                    branchId, clientId: customer.id, templateKey: "service_end_notice_sms", triggerJobId: prior.id,
                    providerAcceptanceState: "accepted", providerAcceptedAt: stamp, status: "sent",
                });
            }
            await db.raw.client.update({ where: { id: customer.id }, data: { serviceEndNoticeSentAt: stamp } });
        }
        const { dispatch } = worker();
        await dispatch(pending.id);
        expect(await providerStartsFor([pending.id])).toBe(0);
        expect(send).not.toHaveBeenCalled();
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: pending.id } }))
            .toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED });
        await dispatch(independent.id);
        expect(await providerStartsFor([independent.id])).toBe(proof === "stamp only" ? 0 : 1);
        expect(send).toHaveBeenCalledTimes(proof === "stamp only" ? 0 : 1);
    });

    it("T12/T22 durably defers automatic work while a manual provider call is running", async () => {
        let release!: () => void;
        let entered!: () => void;
        const providerEntered = new Promise<void>(resolve => { entered = resolve; });
        const providerRelease = new Promise<void>(resolve => { release = resolve; });
        send.mockImplementationOnce(async () => {
            entered();
            await providerRelease;
            return "accepted";
        });
        const pending = compose().sendSms({ branchId }, composeRequest());
        const automatic = await prepared(await job());
        try {
            await withDeadline(providerEntered, 5_000, "manual provider was never admitted");
            expect(await withDeadline(attempt(automatic), 5_000, "automatic admission did not defer")).toBe("held");
            expect(send).toHaveBeenCalledTimes(1);
        } finally {
            release();
            await pending;
        }
        expect(await attempt(automatic)).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(1);
        expect(await db.raw.message_log.findUnique({ where: { id: automatic.id } }))
            .toMatchObject({ errorMessage: OCCURRENCE_ALREADY_ACCEPTED, attempts: 0 });
    });

    it.each(["delivered", "not-delivered"] as const)(
        "T2/T12 records an occurrence hold through dispatch and resumes after manual %s", async outcome => {
            const clock = jest.spyOn(Date, "now");
            const at = new Date("2026-11-03T12:00:00.000Z");
            clock.mockReturnValue(at.getTime());
            try {
                const source = await scheduledPriceInfo(at);
                const manual = await prepared();
                const admitted = await boundary.beginProviderCall(MessageLogMapper.toDomain(manual));
                const { dispatch } = worker();

                expect(await dispatch(source.id)).toMatchObject({
                    status: "pending", attempts: 0, nextAttemptAt: new Date(at.getTime() + 60_000), claimToken: null,
                });
                expect(send).not.toHaveBeenCalled();
                const log = () => db.raw.message_log.findFirstOrThrow({ where: { branchId, triggerJobId: source.id } });
                expect(await log()).toMatchObject({
                    providerAcceptanceState: "prepared", providerCallStartedAt: null,
                    variables: { [SMS_OCCURRENCE_HOLD_FIELD]: expect.stringMatching(/^[a-f0-9]{64}$/) },
                });
                send.mockResolvedValueOnce(outcome === "delivered" ? "accepted" : "uncertain");
                await sendAdmitted(admitted);
                if (outcome === "not-delivered") await reconcile(manual, "not-delivered");
                send.mockClear();
                clock.mockReturnValue(at.getTime() + 60_000);
                expect(await dispatch(source.id)).toMatchObject(outcome === "delivered"
                    ? { status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED, attempts: 0 }
                    : { status: "sent" });
                expect(send).toHaveBeenCalledTimes(outcome === "delivered" ? 0 : 1);
                const finalLog = await log();
                expect(finalLog.attempts).toBe(outcome === "delivered" ? 0 : 1);
                expect(finalLog.variables).not.toHaveProperty(SMS_OCCURRENCE_HOLD_FIELD);
            } finally {
                clock.mockRestore();
            }
        },
    );

    it.each([{}, { [SMS_OCCURRENCE_HOLD_FIELD]: "malformed" }, {
        [SMS_OCCURRENCE_HOLD_FIELD]: "a".repeat(64), quietHoursDisposition: "DEFER", quietHoursReleaseAt: "bad-time",
    }])("fails closed when a deferred job has no valid hold metadata (%j)", async variables => {
        const at = new Date();
        const automatic = await scheduledPriceInfo(at);
        await db.raw.message_trigger_job.update({ where: { id: automatic.id }, data: { nextAttemptAt: at } });
        await prepared(automatic, { variables });
        await expect(worker().dispatch(automatic.id)).rejects.toThrow(
            "quietHoursDisposition" in variables ? "Invalid quiet hold association" : "Quiet hold metadata is missing",
        );
        expect(send).not.toHaveBeenCalled();
    });

    it("retains the original quiet release time through a subsequent occurrence hold and expiry", async () => {
        const clock = jest.spyOn(Date, "now");
        const night = new Date("2026-11-03T13:00:00.000Z");
        clock.mockReturnValue(night.getTime());
        try {
            const configuration = defaultMessageAutomationPolicy();
            configuration.pastExpiryHours = 1;
            configuration.quietHours.enabled = true;
            const { dispatch } = worker(configuration);
            const automatic = await scheduledPriceInfo(night);
            const log = () => db.raw.message_log.findFirstOrThrow({ where: { branchId, triggerJobId: automatic.id } });
            const release = new Date("2026-11-03T23:00:00.000Z");
            expect(await dispatch(automatic.id)).toMatchObject({ status: "pending", nextAttemptAt: release, attempts: 0 });
            const manual = await prepared();
            await boundary.beginProviderCall(MessageLogMapper.toDomain(manual));
            clock.mockReturnValue(release.getTime());
            expect(await dispatch(automatic.id)).toMatchObject({ status: "pending", nextAttemptAt: new Date(release.getTime() + 60_000), attempts: 0 });
            const held = await log();
            expect(held.variables).toHaveProperty(SMS_OCCURRENCE_HOLD_FIELD);
            expect(parseMessageQuietHold(held.variables)?.releaseAt).toEqual(release);
            clock.mockReturnValue(release.getTime() + 3_600_001);
            expect(await dispatch(automatic.id)).toMatchObject({ status: "canceled", cancelReason: "expired_after_quiet", attempts: 0 });
            expect((await log()).variables).not.toHaveProperty(SMS_OCCURRENCE_HOLD_FIELD);
            expect(send).not.toHaveBeenCalled();
        } finally {
            clock.mockRestore();
        }
    });

    it("T13 leaves automatic uncertainty intact after an explicit manual rejection", async () => {
        send.mockResolvedValueOnce("uncertain").mockResolvedValueOnce("rejected");
        expect(await attempt(await prepared(await job()))).toBe("uncertain");
        expect(await attempt(await prepared())).toBe("rejected");
        expect(await attempt(await prepared(await job()))).toBe("held");
        expect(await autoClaims()).toEqual([expect.objectContaining({ state: "uncertain", epoch: 0 })]);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("T15 manual slot context suppresses only that slot", async () => {
        const d3 = await ruleInGroup();
        const d1 = await ruleInGroup();
        const rejected = await prepared(await job(d3));
        send.mockResolvedValueOnce("rejected");
        expect(await attempt(rejected)).toBe("rejected");
        const source = (await logs.findByIdInBranch(branchId, rejected.id))!;
        const child = MessageLogMapper.toDomain({ ...rejected, variables: { retryOfLogId: String(source.id) } });
        child.providerAcceptanceKey = randomUUID();
        const started = await logs.startRetryAttempt(source, child, "manual");
        if (started.kind !== "started") throw new Error("Expected explicit retry");
        tracker.track("message_log", started.log.id);
        expect(await attempt(await db.raw.message_log.findUniqueOrThrow({ where: { id: started.log.id } }))).toBe("accepted");
        send.mockClear();
        expect(await attempt(await prepared(await job(d3)))).toBe("blocked");
        expect(await attempt(await prepared(await job(d1)))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("T16 deduplicates across a phone change and validates the current number for subsequent work", async () => {
        expect(await attempt(await prepared(await job()))).toBe("accepted");
        const currentPhone = "01099995555";
        customer = await db.raw.client.update({ where: { id: customer.id }, data: { phone: currentPhone, phoneNormalized: currentPhone } });
        const changed = await job();
        expect(await attempt(await prepared(changed))).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(1);
        const endRule = await createMessageTriggerRule(db.raw, tracker, { branchId, eventType: SERVICE_END, templateKey: PRICE_INFO });
        expect(await attempt(await prepared(await job(endRule)))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith(currentPhone);
    });

    it("T20 admits a new customer row for the same person despite the old receipt proof", async () => {
        const endRule = await ruleInGroup(SERVICE_END_NOTICE, SERVICE_END);
        expect(await attempt(await prepared(await job(endRule)))).toBe("accepted");
        const { phone, phoneNormalized } = customer;
        const original = await db.raw.client.update({
            where: { id: customer.id }, data: { deletedAt: new Date(), phoneNormalized: null },
        });
        expect(original.serviceEndNoticeSentAt).not.toBeNull();
        customer = await createClient(db.raw, tracker, { branchId, phone, phoneNormalized });
        expect(await attempt(await prepared(await job(endRule)))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("T17/T18 uses the token row and current schedule and employee, including either replacement shape", async () => {
        const first = await createEmployee(db.raw, tracker, { branchId });
        const second = await createEmployee(db.raw, tracker, { branchId });
        const originalSchedule = await createEmployeeSchedule(db.raw, tracker, { clientId: customer.id, primaryEmployeeId: first.id }, { branchId });
        const nextSchedule = await createEmployeeSchedule(db.raw, tracker, { clientId: customer.id, primaryEmployeeId: second.id }, { branchId });
        const linkRule = await db.raw.message_trigger_rule.upsert({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: { id: SERVICE_RECORD_LINK_RULE_ID, name: "record", eventType: SERVICE_START, offsetType: "SAME_DAY",
                recipientType: PRIMARY_EMPLOYEE, templateKey: SERVICE_RECORD_LINK },
            update: {},
        });
        const link = randomUUID();
        const token = await db.raw.service_record_token.create({ data: {
            branchId, scheduleId: originalSchedule.id, employeeId: first.id, expectedPhoneHash: "fixture",
            linkTokenHash: link, expiresAt: new Date("2099-01-01"),
        } });
        const enqueue = async (scheduleId: number, employee: typeof first, linkId: string, manual = false) => prepared(await job(linkRule, customer, {
            employeeScheduleId: scheduleId, recipientPhone: employee.phone,
            payload: { employeeId: employee.id, buttonUrl: `https://example.invalid/service-record/${linkId}` },
            ...(manual ? { dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary:manual:${randomUUID()}` } : {}),
        }));
        expect(await attempt(await enqueue(originalSchedule.id, first, link))).toBe("accepted");
        expect(await attempt(await enqueue(originalSchedule.id, first, link, true))).toBe("accepted");
        const reset = randomUUID();
        await db.raw.service_record_token.update({ where: { id: token.id }, data: { linkTokenHash: reset } });
        expect(await attempt(await enqueue(originalSchedule.id, first, reset))).toBe("blocked");

        await db.raw.employee_schedule.update({ where: { id: originalSchedule.id }, data: { primaryEmployeeId: second.id } });
        await db.raw.service_record_token.update({ where: { id: token.id }, data: { employeeId: second.id } });
        await expect(attempt(await enqueue(originalSchedule.id, first, reset))).rejects.toThrow("SMS occurrence source or recipient changed");
        expect(await attempt(await enqueue(originalSchedule.id, second, reset))).toBe("accepted");
        expect(await attempt(await enqueue(originalSchedule.id, second, reset))).toBe("blocked");

        await db.raw.service_record_token.update({ where: { id: token.id }, data: { scheduleId: nextSchedule.id } });
        expect(await attempt(await enqueue(nextSchedule.id, second, reset))).toBe("accepted");
        expect(await attempt(await enqueue(nextSchedule.id, second, reset))).toBe("blocked");
        expect(send).toHaveBeenCalledTimes(4);
        expect(await autoClaims()).toEqual(expect.arrayContaining([
            expect.objectContaining({ slot: `schedule:${originalSchedule.id}:gen:${token.id}`, recipientId: first.id }),
            expect.objectContaining({ slot: `schedule:${originalSchedule.id}:gen:${token.id}`, recipientId: second.id }),
            expect.objectContaining({ slot: `schedule:${nextSchedule.id}:gen:${token.id}`, recipientId: second.id }),
        ]));
    });

    it("T18 generates a normal service-record link job when a different employee takes the same schedule", async () => {
        const previous = await createEmployee(db.raw, tracker, { branchId });
        const replacement = await createEmployee(db.raw, tracker, { branchId, smsAutomationEnabled: true });
        await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        customer = await db.raw.client.update({ where: { id: customer.id }, data: {
            serviceStatus: "active", startDate: new Date(Date.now() - 86_400_000),
            endDate: new Date(Date.now() + 30 * 86_400_000), bookingConfirmedAt: new Date(),
        } });
        const schedule = await createEmployeeSchedule(db.raw, tracker, { clientId: customer.id, primaryEmployeeId: replacement.id }, {
            branchId, startDate: customer.startDate!, endDate: customer.endDate!,
        });
        const source = await db.raw.message_trigger_rule.upsert({
            where: { id: SERVICE_RECORD_LINK_RULE_ID },
            create: { id: SERVICE_RECORD_LINK_RULE_ID, name: "record", eventType: SERVICE_START, offsetType: "SAME_DAY",
                recipientType: PRIMARY_EMPLOYEE, templateKey: SERVICE_RECORD_LINK },
            update: {},
        });
        const previousJob = await job(source, customer, {
            employeeScheduleId: schedule.id, recipientPhone: previous.phone, status: "sent",
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${schedule.id}:primary`,
            payload: { employeeId: previous.id },
        });
        await createMessageLog(db.raw, tracker, { branchId, clientId: customer.id,
            templateKey: SERVICE_RECORD_LINK_SMS_LOG_TEMPLATE_KEY, triggerJobId: previousJob.id,
            receiver: previous.phone!, providerAcceptanceState: "accepted", providerAcceptedAt: new Date(), status: "sent" });
        const linkToken = randomUUID();
        await db.raw.service_record_token.create({ data: {
            branchId, scheduleId: schedule.id, employeeId: replacement.id, expectedPhoneHash: "fixture",
            linkTokenHash: linkToken, expiresAt: new Date("2099-01-01"),
        } });
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const service = new ServiceRecordLinkService(db.service, { reuseActiveLink: async () => ({ linkToken }) } as never,
            { get: () => "https://example.invalid" } as never, jobs, logs, {} as never, undefined, undefined,
            new MessageAutomationBranchLockService(db.service), { getTriggerDispatchEnabled: async () => true } as never);
        expect(await service.scheduleForServiceStart(schedule.id)).toBe(true);
        const scheduled = await db.raw.message_trigger_job.findFirstOrThrow({ where: { branchId, employeeScheduleId: schedule.id, status: "pending" } });
        tracker.track("message_trigger_job", scheduled.id);
        expect(scheduled.dedupeKey).toBe(serviceRecordAutomaticJobKey(schedule.id, replacement.id));
        expect(await service.scheduleForServiceStart(schedule.id)).toBe(false);
        expect(await worker().dispatch(scheduled.id)).toMatchObject({ status: "sent" });
        expect(await providerStartsFor([scheduled.id])).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("creates work during a manual uncertainty and only skips accepted work at generation", async () => {
        send.mockResolvedValueOnce("uncertain");
        const uncertain = await prepared();
        expect(await attempt(uncertain)).toBe("uncertain");
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const created = await jobs.create(pendingEntity());
        tracker.track("message_trigger_job", created.id);
        expect(created.status).toBe("pending");
        await reconcile(uncertain, "not-delivered");
        expect(await attempt(await prepared(await db.raw.message_trigger_job.findUniqueOrThrow({ where: { id: created.id } })))).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(2);
        const suppressed = await jobs.create(pendingEntity());
        tracker.track("message_trigger_job", suppressed.id);
        expect(suppressed).toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED });
    });

    it("uses transaction-local acceptance for fresh, pending-conflict and claimed-conflict upserts", async () => {
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const disjoint = await ruleInGroup();
        const pending = await job();
        await db.raw.message_trigger_job.update({ where: { id: pending.id }, data: { nextAttemptAt: new Date() } });
        const claimed = await job();
        const claimToken = randomUUID();
        await db.raw.message_trigger_job.update({ where: { id: claimed.id },
            data: { status: "processing", claimToken, processingDeadlineAt: new Date(Date.now() + 60_000) } });
        const proof = await prepared(await job());
        const admitted = await boundary.beginProviderCall(MessageLogMapper.toDomain(proof));
        admitted.providerAcceptanceState = "accepted";
        admitted.providerAcceptedAt = new Date();
        admitted.status = "sent";
        const freshKey = randomUUID();
        await db.service.$transaction(async transaction => {
            await logs.update(admitted, transaction);
            expect(await jobs.hasAcceptedOccurrence(pendingEntity(), transaction)).toBe(true);
            expect(await jobs.hasAcceptedOccurrence(pendingEntity(undefined, disjoint), transaction)).toBe(false);
            const insert = await jobs.upsertPendingForRuleGeneration(pendingEntity(freshKey), rule.updatedAt, rule.jobsStale, true, transaction);
            const conflict = await jobs.upsertPendingForRuleGeneration(pendingEntity(pending.dedupeKey), rule.updatedAt, rule.jobsStale, true, transaction);
            const protectedJob = await jobs.upsertPendingForRuleGeneration(pendingEntity(claimed.dedupeKey), rule.updatedAt, rule.jobsStale, true, transaction);
            expect(insert).toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED });
            expect(conflict).toMatchObject({ id: pending.id, status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED, nextAttemptAt: null });
            expect(protectedJob).toMatchObject({ id: claimed.id, status: "processing", claimToken });
        });
        const inserted = await db.raw.message_trigger_job.findUniqueOrThrow({ where: { dedupeKey: freshKey } });
        tracker.track("message_trigger_job", inserted.id);
        expect(inserted).toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED, nextAttemptAt: null });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: pending.id } }))
            .toMatchObject({ status: "canceled", cancelReason: OCCURRENCE_ALREADY_ACCEPTED, nextAttemptAt: null });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: claimed.id } })).toMatchObject({ status: "processing", claimToken });
    });

    it.each([false, true])("preserves a sender-denied job after reapproval with preserveExisting=%s", async preserveExisting => {
        const jobs = new SbMessageTriggerJobRepository(db.service);
        const prior = await job(rule, customer, { status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON });
        await db.raw.branch.update({ where: { id: branchId }, data: { smsSenderApprovalStatus: "approved" } });
        const result = await jobs.upsertPendingForRuleGeneration(pendingEntity(prior.dedupeKey), rule.updatedAt, rule.jobsStale, preserveExisting);
        expect(result).toMatchObject({ id: prior.id, status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON });
        expect(await db.raw.message_trigger_job.findUnique({ where: { id: prior.id } }))
            .toMatchObject({ status: "canceled", cancelReason: MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON });
    });

    it("keeps the per-log fence for concurrent catch-ups of a body-only job", async () => {
        expect(await attempt(await prepared())).toBe("accepted");
        const scheduled = await job(rule, customer, { payload: { templateVariables: { triggerType: "agent_scheduled" }, messageBody: "stored text" } });
        const row = await prepared(scheduled, { messageBody: "stored text" });
        expect(await Promise.all([attempt(row), attempt(row)])).toEqual(expect.arrayContaining(["accepted", "duplicate"]));
        expect(await autoClaims()).toEqual([]);
        expect(send).toHaveBeenCalledTimes(2);
    });
});
