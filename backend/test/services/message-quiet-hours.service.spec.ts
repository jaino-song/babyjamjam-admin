import type { Prisma } from "@prisma/client";
import { SystemSettingService } from "application/services/system-setting.service";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";

describe("final quiet admission settings transaction", () => {
    it("forwards the acquired transaction to policy and effective-order reads", async () => {
        const transaction = {} as Prisma.TransactionClient;
        const configuration = { ...defaultMessageAutomationPolicy(), pastRuleOrder: ["rule-a"] };
        const execute = jest.fn(async () => JSON.stringify(configuration));
        const rules = { findAll: jest.fn(async () => [{ id: "rule-a", branchId: "branch-a", isActive: true, templateKey: MessageTriggerTemplateKey.SERVICE_INFO }]) };
        const jobs = { findPolicyRuleBranchOverrides: jest.fn(async () => []) };
        const activation = { getTriggerDispatchEnabled: jest.fn(async () => true) };
        const settings = new SystemSettingService({ execute } as unknown as GetSettingUsecase, {} as UpdateSettingUsecase,
            undefined, activation as never, rules as never, jobs as never);
        const result = await settings.getMessageAutomationPolicyConfig("branch-a", transaction);
        expect(result.configuration.pastRuleOrder).toEqual(["rule-a"]);
        expect(execute).toHaveBeenCalledWith("branch:branch-a:message_automation:policy", transaction);
        expect(rules.findAll).toHaveBeenCalledWith("branch-a", transaction);
        expect(jobs.findPolicyRuleBranchOverrides).toHaveBeenCalledWith("branch-a", transaction);
        expect(activation.getTriggerDispatchEnabled).toHaveBeenCalledWith("branch-a", transaction);
    });
});

import { ConflictException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { Request, Response } from "express";
import { MessageQuietHoursService, MessageQuietHoursUnavailableError, runSmsQuietHoursAdmission } from "application/services/message-quiet-hours.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { MessageAutomationActivationService } from "application/services/message-automation-activation.service";
import { SmsAutomationSafeguardService } from "application/services/sms-automation-safeguard.service";
import { SmsProviderAcceptanceService } from "application/services/sms-provider-acceptance.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { MessageDuplicateCheckService } from "application/services/message-duplicate-check.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";
import { SbMessageLogRepository } from "infrastructure/database/repositories/sb.message-log.repository";
import { mapHttpProblem } from "infrastructure/filters/problem-response";

const PHONE = "01000000011";
const NIGHT = "2026-11-03T13:00:00.000Z";
function boundaryFixture() {
    let active = false;
    const policy = defaultMessageAutomationPolicy();
    Object.assign(policy.quietHours, { enabled: true, action: "CANCEL" });
    const rows = [{ branchId: "branch-a", phone: PHONE, group_name: "CLIENT" }];
    const events: string[] = [];
    let stored: MessageTriggerJobEntity | null = null;
    let beforeLock: (() => Promise<void>) | undefined;
    let transactionTail = Promise.resolve();
    const db = {
        $executeRaw: jest.fn(async () => { events.push("lock"); await beforeLock?.(); return 1; }),
        $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
            const previous = transactionTail;
            let release!: () => void;
            transactionTail = new Promise<void>(resolve => { release = resolve; });
            await previous;
            expect(active).toBe(false); active = true;
            try { return await work(db as unknown as Prisma.TransactionClient); } finally { active = false; events.push("commit"); release(); }
        },
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            if (sql.sql.includes('FROM "message_trigger_rule"')) return [{ id: "rule-auto", branch_id: "branch-a", is_active: true, template_key: "SERVICE_INFO", target_client_status: "all", retry_on_failure: true }];
            if (sql.sql.includes('FROM "message_trigger_job"')) return [{ id: stored?.id, branch_id: "branch-a", rule_id: "rule-auto", status: "failed", dedupe_key: stored?.dedupeKey }];
            expect(sql.values).toContain("branch-a");
            expect(sql.values).not.toContain("branch-b");
            return rows.filter(row => sql.values.includes(row.branchId));
        }),
        system_setting: { findUnique: jest.fn(async () => ({ value: "true" })) },
        client: { findFirst: jest.fn(async () => ({ id: 7, name: "합성 고객", phone: PHONE, smsAutomationEnabled: true, deletedAt: null })) },
        employee: { findFirst: jest.fn(async () => null) },
        message_trigger_rule: { findFirst: jest.fn(async () => ({ id: "rule-auto", isActive: true, branchId: "branch-a" })) },
        message_trigger_job: {
            findUnique: jest.fn(async () => stored ? { ...structuredClone(stored), rule: { id: "rule-auto" } } : null),
            findFirst: jest.fn(async () => stored ? structuredClone(stored) : null),
        },
        message_log: {
            create: jest.fn(async ({ data }: { data: object }) => ({ ...data, id: 42 })),
            update: jest.fn(async ({ data }: { data: object }) => ({ ...data, id: 42 })),
            updateMany: jest.fn(async () => { expect(active).toBe(true); events.push("cas"); return { count: 1 }; }),
        },
    };
    const execute = jest.fn(async () => { events.push("policy"); return JSON.stringify(policy); });
    const settings = new SystemSettingService({ execute } as unknown as GetSettingUsecase, {} as UpdateSettingUsecase);
    const lock = new MessageAutomationBranchLockService(db as never);
    const repository = new SbMessageLogRepository(db as never);
    const logs: MessageLogEntity[] = [];
    const save = jest.fn(async (log: MessageLogEntity) => { Object.assign(log, { id: logs.length + 1 }); logs.push(log); return log; });
    const update = jest.fn(async (log: MessageLogEntity) => log);
    Object.assign(repository, { save, update,
        prepareProviderAttempt: save,
        claimProviderAttempt: jest.fn(async (log: MessageLogEntity, tx: unknown) => {
            expect(active).toBe(true); expect(tx).toBe(db); expect(log.providerAcceptanceState).toBe("prepared");
            events.push("cas"); log.markProviderCallStarted(); return log;
        }),
        startRetryAttempt: jest.fn(async (_source: MessageLogEntity, draft: MessageLogEntity) => ({ kind: "started", log: await save(draft) })),
        findByIdInBranch: jest.fn(async (_branch: string, id: number) => logs.find(log => log.id === id)),
        findRetryFamilyInBranch: jest.fn(async () => logs),
        hasNewerServiceRecordSmsInBranch: jest.fn(async () => false),
        findServiceRecordLinkClientState: jest.fn(async () => null),
    });
    const quiet = new MessageQuietHoursService(settings, repository, lock);
    const acceptance = new SmsProviderAcceptanceService(repository);
    const aligo = { sendSms: jest.fn(async (request: { receiver: string }) => {
        expect(active).toBe(false); events.push("provider");
        return { request, response: { result_code: 1, message: "성공", msg_id: 9876, success_cnt: 1, error_cnt: 0 } };
    }) };
    const approval = { ensureApproved: jest.fn(async () => {}) };
    return { db, policy, rows, events, execute, settings, lock, repository, logs, save, update, quiet, acceptance, aligo, approval,
        store: (job: MessageTriggerJobEntity) => { stored = structuredClone(job); },
        setBeforeLock: (callback: () => Promise<void>) => { beforeLock = callback; }, active: () => active };
}

function manualController(f: ReturnType<typeof boundaryFixture>, quiet: MessageQuietHoursService | undefined = f.quiet) {
    const duplicates = new MessageDuplicateCheckService(f.repository,
        { getMessageSettingsPolicyEnabled: async () => false } as never, {} as never);
    return new MessageDeliveryController(f.aligo as never, f.approval as never, f.db as never, duplicates, quiet);
}
function manualJob(kind: "agent" | "admin" | "automatic") {
    const job = MessageTriggerJobEntity.create({ branchId: "branch-a", ruleId: kind === "agent" ? "agent-sms:test" : kind === "admin" ? "system:service_record_link" : "rule-auto",
        scheduledFor: new Date("2026-11-03T12:00:00Z"), clientId: 7, recipientType: MessageTriggerRecipientType.CLIENT, recipientPhone: PHONE,
        templateKey: kind === "admin" ? MessageTriggerTemplateKey.SERVICE_RECORD_LINK : MessageTriggerTemplateKey.SERVICE_INFO,
        dedupeKey: kind === "admin" ? "system:service_record_link:schedule:91:primary:manual:55000000-0000-4000-8000-000000000001" : "test-dedupe",
        payload: { clientId: 7, memberId: "7", recipientName: "합성 고객", recipientPhone: PHONE, messageBody: "합성 본문",
            templateVariables: { triggerType: "agent_scheduled" } } });
    Object.assign(job, { id: "55000000-0000-4000-8000-000000000099", status: "dispatching", claimToken: "claim-a" }); return job;
}
function triggerService(f: ReturnType<typeof boundaryFixture>, withGuard = true) {
    const gate = new AgentAutomationDeliveryGateService(f.db as never, f.lock, {} as never);
    return new SmsTriggerDeliveryService(f.aligo as never, {} as never, f.repository, f.acceptance, undefined, gate, undefined, f.settings, undefined, withGuard ? f.quiet : undefined);
}
function retryFixture(f: ReturnType<typeof boundaryFixture>, automatic = false, withGuard = true) {
    const source = MessageLogEntity.create({ branchId: "branch-a", provider: "aligo_sms", templateKey: "client_greeting_sms", receiver: PHONE,
        clientId: 7, messageBody: "합성 본문", variables: {} });
    Object.assign(source, { id: 101, status: "failed", attempts: 1, nextRetryAt: new Date(NIGHT) }); f.logs.push(source);
    const activation = new MessageAutomationActivationService(f.db as never, f.lock, {} as never);
    if (automatic) { const job = manualJob("automatic"); job.status = "failed"; f.store(job); source.triggerJobId = job.id; }
    const safeguard = new SmsAutomationSafeguardService(f.db as never, activation);
    const retry = new SmsRetryService(f.repository, f.aligo as never, f.approval as never, f.acceptance, automatic ? activation : undefined,
        undefined, undefined, undefined, safeguard, f.settings, withGuard ? f.quiet : undefined);
    return { source, retry };
}

describe("NIGHT-1 final SMS/LMS admission", () => {
    beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)); });
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ["2026-11-03T12:59:00.000Z", "ALLOW"], ["2026-11-03T13:00:00.000Z", "CANCEL"],
        ["2026-11-03T22:59:00.000Z", "CANCEL"], ["2026-11-03T23:00:00.000Z", "ALLOW"],
    ])("overnight literal %s => %s", async (at, action) => {
        jest.mocked(Date.now).mockReturnValue(Date.parse(at)); const f = boundaryFixture();
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe(action);
    });
    it.each([["2026-11-03T23:59:00Z", "ALLOW"], ["2026-11-04T00:00:00Z", "CANCEL"],
        ["2026-11-04T08:59:00Z", "CANCEL"], ["2026-11-04T09:00:00Z", "ALLOW"]])("same-day literal %s => %s", async (at, action) => {
        jest.mocked(Date.now).mockReturnValue(Date.parse(at)); const f = boundaryFixture(); Object.assign(f.policy.quietHours, { start: "09:00", end: "18:00" });
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe(action);
    });
    it.each([["STAFF", "ALLOW"], ["CAREGIVER", "ALLOW"], ["CLIENT", "CANCEL"]])("customer-only policy with %s => %s", async (group, action) => {
        const f = boundaryFixture(); f.policy.quietHours.recipientGroups = ["CLIENT"]; f.rows[0]!.group_name = group;
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe(action);
    });
    it("unions customer and staff on the exact phone, while branch B cannot contaminate branch A", async () => {
        const f = boundaryFixture(); f.policy.quietHours.recipientGroups = ["STAFF"]; f.rows.push({ branchId: "branch-b", phone: PHONE, group_name: "STAFF" });
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe("ALLOW");
        f.rows.push({ branchId: "branch-a", phone: PHONE, group_name: "STAFF" });
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe("CANCEL");
        f.policy.quietHours.recipientGroups = ["CLIENT"];
        expect(await f.quiet.runAdmission("branch-a", PHONE, async decision => decision.action)).toBe("CANCEL");
    });
    it.each(["controller", "agent", "admin", "manual-retry", "automatic-retry"] as const)("%s CANCEL terminal/provider0, matching allowed and OFF/provider1", async path => {
        for (const mode of ["CANCEL", "allowed", "OFF"]) {
            const f = boundaryFixture();
            if (mode === "allowed") Object.assign(f.policy.quietHours, { start: "23:00", end: "08:00" });
            if (mode === "OFF") f.policy.quietHours.enabled = false;
            if (path === "controller") {
                const result = manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문", msgType: "LMS" });
                if (mode === "CANCEL") {
                    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
                    expect(f.db.message_log.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", nextRetryAt: null, errorMessage: "message_quiet_hours:CANCEL", variables: expect.objectContaining({ quietHoursDisposition: "CANCEL" }) }) }));
                } else await result;
            } else if (path === "agent" || path === "admin") {
                const job = manualJob(path); f.store(job);
                expect(await triggerService(f).sendJob(job)).toBe(mode !== "CANCEL");
                if (mode === "CANCEL") {
                    expect(job).toMatchObject({ status: "canceled", nextAttemptAt: null, cancelReason: "message_quiet_hours:CANCEL" });
                    expect(f.logs[0]).toMatchObject({ status: "failed", attempts: 0, nextRetryAt: null, providerAcceptanceState: "prepared", providerCallStartedAt: null,
                        variables: expect.objectContaining({ quietHoursDisposition: "CANCEL" }) });
                }
            } else {
                const { source, retry } = retryFixture(f, path === "automatic-retry");
                const result = await retry.retry(source, path === "automatic-retry" ? "automatic" : "manual");
                if (mode === "CANCEL") {
                    expect(result).toMatchObject({ status: "failed", nextRetryAt: null, providerCallStartedAt: null, variables: expect.objectContaining({ quietHoursDisposition: "CANCEL" }) });
                    expect(source.attempts).toBe(1);
                    expect(await retry.retry(source, "automatic")).toBe(source);
                    await expect(retry.retryById("branch-a", source.id)).rejects.toBeInstanceOf(ConflictException);
                }
            }
            expect(f.aligo.sendSms).toHaveBeenCalledTimes(mode === "CANCEL" ? 0 : 1);
            if (mode !== "CANCEL") expect(f.events.slice(-3)).toEqual(["cas", "commit", "provider"]);
        }
    });

    it.each(["policy", "recipient"])("%s lookup failure is sanitized and never starts the provider", async kind => {
        const f = boundaryFixture(); if (kind === "policy") f.execute.mockRejectedValue(new Error("private policy secret"));
        else f.db.$queryRaw.mockRejectedValue(new Error("private recipient secret"));
        const error = await manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" }).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(MessageQuietHoursUnavailableError);
        const mapped = mapHttpProblem(error as HttpException, { method: "POST", headers: {}, url: "/message-deliveries/sms" } as Request, { locals: { errorRequestId: "quiet-request" }, getHeader: () => undefined } as unknown as Response);
        expect(mapped).toMatchObject({ code: "MESSAGE_SEND_NOT_STARTED", outcome: "NOT_APPLIED", recovery: { action: "NONE", retry: { mode: "NEVER" } } });
        expect(JSON.stringify(mapped)).not.toContain("private"); expect(JSON.stringify(mapped)).not.toContain(PHONE);
        expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.db.message_log.updateMany).not.toHaveBeenCalled();
    });
    it("missing quiet guard refuses ON and corrupt reads but accepts only schema-valid explicit OFF direct builders", async () => {
        const f = boundaryFixture(); const work = jest.fn(async () => "admitted");
        await expect(runSmsQuietHoursAdmission(undefined, f.settings, "branch-a", PHONE, work)).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        f.policy.quietHours.enabled = false;
        expect(await runSmsQuietHoursAdmission(undefined, f.settings, "branch-a", PHONE, work)).toBe("admitted");
        f.execute.mockResolvedValue("{}");
        await expect(runSmsQuietHoursAdmission(undefined, f.settings, "branch-a", PHONE, work)).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        f.execute.mockRejectedValue(new Error("read unavailable"));
        await expect(runSmsQuietHoursAdmission(undefined, f.settings, "branch-a", PHONE, work)).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        expect(work).toHaveBeenCalledTimes(1);
    });
    it("reads policy and actual clock after waiting for the acquired branch lock", async () => {
        const f = boundaryFixture(); jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T12:59:00Z"));
        f.policy.quietHours.enabled = false;
        f.setBeforeLock(async () => { f.policy.quietHours.enabled = true; jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T13:00:00Z")); });
        await expect(manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" })).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(f.events).toEqual(["lock", "policy", "cas", "commit"]); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("DEFER is an honest intermediate refusal with no provider start or release-queue claim", async () => {
        const f = boundaryFixture(); f.policy.quietHours.action = "DEFER";
        const job = manualJob("agent"); f.store(job);
        expect(await triggerService(f).sendJob(job)).toBe(false);
        expect(job).toMatchObject({ status: "failed", nextAttemptAt: null, cancelReason: "message_quiet_hours:DEFER" });
        expect(f.logs[0]).toMatchObject({ status: "failed", attempts: 0, nextRetryAt: null, providerAcceptanceState: "prepared", providerCallStartedAt: null, variables: expect.objectContaining({ quietHoursDisposition: "DEFER" }) });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
});

import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { CaregiverTemplateResolverService } from "application/services/caregiver-template-resolver.service";
import { MessageTriggerRecipientResolverService } from "application/services/message-trigger-recipient-resolver.service";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerEventType, MessageTriggerOffsetType } from "domain/constants/message-trigger-catalog";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
const branchId = "33000000-0000-4000-8000-000000000001";
const incarnationId = "44000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-03T12:00:00.000Z");
function fixture() {
    const employee = (id: number, name: string, phone: string) => ({ id, branchId, name, phone, deletedAt: null, smsAutomationEnabled: true });
    const client = { id: 7, branchId, name: "합성 고객", phone: null, createdAt: new Date("2026-10-01T00:00:00Z"), deletedAt: null,
        serviceStatus: "waiting", startDate: new Date("2026-12-01T00:00:00Z"), endDate: new Date("2026-12-31T00:00:00Z"), bookingConfirmedAt: new Date("2026-10-02T00:00:00Z") };
    const schedule = { id: 91, incarnationId, branchId, clientId: 7, replaced: false, terminatedAt: null,
        startDate: new Date("2026-11-10T00:00:00Z"), endDate: new Date("2026-11-20T00:00:00Z"), primaryEmployeeId: 11, secondaryEmployeeId: 12,
        primaryEmployee: employee(11, "합성 주", "01000000011"), secondaryEmployee: employee(12, "합성 보조", "01000000012") };
    const branch = { id: branchId, name: "합성 지점", systemTemplateSnapshot: null as unknown };
    const database = { client: { findFirst: jest.fn(async () => client) }, branch: { findUnique: jest.fn(async () => branch) },
        employee_schedule: { findMany: jest.fn(async () => [schedule]) }, system_template: { findUnique: jest.fn(() => { throw new Error("global fallback forbidden"); }) } };
    const source = new ClientAutomationSourceReader(database as never, {} as never, {} as never, {} as never);
    const templates = new CaregiverTemplateResolverService(database as never);
    const groups = { findGroup: jest.fn(async () => ({ id: "group-a", version: 3 })) };
    const resolver = new MessageTriggerRecipientResolverService(source, templates, groups as never);
    const rules = [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE].map((recipientType) => {
        const rule = MessageTriggerRuleEntity.create({ branchId, name: "배정 시작", groupId: "group-a", isActive: true, eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.BEFORE_DAYS, offsetDays: 3, sendTime: "10:30", recipientType, templateKey: MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE });
        Object.assign(rule, { id: recipientType === "PRIMARY_EMPLOYEE" ? "child-primary" : "child-secondary" }); return rule;
    });
    const resolve = () => resolver.resolve(branchId, 7, rules, undefined, { now });
    return { client, branch, schedule, database, source, templates, groups, resolver, rules, resolve };
}

async function automaticFixture(event: "START" | "END" = "START", role = 0, distinct = false) {
    const f = fixture();
    if (event === "END") for (const rule of f.rules) { rule.eventType = MessageTriggerEventType.SERVICE_END; rule.templateKey = MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE; }
    if (distinct) { f.rules[0]!.templateKey = MessageTriggerTemplateKey.CAREGIVER_SERVICE_START_NOTICE; f.rules[1]!.templateKey = MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE; }
    const resolved = await f.resolve();
    const job = MessageTriggerJobEntity.create(resolved.recipients[role]!.recipe!);
    Object.assign(job, { id: "55000000-0000-4000-8000-000000000001" });
    let stored = structuredClone(job);
    const rows: unknown[] = [];
    const db = Object.assign(f.database, {
        $executeRaw: jest.fn(async () => 1),
        $transaction: async <T>(work: (transaction: typeof db) => Promise<T>): Promise<T> => work(db),
        message_log: { updateMany: jest.fn(async () => ({ count: 1 })) },
        message_trigger_job: {
            findMany: jest.fn(async () => rows),
            findFirst: jest.fn(async ({ where }: { where: { id?: string; status?: string; claimToken?: string } }) =>
                (!where.id || where.id === stored.id) && (!where.status || where.status === stored.status)
                    && (!where.claimToken || where.claimToken === stored.claimToken) ? structuredClone(stored) : null),
            updateMany: jest.fn(async ({ where, data }: { where: { status?: string; claimToken?: string }; data: Partial<typeof stored> }) => {
                if (where.status && where.status !== stored.status || where.claimToken && where.claimToken !== stored.claimToken) return { count: 0 };
                Object.assign(stored, structuredClone(data)); return { count: 1 };
            }),
        },
    });
    Object.assign(db.employee_schedule, { findFirst: jest.fn(async () => f.schedule) });
    jest.spyOn(f.source, "readClientAutomationSettings").mockResolvedValue({ status: "available", rules: f.rules, defaultsPresent: true,
        dispatchEnabled: true, senderApproved: true, senderApprovedAt: null, pastTriggerEnabled: true,
        pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] } });
    const lock = new MessageAutomationBranchLockService(db as never);
    const records = new AgentAutomationRecordStoreService(lock);
    const authority = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(records), f.source,
        { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) } as never, undefined, f.resolver);
    const gate = new AgentAutomationDeliveryGateService(db as never, lock, authority);
    const aligo = { sendSms: jest.fn(async (request: { receiver: string }) => ({ response: { result_code: 1, message: "성공", msg_id: 9876, success_cnt: 1, error_cnt: 0 }, request })) };
    const logs = { save: jest.fn(async (log: unknown) => log), update: jest.fn(async (log: unknown) => log),
        resolvePolicyRecipientGroups: async (_branch: string, candidates: Array<{ recipientGroups: string[] }>) => candidates.map(candidate => ({ ...candidate, recipientGroups: ["CAREGIVER"] })) };
    const quietPolicy = defaultMessageAutomationPolicy();
    Object.assign(quietPolicy.quietHours, { enabled: true, action: "CANCEL" });
    const settings = new SystemSettingService({ execute: async () => JSON.stringify(quietPolicy) } as never, {} as never);
    const quiet = new MessageQuietHoursService(settings, logs as never, lock);
    const service = new SmsTriggerDeliveryService(aligo as never, {} as never, logs as never, undefined, undefined, gate, undefined,
        settings, f.templates, quiet);
    const render = (candidate: MessageTriggerJobEntity, transaction: Parameters<typeof service.resolveCanonicalDeliverySnapshot>[1]) => service.resolveCanonicalDeliverySnapshot(candidate, transaction);
    const store = () => { stored = structuredClone(job); };
    const start = async () => { job.markProcessing("claim-caregiver"); store(); return gate.authorizePreparation(job, render as never, async () => ({ kind: "allow" })); };
    const dispatch = async () => {
        const preparation = await service.prepareJob(job);
        if (!preparation) return false;
        store();
        const authorized = await gate.authorizeDispatch(job, preparation, render as never, async (transaction) => {
            const changed = await transaction.message_trigger_job.updateMany({ where: { id: job.id, branchId, status: "processing", claimToken: job.claimToken }, data: { status: "dispatching" } });
            return changed.count === 1 ? { kind: "allow" } : { kind: "lost" };
        });
        if (authorized.kind !== "allow") return false;
        job.status = "dispatching";
        return service.sendPreparedJob(job, preparation);
    };
    return { ...f, job, db, gate, authority, records, service, aligo, logs, start, dispatch, store, quietPolicy };
}


describe("NIGHT-1 current caregiver source and final authority", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)));
    afterEach(() => jest.restoreAllMocks());
    it.each(["CANCEL", "allowed", "OFF"])("keeps actual caregiver authority while final quiet policy is %s", async mode => {
        const f = await automaticFixture();
        if (mode === "allowed") f.quietPolicy.quietHours.recipientGroups = ["CLIENT"];
        if (mode === "OFF") f.quietPolicy.quietHours.enabled = false;
        expect(await f.start()).toEqual({ kind: "allow" });
        expect(await f.dispatch()).toBe(mode !== "CANCEL");
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(mode === "CANCEL" ? 0 : 1);
        if (mode === "CANCEL") expect(f.job).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL", nextAttemptAt: null });
    });
    it.each(["opt-out", "changed-assignment", "disabled-rule"])("quiet OFF cannot bypass current authority: %s", async refusal => {
        const f = await automaticFixture(); f.quietPolicy.quietHours.enabled = false;
        expect(await f.start()).toEqual({ kind: "allow" });
        if (refusal === "opt-out") f.schedule.primaryEmployee.smsAutomationEnabled = false;
        if (refusal === "changed-assignment") { f.schedule.primaryEmployeeId = 999; f.schedule.primaryEmployee.id = 999; }
        if (refusal === "disabled-rule") f.rules[0]!.isActive = false;
        expect(await f.dispatch()).toBe(false);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
});

import { SystemSettingEntity } from "domain/entities/system-setting.entity";

describe("NIGHT-1 final-boundary failures and serialization", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)));
    afterEach(() => jest.restoreAllMocks());
    it("actual missing settings policy retains OFF 22-08/all three groups/DEFER without a class-instance requirement", async () => {
        const settings = new SystemSettingService({ execute: async () => null } as never, {} as never);
        expect((await settings.getMessageAutomationPolicyConfig("branch-a")).configuration.quietHours).toEqual({
            enabled: false, start: "22:00", end: "08:00", recipientGroups: ["CLIENT", "CAREGIVER", "STAFF"], action: "DEFER", timezone: "Asia/Seoul",
        });
        const shapedSettings = { getMessageAutomationPolicyConfig: async () => ({ configuration: defaultMessageAutomationPolicy() }) };
        expect(await runSmsQuietHoursAdmission(undefined, shapedSettings as never, "branch-a", PHONE, async decision => decision.action)).toBe("ALLOW");
    });
    it.each(["controller", "agent", "admin", "manual-retry", "automatic-retry"] as const)("missing quiet dependency cannot bypass actual ON on %s", async path => {
        const f = boundaryFixture(); let send: Promise<unknown>;
        if (path === "controller") send = new MessageDeliveryController(f.aligo as never, f.approval as never, f.db as never,
            new MessageDuplicateCheckService(f.repository, { getMessageSettingsPolicyEnabled: async () => false } as never, {} as never))
            .sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" });
        else if (path === "agent" || path === "admin") { const job = manualJob(path); f.store(job); send = triggerService(f, false).sendJob(job); }
        else { const { retry, source } = retryFixture(f, path === "automatic-retry", false); send = retry.retry(source, path === "automatic-retry" ? "automatic" : "manual"); }
        await expect(send).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.repository.claimProviderAttempt).not.toHaveBeenCalled();
    });
    it.each(["agent", "admin", "manual-retry", "automatic-retry"] as const)("recipient lookup failure refuses %s before provider CAS", async path => {
        const f = boundaryFixture(); jest.spyOn(f.repository, "resolvePolicyRecipientGroups").mockRejectedValue(new Error("private recipient failure"));
        let send: Promise<unknown>;
        if (path === "agent" || path === "admin") { const job = manualJob(path); f.store(job); send = triggerService(f).sendJob(job); }
        else { const { retry, source } = retryFixture(f, path === "automatic-retry"); send = retry.retry(source, path === "automatic-retry" ? "automatic" : "manual"); }
        await expect(send).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.repository.claimProviderAttempt).not.toHaveBeenCalled();
    });
    it("serializes a canceled manual request through the actual public problem mapper", async () => {
        const f = boundaryFixture();
        const error = await manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" }).catch((error: unknown) => error);
        const problem = mapHttpProblem(error, { method: "POST", headers: {}, url: "/message-deliveries/sms" } as Request,
            { locals: { errorRequestId: "quiet-cancel" }, getHeader: () => undefined } as unknown as Response);
        expect(problem).toMatchObject({ code: "MESSAGE_SEND_NOT_STARTED", status: 503, outcome: "NOT_APPLIED", operationId: "42", recovery: { action: "NONE", retry: { mode: "NEVER" } } });
        expect(JSON.stringify(problem)).not.toContain(PHONE);
        expect(JSON.stringify(problem)).not.toContain("message_quiet_hours");
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("lost provider-start CAS still refuses an otherwise allowed policy", async () => {
        const f = boundaryFixture(); f.policy.quietHours.enabled = false;
        jest.mocked(f.repository.claimProviderAttempt).mockResolvedValue(null);
        const job = manualJob("agent"); f.store(job);
        await expect(triggerService(f).sendJob(job)).rejects.toBeInstanceOf(ConflictException);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["trigger", "retry"])("a stale prepared %s cannot cancel an already admitted in-flight attempt", async path => {
        const f = boundaryFixture();
        f.db.message_log.updateMany.mockResolvedValue({ count: 0 });
        if (path === "trigger") {
            const job = manualJob("agent"); f.store(job);
            await expect(triggerService(f).sendJob(job)).rejects.toThrow("문자 발송 승인 상태를 확인해야 합니다");
            expect(job.status).toBe("dispatching");
        } else {
            const { retry, source } = retryFixture(f);
            await expect(retry.retry(source)).rejects.toBeInstanceOf(ConflictException);
            expect(source.variables["quietHoursDisposition"]).toBeUndefined();
        }
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.db.message_log.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerAcceptanceState: "prepared",
            providerAcceptanceKey: expect.any(String), providerAcceptanceFingerprint: expect.any(String) }) }));
        expect(f.db.message_log.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ providerAcceptanceState: "prepared" }) }));
    });
    it("terminal canceled acceptance rows cannot revive when policy becomes OFF", async () => {
        const f = boundaryFixture(); const job = manualJob("agent"); f.store(job); const delivery = triggerService(f);
        expect(await delivery.sendJob(job)).toBe(false);
        f.policy.quietHours.enabled = false;
        const replay = manualJob("agent"); f.store(replay);
        jest.spyOn(f.repository, "prepareProviderAttempt").mockResolvedValue(f.logs[0]!);
        expect(await delivery.sendJob(replay)).toBe(false);
        expect(replay.status).toBe("canceled"); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["policy-change", "clock-change"])("queued admission respects committed %s at the shared branch lock", async change => {
        const f = boundaryFixture(); f.policy.quietHours.enabled = change === "clock-change";
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T12:59:00Z"));
        let entered!: () => void; const writerEntered = new Promise<void>(resolve => { entered = resolve; });
        let release!: () => void; const writerRelease = new Promise<void>(resolve => { release = resolve; });
        const next = structuredClone(f.policy); next.quietHours.enabled = true;
        const executeIfVersion = jest.fn(async (key: string, value: string, _expected: string, _versionOf: unknown, _audit: unknown, tx: unknown) => {
            expect(tx).toBe(f.db); entered(); await writerRelease;
            Object.assign(f.policy, JSON.parse(value));
            return SystemSettingEntity.create(key, value);
        });
        const writer = new SystemSettingService({ execute: f.execute } as never, { executeIfVersion } as never, undefined, undefined,
            undefined, undefined, { countFutureProviderReservations: async () => 0 } as never, f.lock);
        const current = await writer.getMessageAutomationPolicyConfig("branch-a");
        const write = writer.setMessageAutomationPolicyConfig("branch-a", current.version, next);
        await writerEntered;
        const send = manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" });
        await Promise.resolve(); await Promise.resolve();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T13:00:00Z")); release();
        await write; await expect(send).rejects.toBeInstanceOf(ServiceUnavailableException);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.execute).toHaveBeenLastCalledWith("branch:branch-a:message_automation:policy", f.db);
    });
});
