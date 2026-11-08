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

import { ConflictException, HttpException } from "@nestjs/common";
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
    let manualLog: Record<string, any> | null = null;
    const matches = (value: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([key, expected]) => {
        if (expected && typeof expected === "object" && "equals" in expected) return JSON.stringify(value[key]) === JSON.stringify(expected.equals);
        if (expected instanceof Date) return value[key] instanceof Date && value[key].getTime() === expected.getTime();
        return value[key] === expected;
    });
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
        client: { findFirst: jest.fn(async () => ({ id: 7, name: "합성 고객", phone: PHONE, smsAutomationEnabled: true, deletedAt: null })),
            findMany: jest.fn(async () => [{ id: 7, name: "합성 고객", phone: PHONE }]) },
        employee: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
        message_trigger_rule: { findFirst: jest.fn(async () => ({ id: "rule-auto", isActive: true, branchId: "branch-a" })),
            upsert: jest.fn(async ({ create }: { create: object }) => ({ ...create, deletedAt: null, jobsStale: false })) },
        message_trigger_job: {
            create: jest.fn(async ({ data }: { data: object }) => {
                expect(active).toBe(true);
                stored = { ...structuredClone(data), id: "55000000-0000-4000-8000-000000000042", createdAt: new Date(NIGHT), updatedAt: new Date(NIGHT) } as MessageTriggerJobEntity;
                return structuredClone(stored);
            }),
            findUnique: jest.fn(async () => stored ? { ...structuredClone(stored), rule: { id: "rule-auto" } } : null),
            findFirst: jest.fn(async () => stored ? structuredClone(stored) : null),
            updateMany: jest.fn(async ({ data }: { data: Partial<MessageTriggerJobEntity> }) => {
                if (!stored) return { count: 0 };
                Object.assign(stored, structuredClone(data)); return { count: 1 };
            }),
        },
        message_log: {
            findMany: jest.fn(async () => []),
            findFirst: jest.fn(async ({ where }: { where: { id: number } }) => {
                if (manualLog && matches(manualLog, where)) return structuredClone(manualLog);
                const log = logs.find(candidate => candidate.id === where.id);
                return log ? structuredClone(log) : null;
            }),
            findUnique: jest.fn(async ({ where }: { where: { id?: number; providerAcceptanceKey?: string } }) => {
                if (manualLog && matches(manualLog, where)) return structuredClone(manualLog);
                const log = logs.find(candidate => candidate.id === where.id);
                return log ? structuredClone(log) : null;
            }),
            create: jest.fn(async ({ data }: { data: object }) => {
                manualLog = { triggerJobId: null, providerAcceptedAt: null, providerReconciledAt: null,
                    providerReconciledBy: null, providerReconciliationReason: null, aligoMid: null,
                    ...structuredClone(data), id: 42, createdAt: new Date(NIGHT), updatedAt: new Date(NIGHT) };
                return structuredClone(manualLog);
            }),
            update: jest.fn(async ({ data }: { data: object }) => ({ ...data, id: 42 })),
            updateMany: jest.fn(async (args?: { where: Record<string, any>; data: object }) => {
                expect(active).toBe(true); events.push("cas");
                if (manualLog) {
                    if (!args || !matches(manualLog, args.where)) return { count: 0 };
                    Object.assign(manualLog, structuredClone(args.data));
                }
                return { count: 1 };
            }),
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
        store: (job: MessageTriggerJobEntity) => { stored = structuredClone(job); }, manualLog: () => structuredClone(manualLog),
        setBeforeLock: (callback: () => Promise<void>) => { beforeLock = callback; }, active: () => active };
}

function manualController(f: ReturnType<typeof boundaryFixture>, quiet: MessageQuietHoursService | undefined = f.quiet) {
    const duplicates = new MessageDuplicateCheckService(f.repository,
        { getMessageSettingsPolicyEnabled: async () => false } as never, {} as never);
    return new MessageDeliveryController(f.aligo as never, f.approval as never, f.db as never, duplicates, quiet,
        new SbMessageTriggerJobRepository(f.db as never),
        { read: () => ({ availability: "available", provider: "aligo", mode: "stub", version: 1, identityDigest: "a".repeat(64) }) } as never);
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
    return new SmsTriggerDeliveryService(f.aligo as never, {} as never, f.repository, f.acceptance, undefined, gate, undefined, f.settings, undefined, withGuard ? f.quiet : undefined, new SbMessageTriggerJobRepository(f.db as never));
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
                    await expect(result).resolves.toMatchObject({ outcome: "canceled", items: [{ messageLogId: 42, status: "canceled" }] });
                    expect(f.manualLog()).toMatchObject({ status: "failed", attempts: 0, nextRetryAt: null, providerCallStartedAt: null,
                        errorMessage: "message_quiet_hours:CANCEL", variables: expect.objectContaining({ quietHoursDisposition: "CANCEL" }) });
                    expect(await f.db.message_trigger_job.findFirst()).toMatchObject({ status: "canceled", attempts: 0, nextAttemptAt: null, cancelReason: "message_quiet_hours:CANCEL" });
                    expect(f.db.message_log.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                        where: expect.objectContaining({ id: 42, branchId: "branch-a", triggerJobId: null, providerAcceptanceState: "prepared", providerCallStartedAt: null }),
                        data: { triggerJobId: "55000000-0000-4000-8000-000000000042" } }));
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
        await expect(manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" })).resolves.toMatchObject({ outcome: "canceled" });
        expect(f.events).toEqual(["lock", "policy", "lock", "policy", "cas", "commit"]); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("DEFER atomically holds attempt zero until 08:00 without starting the provider", async () => {
        const f = boundaryFixture(); f.policy.quietHours.action = "DEFER";
        const job = manualJob("agent"); f.store(job);
        expect(await triggerService(f).sendJob(job)).toBe(false);
        expect(job).toMatchObject({ status: "pending", attempts: 0, nextAttemptAt: new Date("2026-11-03T23:00:00.000Z"), claimToken: null, processingDeadlineAt: null });
        expect(job.scheduledFor.toISOString()).toBe("2026-11-03T12:00:00.000Z");
        expect(f.logs[0]).toMatchObject({ status: "pending", attempts: 0, nextRetryAt: null, providerAcceptanceState: "prepared", providerCallStartedAt: null, variables: expect.objectContaining({ quietHoursDisposition: "DEFER", quietHoursReleaseAt: "2026-11-03T23:00:00.000Z", quietHoursOriginalScheduledFor: "2026-11-03T12:00:00.000Z" }) });
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
    let storedAttempt: MessageLogEntity | undefined;
    const db = Object.assign(f.database, {
        $executeRaw: jest.fn(async () => 1),
        $transaction: async <T>(work: (transaction: typeof db) => Promise<T>): Promise<T> => work(db),
        message_log: { updateMany: jest.fn(async () => ({ count: 1 })),
            findUnique: jest.fn(async () => storedAttempt ? structuredClone(storedAttempt) : null) },
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
    const originalSave = logs.save.getMockImplementation()!;
    logs.save.mockImplementation(async log => { storedAttempt = log as MessageLogEntity; return originalSave(log); });
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
    it("serializes a canceled manual queue outcome without private operational metadata", async () => {
        const f = boundaryFixture();
        const result = await manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" });
        const response = JSON.parse(JSON.stringify(result));
        expect(response).toMatchObject({ provider: "aligo_sms", triggerType: "immediate", outcome: "canceled",
            items: [{ jobId: "55000000-0000-4000-8000-000000000042", messageLogId: 42, recipientPhone: PHONE,
                status: "canceled", scheduledAt: NIGHT, reason: "message_quiet_hours:CANCEL" }] });
        expect(response).not.toHaveProperty("result");
        expect(JSON.stringify(response)).not.toMatch(/manualRecipientBindings|manualQueueSenderIdentity|quietHoursPolicyRevision|합성 본문/);
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
            undefined, { findPolicyPreviewCandidates: async () => [] } as never, { countFutureProviderReservations: async () => 0, findPolicyPreviewCandidates: async () => [], resolvePolicyRecipientGroups: async (_branch: string, candidates: unknown[]) => candidates } as never, f.lock);
        const current = await writer.getMessageAutomationPolicyConfig("branch-a");
        const write = writer.setMessageAutomationPolicyConfig("branch-a", current.version, next);
        await writerEntered;
        const send = manualController(f).sendSms({ branchId: "branch-a" }, { receiver: PHONE, message: "합성 본문" });
        await Promise.resolve(); await Promise.resolve();
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T13:00:00Z")); release();
        await write; await expect(send).resolves.toMatchObject({ outcome: "canceled" });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.execute).toHaveBeenLastCalledWith("branch:branch-a:message_automation:policy", f.db);
    });
});

import { MessageTriggerService } from "application/services/message-trigger.service";

/** Real prepare/claim repository methods, with a transactional persistence boundary. */
function cancellationPersistenceFixture() {
    const f = boundaryFixture();
    // SQL is the external boundary here; retain snapshots so rejected transactions roll back.
    let row: Record<string, any> | undefined;
    let failCommit = false;
    const matches = (value: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([key, expected]) => {
        if (expected && typeof expected === "object" && "equals" in expected) return JSON.stringify(value[key]) === JSON.stringify(expected.equals);
        if (expected && typeof expected.getTime === "function") return typeof value[key]?.getTime === "function" && value[key].getTime() === expected.getTime();
        return value[key] === expected;
    });
    Object.assign(f.db.message_log, { findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => row && matches(row, where) ? structuredClone(row) : null) });
    f.db.message_log.create.mockImplementation(async ({ data }) => {
        row = { providerCallStartedAt: null, ...structuredClone(data), id: 42, createdAt: new Date(NIGHT), updatedAt: new Date(NIGHT) };
        return structuredClone(row) as never;
    });
    f.db.message_log.update.mockImplementation(async ({ data }) => { Object.assign(row!, structuredClone(data)); return structuredClone(row) as never; });
    f.db.message_log.updateMany.mockImplementation(async (args?: any) => {
        expect(f.active()).toBe(true);
        if (!row || !matches(row, args.where)) return { count: 0 };
        Object.assign(row, structuredClone(args.data)); return { count: 1 };
    });
    const updateJob = jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const current = await f.db.message_trigger_job.findFirst();
        if (!current || !matches(current, where)) return { count: 0 };
        f.store(Object.assign(current, structuredClone(data))); return { count: 1 };
    });
    Object.assign(f.db.message_trigger_job, { updateMany: updateJob });
    const transaction = f.db.$transaction.bind(f.db);
    f.db.$transaction = async work => transaction(async tx => {
        const beforeLog = structuredClone(row);
        const beforeJob = await f.db.message_trigger_job.findFirst();
        try {
            const result = await work(tx);
            if (failCommit) throw new Error("synthetic commit failure");
            return result;
        } catch (error) {
            row = beforeLog;
            if (beforeJob) f.store(beforeJob);
            throw error;
        }
    });
    Object.assign(f.repository, { prepareProviderAttempt: SbMessageLogRepository.prototype.prepareProviderAttempt,
        claimProviderAttempt: SbMessageLogRepository.prototype.claimProviderAttempt, update: SbMessageLogRepository.prototype.update });
    return { ...f, updateJob, log: () => structuredClone(row), failCommit: () => { failCommit = true; } };
}

describe("C1 terminal cancellation concurrency and crash recovery", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)));
    afterEach(() => jest.restoreAllMocks());

    it("keeps both prepared duplicates canceled across the actual policy writer's OFF commit", async () => {
        const f = cancellationPersistenceFixture();
        let arrivals = 0; let releasePrepared!: () => void;
        const bothPrepared = new Promise<void>(resolve => { releasePrepared = resolve; });
        let releaseSecond!: () => void; const secondMayEnter = new Promise<void>(resolve => { releaseSecond = resolve; });
        let entered!: () => void; const firstEntered = new Promise<void>(resolve => { entered = resolve; });
        let releaseFirst!: () => void; const firstMayContinue = new Promise<void>(resolve => { releaseFirst = resolve; });
        const admission = f.quiet.runAdmission.bind(f.quiet);
        jest.spyOn(f.quiet, "runAdmission").mockImplementation((async (...args: any[]) => {
            const ordinal = ++arrivals; if (ordinal === 2) releasePrepared(); await bothPrepared;
            if (ordinal === 2) await secondMayEnter;
            return (admission as any)(...args);
        }) as never);
        let locks = 0;
        f.setBeforeLock(async () => { if (++locks === 1) { entered(); await firstMayContinue; } });
        const executeIfVersion = jest.fn(async (key: string, value: string) => {
            expect(f.log()?.["variables"].quietHoursDisposition).toBe("CANCEL");
            expect(f.log()?.["providerAcceptanceState"]).toBe("prepared");
            Object.assign(f.policy, JSON.parse(value)); return SystemSettingEntity.create(key, value);
        });
        const writer = new SystemSettingService({ execute: f.execute } as never, { executeIfVersion } as never,
            undefined, undefined, undefined, { findPolicyPreviewCandidates: async () => [] } as never, f.repository, f.lock);
        const current = await writer.getMessageAutomationPolicyConfig("branch-a");
        const off = structuredClone(current.configuration); off.quietHours.enabled = false;
        const first = manualJob("agent"); const duplicate = manualJob("agent"); f.store(first);
        const service = triggerService(f);
        const firstSend = service.sendJob(first); const secondSend = service.sendJob(duplicate);
        await firstEntered;
        const policyWrite = writer.setMessageAutomationPolicyConfig("branch-a", current.version, off);
        releaseSecond(); releaseFirst();
        const [results] = await Promise.all([Promise.all([firstSend, secondSend]), policyWrite]);
        expect(executeIfVersion).toHaveBeenCalledTimes(1);
        expect(results).toEqual([false, false]);
        expect(first.status).toBe("canceled"); expect(duplicate.status).toBe("canceled");
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(0);
        expect(f.log()).toMatchObject({ status: "failed", providerAcceptanceState: "prepared", variables: { quietHoursDisposition: "CANCEL" } });
        expect(await f.db.message_trigger_job.findFirst()).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL", nextAttemptAt: null });
    });

    it("commits the durable job and CANCEL log before a simulated stop and actual Core reclaim", async () => {
        const f = cancellationPersistenceFixture(); const job = manualJob("agent"); f.store(job);
        expect(await triggerService(f).sendJob(job)).toBe(false);
        const stored = await f.db.message_trigger_job.findFirst();
        expect(stored).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL", nextAttemptAt: null, claimToken: null });
        expect(f.log()).toMatchObject({ status: "failed", providerAcceptanceState: "prepared", variables: { quietHoursDisposition: "CANCEL" } });
        jest.mocked(Date.now).mockReturnValue(stored!.updatedAt.getTime() + 2 * 60 * 60_000);
        const reclaim = jest.fn();
        const core = Object.assign(Object.create(MessageTriggerService.prototype), {
            jobRepository: { findStaleProcessingSystemScope: jest.fn(async (cutoff: Date) => {
                const current = await f.db.message_trigger_job.findFirst();
                return current && ["processing", "dispatching"].includes(current.status) && current.updatedAt <= cutoff
                    ? [Object.assign(Object.create(MessageTriggerJobEntity.prototype), current)] : [];
            }), reclaimWithClaimFence: reclaim }, messageLogRepository: f.repository,
        });
        await core.reclaimStaleProcessingJobs();
        expect(reclaim).not.toHaveBeenCalled();
        expect(await f.db.message_trigger_job.findFirst()).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL" });
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(0);
    });
});

describe("C1 atomic refusal guards", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)));
    afterEach(() => jest.restoreAllMocks());
    it.each(["job-CAS-lost", "log-CAS-lost", "late-log-error", "commit-error"])("rolls back both rows and retains entities on %s", async failure => {
        const f = cancellationPersistenceFixture(); const job = manualJob("agent"); f.store(job);
        const prepared = jest.spyOn(f.acceptance, "prepare");
        if (failure === "job-CAS-lost") f.updateJob.mockResolvedValue({ count: 0 });
        if (failure === "log-CAS-lost") f.db.message_log.updateMany.mockResolvedValue({ count: 0 });
        if (failure === "late-log-error") f.db.message_log.updateMany.mockRejectedValue(new Error("synthetic late log failure"));
        if (failure === "commit-error") f.setBeforeLock(async () => f.failCommit());
        await expect(triggerService(f).sendJob(job)).rejects.toBeInstanceOf(Error);
        expect(await f.db.message_trigger_job.findFirst()).toMatchObject({ status: "dispatching", claimToken: "claim-a", cancelReason: null });
        expect(f.log()).toMatchObject({ status: "pending", providerAcceptanceState: "prepared", providerCallStartedAt: null });
        expect(f.log()?.["variables"].quietHoursDisposition).toBeUndefined();
        const entity = await prepared.mock.results[0]!.value as MessageLogEntity;
        expect(entity.variables["quietHoursDisposition"]).toBeUndefined(); expect(entity.status).toBe("pending");
        expect(job).toMatchObject({ status: "dispatching", claimToken: "claim-a", cancelReason: null });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["claim", "branch", "source", "snapshot"])("refuses a changed current-job %s without terminal overwrite", async changed => {
        const f = cancellationPersistenceFixture(); const job = manualJob("agent"); f.store(job);
        f.setBeforeLock(async () => {
            const current = (await f.db.message_trigger_job.findFirst())!;
            if (changed === "claim") current.claimToken = "claim-new-owner";
            if (changed === "branch") current.branchId = "branch-b";
            if (changed === "source") current.recipientPhone = "01000000012";
            if (changed === "snapshot") current.payload.templateVariables["__smsDeliverySnapshot"] = "changed-persisted-snapshot";
            f.store(current);
        });
        await expect(triggerService(f).sendJob(job)).rejects.toBeInstanceOf(Error);
        expect(f.updateJob).not.toHaveBeenCalled(); expect(f.db.message_log.updateMany).not.toHaveBeenCalled();
        expect(job.status).toBe("dispatching"); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["missing", "read-error", "branch", "key", "fingerprint", "started", "uncertain", "accepted", "marker-only"])("refuses fresh acceptance %s before provider-start", async changed => {
        const f = cancellationPersistenceFixture(); const job = manualJob("agent"); f.store(job);
        const model = f.db.message_log as typeof f.db.message_log & { findUnique: jest.Mock };
        const read = model.findUnique.getMockImplementation()!;
        model.findUnique.mockImplementation(async (args: { where: { id?: number } }) => {
            const row = await (read as (args: unknown) => Promise<Record<string, any> | null>)(args);
            if (!args.where.id || !row) return row;
            if (changed === "missing") return null;
            if (changed === "read-error") throw new Error("synthetic current acceptance read failure");
            if (changed === "branch") row["branchId"] = "branch-b";
            if (changed === "key") row["providerAcceptanceKey"] = "other-key";
            if (changed === "fingerprint") row["providerAcceptanceFingerprint"] = "other-fingerprint";
            if (changed === "marker-only") row["variables"].quietHoursDisposition = "CANCEL";
            if (["started", "uncertain", "accepted"].includes(changed)) row["providerAcceptanceState"] = changed;
            return row;
        });
        await expect(triggerService(f).sendJob(job)).rejects.toBeInstanceOf(Error);
        expect(f.updateJob).not.toHaveBeenCalled(); expect(f.db.message_log.updateMany).not.toHaveBeenCalled();
        expect(job.status).toBe("dispatching"); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["allowed", "OFF"])("permits the matching never-canceled %s job once through actual prepare/claim", async mode => {
        const f = cancellationPersistenceFixture(); if (mode === "OFF") f.policy.quietHours.enabled = false;
        else f.policy.quietHours.start = "23:00";
        const job = manualJob("agent"); f.store(job);
        expect(await triggerService(f).sendJob(job)).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.log()).toMatchObject({ status: "sent", providerAcceptanceState: "accepted" });
        expect(f.active()).toBe(false);
    });
    it.each([["2026-11-03T12:59:00.000Z", true, 1], ["2026-11-03T13:00:00.000Z", false, 0]] as const)(
        "samples final quiet clock after acceptance/job reads complete at %s", async (readFinishedAt, allowed, providerCalls) => {
            const f = cancellationPersistenceFixture(); const job = manualJob("agent"); f.store(job);
            jest.mocked(Date.now).mockReturnValue(Date.parse("2026-11-03T12:59:00.000Z"));
            const originalRead = f.db.message_trigger_job.findFirst.getMockImplementation()!;
            f.db.message_trigger_job.findFirst.mockImplementation(async (...args: unknown[]) => {
                const row = await originalRead();
                if (f.active() && (args[0] as { where?: { id?: string } } | undefined)?.where?.id) jest.mocked(Date.now).mockReturnValue(Date.parse(readFinishedAt));
                return row;
            });
            expect(await triggerService(f).sendJob(job)).toBe(allowed);
            expect(f.aligo.sendSms).toHaveBeenCalledTimes(providerCalls);
            if (!allowed) expect(await f.db.message_trigger_job.findFirst()).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL" });
            expect(f.active()).toBe(false);
        },
    );
});

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../integrity/helpers/real-db";
import { createBranch, createClient, createMessageTriggerJob, createMessageTriggerRule } from "../integrity/helpers/factories";
import { RowTracker } from "../integrity/helpers/tracker";
import { SbSystemSettingRepository } from "infrastructure/database/repositories/sb.system-setting.repository";
import { SbMessageTriggerJobRepository } from "infrastructure/database/repositories/sb.message-trigger-job.repository";

/** Main executes these through the existing guarded state-integrity runner. */
describeReal("C1 quiet cancellation atomic SQL (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    const policyKeys: string[] = [];
    const branchIds: string[] = [];
    const ids = [
        { branch: "87000000-0000-4000-8000-000000008101", job: "87000000-0000-4000-8000-000000008201", client: 1481000101 },
        { branch: "87000000-0000-4000-8000-000000008102", job: "87000000-0000-4000-8000-000000008202", client: 1481000102 },
        { branch: "87000000-0000-4000-8000-000000008103", job: "87000000-0000-4000-8000-000000008203", client: 1481000103 },
        { branch: "87000000-0000-4000-8000-000000008104", job: "87000000-0000-4000-8000-000000008204", client: 1481000104 },
    ];
    beforeAll(async () => { assertThrowawayTarget(); handle = await createIntegrityPrisma(); tracker = new RowTracker(); });
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(Date.parse(NIGHT)));
    afterEach(async () => {
        jest.restoreAllMocks();
        if (handle) for (const branchId of branchIds) {
            for (const row of await handle.raw.message_log.findMany({ where: { branchId }, select: { id: true } })) tracker.track("message_log", row.id);
        }
    });
    afterAll(async () => {
        if (handle) {
            if (policyKeys.length) await handle.raw.system_setting.deleteMany({ where: { key: { in: policyKeys } } });
            if (tracker) await tracker.cleanup(handle.raw);
            await closeIntegrityPrisma(handle);
        }
    });
    async function pgFixture(index: number, enabled = true) {
        const id = ids[index]!;
        expect(await handle.raw.branch.count({ where: { id: id.branch } })).toBe(0);
        expect(await handle.raw.message_trigger_job.count({ where: { id: id.job } })).toBe(0);
        await createBranch(handle.raw, tracker, { id: id.branch, slug: `throwaway-quiet-c1-${index}` }); branchIds.push(id.branch);
        await createClient(handle.raw, tracker, { id: id.client, branchId: id.branch, name: "합성 심야 고객", phone: PHONE, phoneNormalized: PHONE });
        const policy = defaultMessageAutomationPolicy(); Object.assign(policy.quietHours, { enabled, action: "CANCEL" });
        const policyKey = `branch:${id.branch}:message_automation:policy`;
        await handle.raw.system_setting.create({ data: { key: policyKey, value: JSON.stringify(policy) } }); policyKeys.push(policyKey);
        const ruleId = `agent-sms:quiet-c1:${index}`;
        await createMessageTriggerRule(handle.raw, tracker, { id: ruleId, branchId: id.branch, templateKey: "SERVICE_INFO" });
        const job = manualJob("agent");
        Object.assign(job, { id: id.job, branchId: id.branch, ruleId, clientId: id.client, claimToken: "claim-quiet-c1", dedupeKey: `quiet-c1:${id.job}` });
        job.payload = { ...job.payload, clientId: id.client };
        await createMessageTriggerJob(handle.raw, tracker, { ruleId }, { id: job.id, branchId: id.branch, clientId: id.client,
            status: "dispatching", claimToken: job.claimToken, processingDeadlineAt: null, scheduledFor: job.scheduledFor,
            recipientType: job.recipientType, recipientPhone: PHONE, templateKey: job.templateKey, dedupeKey: job.dedupeKey,
            payload: job.payload as unknown as Prisma.InputJsonValue });
        const repository = new SbMessageLogRepository(handle.service);
        const lock = new MessageAutomationBranchLockService(handle.service);
        const settingsRepository = new SbSystemSettingRepository(handle.service);
        const settings = new SystemSettingService(new GetSettingUsecase(settingsRepository), new UpdateSettingUsecase(settingsRepository),
            undefined, undefined, undefined, new SbMessageTriggerJobRepository(handle.service), repository, lock);
        const quiet = new MessageQuietHoursService(settings, repository, lock);
        const gate = new AgentAutomationDeliveryGateService(handle.service, lock, {} as never);
        const aligo = { sendSms: jest.fn(async (request: { receiver: string }) => {
            // A new independent transaction must be available during fake transport.
            expect(await handle.raw.message_log.count({ where: { triggerJobId: job.id, providerAcceptanceState: "started" } })).toBe(1);
            return { request, response: { result_code: 1, message: "accepted", msg_id: 8811, success_cnt: 1, error_cnt: 0 } };
        }) };
        const service = new SmsTriggerDeliveryService(aligo as never, {} as never, repository, new SmsProviderAcceptanceService(repository), undefined, gate,
            undefined, settings, undefined, quiet);
        return { job, repository, lock, settings, quiet, aligo, service };
    }
    it("prepares both duplicates before CANCEL, commits job/log atomically, and refuses revival after actual OFF write", async () => {
        const f = await pgFixture(0); const duplicate = Object.assign(Object.create(MessageTriggerJobEntity.prototype), structuredClone(f.job)) as MessageTriggerJobEntity;
        let arrivals = 0; let releasePrepared!: () => void; const bothPrepared = new Promise<void>(resolve => { releasePrepared = resolve; });
        let releaseSecond!: () => void; const secondMayEnter = new Promise<void>(resolve => { releaseSecond = resolve; });
        const admission = f.quiet.runAdmission.bind(f.quiet);
        jest.spyOn(f.quiet, "runAdmission").mockImplementation((async (...args: any[]) => {
            const ordinal = ++arrivals; if (ordinal === 2) releasePrepared(); await bothPrepared;
            if (ordinal === 2) await secondMayEnter; return (admission as any)(...args);
        }) as never);
        const current = await f.settings.getMessageAutomationPolicyConfig(f.job.branchId!);
        const first = f.service.sendJob(f.job); const second = f.service.sendJob(duplicate);
        expect(await first).toBe(false);
        const stored = await handle.raw.message_trigger_job.findUniqueOrThrow({ where: { id: "87000000-0000-4000-8000-000000008201" } });
        expect(stored).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL", claimToken: null, nextAttemptAt: null });
        expect(await handle.raw.message_log.count({ where: { triggerJobId: stored.id, status: "failed", providerAcceptanceState: "prepared", nextRetryAt: null,
            variables: { path: ["quietHoursDisposition"], equals: "CANCEL" } } })).toBe(1);
        const off = structuredClone(current.configuration); off.quietHours.enabled = false;
        await f.settings.setMessageAutomationPolicyConfig(f.job.branchId!, current.version, off); releaseSecond();
        expect(await second).toBe(false); expect(f.aligo.sendSms).toHaveBeenCalledTimes(0);
        jest.mocked(Date.now).mockReturnValue(stored.updatedAt.getTime() + 2 * 60 * 60_000);
        const jobs = new SbMessageTriggerJobRepository(handle.service);
        const core = Object.assign(Object.create(MessageTriggerService.prototype), { jobRepository: jobs, messageLogRepository: f.repository });
        await core.reclaimStaleProcessingJobs();
        expect(await handle.raw.message_trigger_job.findUnique({ where: { id: stored.id } })).toMatchObject({ status: "canceled", cancelReason: "message_quiet_hours:CANCEL" });
    });
    it("rolls back actual job/log writes on an explicit late transaction error before commit", async () => {
        const f = await pgFixture(1); const transaction = handle.service.$transaction.bind(handle.service);
        let observedBothWrites = false;
        jest.spyOn(handle.service, "$transaction").mockImplementation((async (work: any, options: any) => (transaction as any)(async (tx: Prisma.TransactionClient) => {
            const result = await work(tx);
            const canceled = await tx.message_log.findFirst({ where: { triggerJobId: f.job.id, variables: { path: ["quietHoursDisposition"], equals: "CANCEL" } } });
            if (canceled) {
                expect(await tx.message_trigger_job.findUnique({ where: { id: f.job.id } })).toMatchObject({ status: "canceled", claimToken: null });
                observedBothWrites = true; throw new Error("explicit late SQL transaction failure");
            }
            return result;
        }, options)) as never);
        await expect(f.service.sendJob(f.job)).rejects.toThrow("explicit late SQL transaction failure");
        expect(observedBothWrites).toBe(true);
        expect(await handle.raw.message_trigger_job.findUnique({ where: { id: f.job.id } })).toMatchObject({ status: "dispatching", claimToken: "claim-quiet-c1", cancelReason: null });
        expect(await handle.raw.message_log.findFirst({ where: { triggerJobId: f.job.id } })).toMatchObject({ status: "pending", providerAcceptanceState: "prepared", providerCallStartedAt: null });
        expect(f.job).toMatchObject({ status: "dispatching", claimToken: "claim-quiet-c1", cancelReason: null }); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("refuses a competing current claim without modifying the job or prepared log", async () => {
        const f = await pgFixture(2); const admission = f.quiet.runAdmission.bind(f.quiet);
        jest.spyOn(f.quiet, "runAdmission").mockImplementation((async (...args: any[]) => {
            await handle.raw.message_trigger_job.update({ where: { id: f.job.id }, data: { claimToken: "claim-competing-owner" } });
            return (admission as any)(...args);
        }) as never);
        await expect(f.service.sendJob(f.job)).rejects.toBeInstanceOf(Error);
        expect(await handle.raw.message_trigger_job.findUnique({ where: { id: f.job.id } })).toMatchObject({ status: "dispatching", claimToken: "claim-competing-owner", cancelReason: null });
        expect(await handle.raw.message_log.findFirst({ where: { triggerJobId: f.job.id } })).toMatchObject({ status: "pending", providerAcceptanceState: "prepared" });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("allows a matching never-canceled OFF job once through real prepare/start CAS", async () => {
        const f = await pgFixture(3, false);
        expect(await f.service.sendJob(f.job)).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(await handle.raw.message_log.findFirst({ where: { triggerJobId: f.job.id } })).toMatchObject({ status: "sent", providerAcceptanceState: "accepted" });
    });
});

const POOL_BRANCH = "93000000-0000-4000-8000-000000000001";
const POOL_OUTSIDE = Date.parse("2026-11-03T12:59:00Z");
const POOL_INSIDE = Date.parse("2026-11-03T13:00:00Z");
function poolDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

/** Only finite pool allocation, advisory scheduling and SQL results are simulated. */
function quietPoolFixture(capacity = 5, simultaneousTransactions = 1) {
    const policy = defaultMessageAutomationPolicy(); Object.assign(policy.quietHours, { enabled: true, action: "CANCEL" });
    let leased = 0; let opened = 0; let holder: number | null = null;
    let rootReads = 0; let policyTxReads = 0; let recipientTxReads = 0; let decisions = 0;
    let failRecipient = false; let recipientReadHook: (() => void) | undefined;
    const allLeased = poolDeferred(); const blockedRoot = poolDeferred();
    const rootWaiters: Array<ReturnType<typeof poolDeferred<Array<{ phone: string; group_name: string }>>>> = [];
    const lockWaiters: Array<ReturnType<typeof poolDeferred<void>>> = [];
    const active = new Set<Prisma.TransactionClient>();
    const identities = new Map<Prisma.TransactionClient, number>();
    const recipientTransactions: Prisma.TransactionClient[] = [];
    const recipientRows = [{ phone: "01000000011", group_name: "CLIENT" }];
    const readRecipients = (sql: Prisma.Sql) => {
        expect(sql.values).toContain("93000000-0000-4000-8000-000000000001");
        expect(sql.sql).toContain("user_branch"); expect(sql.sql).not.toMatch(/LIMIT\s+500/i);
        if (failRecipient) throw new Error("synthetic recipient SQL unavailable");
        recipientReadHook?.(); return recipientRows;
    };
    const releaseConnection = () => { leased--; if (rootWaiters.length) rootWaiters.shift()!.resolve(recipientRows); };
    const database = {
        system_setting: { findUnique: async () => ({ key: `branch:${POOL_BRANCH}:message_automation:policy`, value: JSON.stringify(policy), updatedAt: new Date(POOL_OUTSIDE) }) },
        $queryRaw: async (sql: Prisma.Sql) => {
            rootReads++;
            if (leased === capacity) { const waiter = poolDeferred<typeof recipientRows>(); rootWaiters.push(waiter); blockedRoot.resolve(); return waiter.promise; }
            leased++; try { return readRecipients(sql); } finally { releaseConnection(); }
        },
        $transaction: async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
            if (leased >= capacity) throw new Error("transaction acquisition exceeded pool");
            leased++; const identity = ++opened; if (opened === simultaneousTransactions) allLeased.resolve(); await allLeased.promise;
            const tx = {
                system_setting: { findUnique: async () => { policyTxReads++; return database.system_setting.findUnique(); } },
                $queryRaw: async (sql: Prisma.Sql) => {
                    recipientTxReads++; recipientTransactions.push(tx as unknown as Prisma.TransactionClient);
                    expect(holder).toBe(identity); expect(active.has(tx as unknown as Prisma.TransactionClient)).toBe(true);
                    return readRecipients(sql);
                },
                $executeRaw: async () => {
                    if (holder === identity) return 1;
                    if (holder !== null) { const waiter = poolDeferred(); lockWaiters.push(waiter); await waiter.promise; }
                    holder = identity; return 1;
                },
            };
            const typed = tx as unknown as Prisma.TransactionClient; identities.set(typed, identity); active.add(typed);
            try { return await work(typed); }
            finally { active.delete(typed); holder = null; releaseConnection(); lockWaiters.shift()?.resolve(); }
        },
    };
    const settingsRepository = new SbSystemSettingRepository(database as never);
    const settings = new SystemSettingService(new GetSettingUsecase(settingsRepository), new UpdateSettingUsecase(settingsRepository));
    const repository = new SbMessageLogRepository(database as never);
    const service = new MessageQuietHoursService(settings, repository, new MessageAutomationBranchLockService(database as never));
    const provider = jest.fn();
    const work = async (decision: { action: string }, tx?: Prisma.TransactionClient) => {
        expect(tx).toBeDefined(); expect(active.has(tx!)).toBe(true); expect(identities.get(tx!)).toBe(holder);
        decisions++; return { action: decision.action, tx: tx! };
    };
    const send = async () => {
        const result = await service.runAdmission(POOL_BRANCH, "01000000011", work);
        expect(active.has(result.tx)).toBe(false);
        if (result.action === "ALLOW") provider();
        return result.action;
    };
    return { service, repository, policy, recipientRows, recipientTransactions, provider, send, work,
        blockedRoot: blockedRoot.promise,
        expireRootWait: () => rootWaiters.shift()!.reject(Object.assign(new Error("modeled pool wait expired"), { code: "P2024" })),
        stats: () => ({ leased, opened, holder, rootReads, policyTxReads, recipientTxReads, decisions, lockWaiters: lockWaiters.length, rootWaiters: rootWaiters.length }),
        failRecipient: () => { failRecipient = true; }, onRecipientRead: (hook: () => void) => { recipientReadHook = hook; } };
}

describe("C2 acquired transaction and finite-pool admission", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(POOL_OUTSIDE));
    afterEach(() => jest.restoreAllMocks());
    it("allows five simultaneous ON/outside admissions on five leased connections without a root read", async () => {
        const f = quietPoolFixture(5, 5);
        const completion = Promise.allSettled(Array.from({ length: 5 }, () => f.send()));
        const observed = await Promise.race([completion.then(results => ({ kind: "completed" as const, results })),
            f.blockedRoot.then(() => ({ kind: "pool-cycle" as const, stats: f.stats() }))]);
        if (observed.kind === "pool-cycle") {
            // Deterministic RED diagnosis/cleanup only; no timer or unresolved pool wait.
            const cycle = observed.stats; f.expireRootWait(); await completion;
            expect(cycle).toMatchObject({ leased: 5, lockWaiters: 4, rootWaiters: 0, rootReads: 0 });
        }
        expect(observed.kind).toBe("completed");
        expect(await completion).toEqual(Array.from({ length: 5 }, () => ({ status: "fulfilled", value: "ALLOW" })));
        expect(f.stats()).toMatchObject({ leased: 0, opened: 5, rootReads: 0, policyTxReads: 5, recipientTxReads: 5, decisions: 5 });
        expect(new Set(f.recipientTransactions).size).toBe(5); expect(f.provider).toHaveBeenCalledTimes(5);
    });
    it.each(["OFF", "inside-CANCEL"])("finishes the identical saturated %s batch with no root reads", async mode => {
        const f = quietPoolFixture(5, 5);
        if (mode === "OFF") f.policy.quietHours.enabled = false;
        else jest.mocked(Date.now).mockReturnValue(POOL_INSIDE);
        expect(await Promise.all(Array.from({ length: 5 }, () => f.send()))).toEqual(Array(5).fill(mode === "OFF" ? "ALLOW" : "CANCEL"));
        expect(f.stats()).toMatchObject({ leased: 0, opened: 5, rootReads: 0, policyTxReads: 5, recipientTxReads: mode === "OFF" ? 0 : 5, decisions: 5 });
        expect(f.provider).toHaveBeenCalledTimes(mode === "OFF" ? 5 : 0);
    });
    it("keeps the optional two-argument repository lookup on the root client", async () => {
        const f = quietPoolFixture();
        const candidates = [{ recipientPhone: "01000000011", recipientGroups: [], dueAt: new Date("2026-11-03T12:59:00Z") }];
        expect(await f.repository.resolvePolicyRecipientGroups(POOL_BRANCH, candidates)).toEqual([
            { recipientPhone: "01000000011", recipientGroups: ["CLIENT"], dueAt: new Date("2026-11-03T12:59:00Z") },
        ]);
        expect(f.stats()).toMatchObject({ leased: 0, opened: 0, rootReads: 1, recipientTxReads: 0 });
    });
    it("refuses recipient read failure within the leased transaction with provider0", async () => {
        const f = quietPoolFixture(); f.failRecipient();
        await expect(f.send()).rejects.toBeInstanceOf(MessageQuietHoursUnavailableError);
        expect(f.stats()).toMatchObject({ leased: 0, rootReads: 0, recipientTxReads: 1, decisions: 0 });
        expect(f.provider).not.toHaveBeenCalled();
    });
    it("samples the actual clock after transaction-bound recipient SQL crosses22:00", async () => {
        const f = quietPoolFixture(); f.onRecipientRead(() => jest.mocked(Date.now).mockReturnValue(POOL_INSIDE));
        expect(await f.send()).toBe("CANCEL"); expect(f.provider).not.toHaveBeenCalled();
        expect(f.stats()).toMatchObject({ leased: 0, rootReads: 0, recipientTxReads: 1 });
    });
    it("reentrant final evaluation uses the same leased transaction for both recipient reads", async () => {
        const f = quietPoolFixture();
        const result = await f.service.runAdmission(POOL_BRANCH, "01000000011", async (decision, tx) => {
            expect(decision.action).toBe("ALLOW"); jest.mocked(Date.now).mockReturnValue(POOL_INSIDE);
            return f.service.runAdmission(POOL_BRANCH, "01000000011", f.work, tx);
        });
        expect(result.action).toBe("CANCEL");
        expect(f.stats()).toMatchObject({ leased: 0, opened: 1, rootReads: 0, policyTxReads: 2, recipientTxReads: 2, decisions: 1 });
        expect(f.recipientTransactions[0]).toBe(result.tx); expect(f.recipientTransactions[1]).toBe(result.tx);
        expect(f.provider).not.toHaveBeenCalled();
    });
    it("retains exact-phone category union while querying through the current transaction", async () => {
        const f = quietPoolFixture(); jest.mocked(Date.now).mockReturnValue(POOL_INSIDE); f.policy.quietHours.recipientGroups = ["STAFF"];
        expect(await f.send()).toBe("ALLOW");
        f.recipientRows.push({ phone: "+82 10-0000-0011", group_name: "STAFF" });
        expect(await f.send()).toBe("CANCEL");
        expect(f.provider).toHaveBeenCalledTimes(1); expect(f.stats().rootReads).toBe(0);
    });
});
