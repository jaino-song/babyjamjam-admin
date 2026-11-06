import { ClientAutomationImpactService } from "application/services/client-automation-impact.service";
import { agentAutomationTaskCommitReference } from "application/agent/agent-automation-record-store.service";
import { agentAutomationCoverageScope, agentAutomationCoverageRecordDigest } from "application/agent/agent-automation-coverage";
import { agentAutomationEffectDigest, agentAutomationRecordDigest, agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { createAgentAutomationTerminalRecord, agentAutomationRecordKey } from "application/agent/agent-automation-terminal-record";
import { agentAutomationConcreteJobDigest } from "application/services/agent-automation-job-binding";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type { AgentAutomationAuthority, AgentAutomationCoverage, AgentAutomationScope } from "domain/entities/agent-automation-consent";
import type { Prisma } from "@prisma/client";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { AgentAutomationRecordStoreService } from "application/agent/agent-automation-record-store.service";
import { AgentAutomationAuthorityService } from "application/agent/agent-automation-authority.service";
import { AgentAutomationJobAuthorityService } from "application/services/agent-automation-job-authority.service";
import { AgentAutomationDeliveryGateService } from "application/services/agent-automation-delivery-gate.service";
import { MessageAutomationBranchLockService } from "application/services/message-automation-branch-lock.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { defaultMessageAutomationPolicy } from "domain/entities/system-setting.entity";
import { MESSAGE_TRIGGER_TEMPLATE_CATALOG, isCompatibleMessageTriggerTemplate } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRecipientResolverService } from "application/services/message-trigger-recipient-resolver.service";
import { CaregiverTemplateResolverService } from "application/services/caregiver-template-resolver.service";
import { ClientAutomationSourceReader } from "application/services/client-automation-source.reader";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

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

describe("RULE-2 actual caregiver schedule resolver", () => {
    it("renders two actual employees with independent literal body/time/source identity and no writes", async () => {
        const f = fixture();
        const result = await f.resolve();
        expect(result.complete).toBe(true);
        expect(result.recipients.map((row) => ({ phone: row.recipientPhone, body: row.body, time: row.scheduledFor, anchor: row.anchorDate, count: row.count }))).toEqual([
            { phone: "01000000011", body: "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점", time: "2026-11-07T01:30:00.000Z", anchor: "2026-11-10", count: 1 },
            { phone: "01000000012", body: "합성 보조 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점", time: "2026-11-07T01:30:00.000Z", anchor: "2026-11-10", count: 1 },
        ]);
        expect(result.recipients[0]?.recipe).toMatchObject({ ruleId: "child-primary", employeeScheduleId: 91,
            dedupeKey: "group:group-a:child:child-primary:schedule:91:event:SERVICE_START:employee:11",
            payload: { caregiverSourceSnapshot: { version: 1, groupVersion: 3, schedule: { id: 91, incarnationId, replaced: false, terminatedAt: null }, employee: { id: 11, phone: "01000000011" } } } });
        expect(f.database.employee_schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId, clientId: 7, replaced: false, terminatedAt: null }, take: 501 }));
        expect(f.database.system_template.findUnique).not.toHaveBeenCalled();
        expect(Object.keys(f.database).sort()).toEqual(["branch", "client", "employee_schedule", "system_template"]);
    });
    it.each([MessageTriggerEventType.SERVICE_START, MessageTriggerEventType.SERVICE_END])("supports distinct templates in BOTH for %s with event-anchored time", async (event) => {
        const f = fixture();
        for (const rule of f.rules) rule.eventType = event;
        f.rules[1]!.templateKey = MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE;
        const result = await f.resolve();
        expect(result.complete).toBe(true);
        expect(result.recipients.map((row) => [row.recipientPhone, row.templateKey, row.body, row.scheduledFor])).toEqual([
            ["01000000011", "CAREGIVER_SERVICE_START_NOTICE", "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점", event === "SERVICE_START" ? "2026-11-07T01:30:00.000Z" : "2026-11-17T01:30:00.000Z"],
            ["01000000012", "CAREGIVER_SERVICE_END_NOTICE", "합성 보조 관리사님, 합성 고객 고객님의 서비스가 2026-11-20에 종료됩니다. 마무리 안내를 확인해 주세요. - 합성 지점", event === "SERVICE_START" ? "2026-11-07T01:30:00.000Z" : "2026-11-17T01:30:00.000Z"],
        ]);
    });

    it("uses every active schedule instead of selecting the latest", async () => {
        const f = fixture(); f.database.employee_schedule.findMany.mockResolvedValue([f.schedule, { ...f.schedule, id: 92, incarnationId: "44000000-0000-4000-8000-000000000002" }]);
        const result = await f.resolve();
        expect(result.complete).toBe(true); expect(result.recipients.map((row) => row.employeeScheduleId)).toEqual([91, 92, 91, 92]);
    });
    it("B1 known empty assignments means 배정 없음 even for an unqualified client without phone or anchors", async () => {
        const f = fixture(); Object.assign(f.client, { phone: null, startDate: null, endDate: null, bookingConfirmedAt: null }); f.database.employee_schedule.findMany.mockResolvedValue([]);
        const result = await f.resolve();
        expect(result).toMatchObject({ complete: true, recipients: [{ outcome: "skip", reason: "배정 없음", count: 0 }, { outcome: "skip", reason: "배정 없음", count: 0 }] });
    });
    it("distinguishes known assignments with unqualified clients from empty assignments", async () => {
        const f = fixture(); f.client.serviceStatus = "terminated";
        expect((await f.resolve()).recipients.map((row) => row.reason)).toEqual(["자격 미충족", "자격 미충족"]);
    });
    it("keeps primary and skips a missing secondary", async () => {
        const f = fixture(); Object.assign(f.schedule, { secondaryEmployee: null, secondaryEmployeeId: null });
        expect((await f.resolve()).recipients.map((row) => [row.outcome, row.count, row.reason])).toEqual([["ready", 1, null], ["skip", 0, "배정 없음"]]);
    });
    it("keeps one primary when both roles refer to the same employee", async () => {
        const f = fixture(); f.schedule.secondaryEmployee = f.schedule.primaryEmployee; f.schedule.secondaryEmployeeId = 11;
        expect((await f.resolve()).recipients.map((row) => [row.outcome, row.count])).toEqual([["ready", 1], ["skip", 0]]);
    });
    it("refuses both distinct employees sharing a phone with distinct bodies", async () => {
        const f = fixture(); f.schedule.secondaryEmployee.phone = "01000000011";
        expect((await f.resolve()).recipients.map((row) => [row.outcome, row.count, row.reason])).toEqual([["needs_setup", 0, "recipient_phone_conflict"], ["needs_setup", 0, "recipient_phone_conflict"]]);
    });
    it("does not move the schedule anchor after a client date-only edit", async () => {
        const f = fixture(); f.client.startDate = new Date("2027-01-01T00:00:00Z");
        expect((await f.resolve()).recipients[0]).toMatchObject({ anchorSource: "employee_schedule.startDate", anchorDate: "2026-11-10", scheduledFor: "2026-11-07T01:30:00.000Z" });
    });
    it("uses schedule end for END without changing occurrence identity by dates", async () => {
        const f = fixture(); for (const rule of f.rules) { rule.eventType = MessageTriggerEventType.SERVICE_END; rule.templateKey = MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE; }
        const result = await f.resolve();
        expect(result.recipients[0]).toMatchObject({ anchorSource: "employee_schedule.endDate", anchorDate: "2026-11-20", scheduledFor: "2026-11-17T01:30:00.000Z" });
        expect(result.recipients[0]?.recipe?.dedupeKey).toBe("group:group-a:child:child-primary:schedule:91:event:SERVICE_END:employee:11");
    });
    it.each([501, 502])("treats %s schedule rows as incomplete instead of a complete bounded set", async (count) => {
        const f = fixture(); f.database.employee_schedule.findMany.mockResolvedValue(Array.from({ length: count }, (_, i) => ({ ...f.schedule, id: i + 1 })));
        expect((await f.resolve()).complete).toBe(false);
    });
    it("query failure is unavailable, not an empty complete source", async () => {
        const f = fixture(); f.database.employee_schedule.findMany.mockRejectedValue(new Error("read failure"));
        expect(await f.resolve()).toMatchObject({ complete: false, recipients: [{ outcome: "unavailable" }, { outcome: "unavailable" }] });
    });
    it.each(["disabled", "deleted"])("refuses %s branch content without fallback", async (state) => {
        const f = fixture(); f.branch.systemTemplateSnapshot = { version: 2, createdAt: now.toISOString(), createdBy: "user-a", templates: {
            CAREGIVER_SERVICE_START_NOTICE: { state, ...(state === "deleted" ? { deletedAt: now.toISOString() } : {}), content: "edited {{employeeName}}", customVariables: [], id: "branch-key", createdAt: now.toISOString(), updatedAt: now.toISOString() },
        } };
        expect((await f.resolve()).recipients.map((row) => [row.outcome, row.reason, row.count])).toEqual([["needs_setup", "template_unavailable", 0], ["needs_setup", "template_unavailable", 0]]);
        expect(f.database.system_template.findUnique).not.toHaveBeenCalled();
    });
    it.each([{}, { version: 99 }, { version: 2, createdAt: now.toISOString(), createdBy: "user-a", templates: { CAREGIVER_SERVICE_START_NOTICE: {} } }])("fails closed on malformed or unknown branch snapshot %j", async (snapshot) => {
        const f = fixture(); f.branch.systemTemplateSnapshot = snapshot;
        expect((await f.resolve()).recipients.map((row) => row.outcome)).toEqual(["needs_setup", "needs_setup"]);
    });
    it("uses active edited branch content without writing or consulting global rows", async () => {
        const f = fixture(); f.branch.systemTemplateSnapshot = { version: 1, createdAt: now.toISOString(), createdBy: "user-a", templates: {
            CAREGIVER_SERVICE_START_NOTICE: { content: "편집 {{employeeName}} / {{clientName}} / {{serviceStartDate}} / {{branchName}}", customVariables: [], id: "branch-key", createdAt: now.toISOString(), updatedAt: now.toISOString() },
        } };
        expect((await f.resolve()).recipients.map((row) => row.body)).toEqual(["편집 합성 주 / 합성 고객 / 2026-11-10 / 합성 지점", "편집 합성 보조 / 합성 고객 / 2026-11-10 / 합성 지점"]);
    });
    it("uses the caller transaction for every source/template/group read", async () => {
        const f = fixture(); const transaction = f.database;
        const result = await f.resolver.resolve(branchId, 7, f.rules, transaction as never, { now });
        expect(result.complete).toBe(true);
        expect(f.groups.findGroup).toHaveBeenCalledWith(branchId, "group-a", transaction);
        expect(f.database.client.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, branchId } }));
    });
    it("rejects a schedule that crossed branch or was replaced before the canonical read", async () => {
        const f = fixture(); f.schedule.branchId = "other-branch";
        expect((await f.resolve()).complete).toBe(false);
        f.schedule.branchId = branchId; f.schedule.replaced = true;
        expect((await f.resolve()).complete).toBe(false);
    });
});

describe("RULE-2 literal catalog boundary", () => {
    it.each(["CAREGIVER_SERVICE_START_NOTICE", "CAREGIVER_SERVICE_END_NOTICE"] as const)("%s allows only actual caregiver service recipients", (key) => {
        const item = MESSAGE_TRIGGER_TEMPLATE_CATALOG[key];
        expect(item.allowedRecipientTypes).toEqual(["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"]);
        expect(item.allowedEventTypes).toEqual(["SERVICE_START", "SERVICE_END"]);
        for (const eventType of [MessageTriggerEventType.SERVICE_START, MessageTriggerEventType.SERVICE_END, MessageTriggerEventType.CLIENT_CREATED]) {
            expect(isCompatibleMessageTriggerTemplate({ templateKey: key as MessageTriggerTemplateKey, eventType, recipientType: MessageTriggerRecipientType.CLIENT })).toBe(false);
        }
        for (const recipientType of [MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerRecipientType.SECONDARY_EMPLOYEE]) {
            expect(isCompatibleMessageTriggerTemplate({ templateKey: key as MessageTriggerTemplateKey, eventType: MessageTriggerEventType.CLIENT_CREATED, recipientType })).toBe(false);
        }
    });
});

/** Repository-bound unit proof. Production resolver/RecordStore/authority/gate/renderer are real; no fabricated permit. */
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
    const logs = { save: jest.fn(async (log: unknown) => log) };
    const service = new SmsTriggerDeliveryService(aligo as never, {} as never, logs as never, undefined, undefined, gate, undefined,
        { getMessageAutomationPolicyConfig: async () => ({ configuration: defaultMessageAutomationPolicy() }) } as never, f.templates);
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
    return { ...f, job, db, gate, authority, records, service, aligo, logs, start, dispatch, store };
}

describe("RULE-2 automatic caregiver real permit path (repository-bound unit)", () => {
    it.each([["active"], ["disabled"], ["deleted"], [], null, {}, false, 0, "unknown"].map((state) => ({ state })))("refuses malformed lifecycle %j through actual current authority with provider0", async ({ state }) => {
        const f = await automaticFixture();
        f.branch.systemTemplateSnapshot = { version: 2, createdAt: now.toISOString(), createdBy: "user-a", templates: {
            CAREGIVER_SERVICE_START_NOTICE: { state, content: "{{employeeName}} 관리사님, {{clientName}} 고객님의 서비스가 {{serviceStartDate}}에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - {{branchName}}",
                id: "branch-key", customVariables: [], createdAt: now.toISOString(), updatedAt: now.toISOString() },
        } };
        const authorization = await f.start();
        const delivered = authorization.kind === "allow" ? await f.dispatch() : false;
        expect(delivered).toBe(false);
        expect(authorization.kind).toBe("stale");
        expect((await f.resolve()).recipients[0]).toMatchObject({ outcome: "needs_setup", reason: "template_unavailable" });
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
        expect(f.logs.save).not.toHaveBeenCalled();
    });
    it("allows a primitive active v2 lifecycle through actual preparation and final permit", async () => {
        const f = await automaticFixture();
        f.branch.systemTemplateSnapshot = { version: 2, createdAt: now.toISOString(), createdBy: "user-a", templates: {
            CAREGIVER_SERVICE_START_NOTICE: { state: "active", content: "{{employeeName}} 관리사님, {{clientName}} 고객님의 서비스가 {{serviceStartDate}}에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - {{branchName}}",
                id: "branch-key", customVariables: [], createdAt: now.toISOString(), updatedAt: now.toISOString() },
        } };
        expect(await f.start()).toEqual({ kind: "allow" });
        expect(await f.dispatch()).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000011",
            message: "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점" }));
    });
    it.each(["START", "END"] as const)("delivers %s through actual source/current authority/prepare/final permit exactly once", async (event) => {
        const f = await automaticFixture(event);
        expect(await f.start()).toEqual({ kind: "allow" });
        expect(await f.dispatch()).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(f.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000011", message: event === "START"
            ? "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점"
            : "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-20에 종료됩니다. 마무리 안내를 확인해 주세요. - 합성 지점" }));
        expect(await f.dispatch()).toBe(false);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each(["START", "END"] as const)("delivers independent BOTH template choices for %s using the same event due time", async (event) => {
        const primary = await automaticFixture(event, 0, true); const secondary = await automaticFixture(event, 1, true);
        expect(primary.job.scheduledFor.toISOString()).toBe(event === "START" ? "2026-11-07T01:30:00.000Z" : "2026-11-17T01:30:00.000Z");
        expect(secondary.job.scheduledFor.toISOString()).toBe(event === "START" ? "2026-11-07T01:30:00.000Z" : "2026-11-17T01:30:00.000Z");
        expect(await primary.start()).toEqual({ kind: "allow" }); expect(await secondary.start()).toEqual({ kind: "allow" });
        expect(await primary.dispatch()).toBe(true); expect(await secondary.dispatch()).toBe(true);
        expect(primary.aligo.sendSms).toHaveBeenCalledTimes(1); expect(secondary.aligo.sendSms).toHaveBeenCalledTimes(1);
        expect(primary.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000011", message: "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-10에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점" }));
        expect(secondary.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000012", message: "합성 보조 관리사님, 합성 고객 고객님의 서비스가 2026-11-20에 종료됩니다. 마무리 안내를 확인해 주세요. - 합성 지점" }));
    });

    it.each(["disabled", "deleted", "malformed", "unknown-version"])("refuses %s at the final current-template boundary with provider0", async (state) => {
        const f = await automaticFixture();
        expect(await f.start()).toEqual({ kind: "allow" });
        f.branch.systemTemplateSnapshot = state === "malformed" ? {} : state === "unknown-version" ? { version: 99 } : {
            version: 2, createdAt: now.toISOString(), createdBy: "user-a", templates: { CAREGIVER_SERVICE_START_NOTICE: {
                state, ...(state === "deleted" ? { deletedAt: now.toISOString() } : {}), content: "blocked", id: "branch-key", customVariables: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
            } },
        };
        expect(await f.dispatch()).toBe(false);
        expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.logs.save).not.toHaveBeenCalled();
    });
    it("refuses relabeling a caregiver job as a direct manual/old agent sender", async () => {
        const f = await automaticFixture();
        Object.assign(f.job, { ruleId: "agent-sms:forged" });
        await expect(f.service.sendJob(f.job)).rejects.toThrow("Caregiver service source");
        expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.logs.save).not.toHaveBeenCalled();
    });

    it.each(["missing", "unknown-version", "changed-phone", "wrong-incarnation", "replaced", "terminated", "changed-group"])("refuses %s current source without provider work", async (change) => {
        const f = await automaticFixture();
        if (change === "missing") delete f.job.payload.caregiverSourceSnapshot;
        if (change === "unknown-version") Object.assign(f.job.payload.caregiverSourceSnapshot!, { version: 99 });
        if (change === "changed-phone") f.schedule.primaryEmployee.phone = "01000000099";
        if (change === "wrong-incarnation") f.schedule.incarnationId = "44000000-0000-4000-8000-000000000099";
        if (change === "replaced") f.schedule.replaced = true;
        if (change === "terminated") Object.assign(f.schedule, { terminatedAt: new Date() });
        if (change === "changed-group") f.groups.findGroup.mockResolvedValue({ id: "group-a", version: 4 });
        expect((await f.start()).kind).toBe("stale");
        expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.logs.save).not.toHaveBeenCalled();
    });
});


// Phase7 C3: actual materializer/current-authority/permit collaborators; only persistence and provider boundaries are synthetic.
function timingJobCopy(job: MessageTriggerJobEntity): MessageTriggerJobEntity {
    return Object.assign(Object.create(MessageTriggerJobEntity.prototype), structuredClone(job));
}
async function timingFixture(enabled: boolean, future = false, mixed = false) {
    const f = fixture();
    Object.assign(f.client, { phone: "01000000007", startDate: new Date("2026-11-05T00:00:00Z") });
    f.schedule.startDate = new Date(future ? "2026-11-06T00:00:00Z" : "2026-11-05T00:00:00Z");
    for (const rule of f.rules) Object.assign(rule, { offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "09:00", jobsStale: false });
    const clientRule = MessageTriggerRuleEntity.create({ branchId, name: "CLIENT timing control", groupId: "group-client", isActive: true,
        eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "09:00",
        recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.INFO });
    Object.assign(clientRule, { id: "child-client", jobsStale: false });
    const rules = mixed ? [...f.rules, clientRule] : f.rules;
    const ruleOrder = mixed ? ["child-secondary", "child-client", "child-primary"] : ["child-secondary", "child-primary"];
    const repository = { findAll: jest.fn(async () => rules), findActiveByEventTypes: jest.fn(async () => rules),
        findGroup: f.groups.findGroup, findGroupRules: jest.fn(async () => f.rules) };
    const settings = { getMessageSettingsPolicyEnabled: jest.fn(async () => enabled),
        getMessageAutomationPastTriggerConfig: jest.fn(async () => ({ sendIntervalMinutes: 3, ruleOrder })),
        getMessageAutomationPolicyConfig: jest.fn(async () => ({ configuration: defaultMessageAutomationPolicy() })) };
    const approval = { isApproved: jest.fn(async () => true), getApprovedBranches: jest.fn(async () => new Map([[branchId, null]])) };
    const activation = { getTriggerDispatchEnabled: jest.fn(async () => true) };
    const jobs: MessageTriggerJobEntity[] = [];
    const db = Object.assign(f.database, { $queryRawUnsafe: jest.fn(async () => [{ exists: true }]), $executeRaw: jest.fn(async () => 1),
        $transaction: jest.fn(async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
            const before = structuredClone(jobs);
            try { return await work(db as never); } catch (error) { jobs.splice(0, jobs.length, ...before); throw error; }
        }),
        message_trigger_rule_branch_override: { findMany: jest.fn(async () => []) },
        message_trigger_job: {
            findMany: jest.fn(async () => []),
            findFirst: jest.fn(async ({ where }: { where: { id: string } }) => structuredClone(jobs.find((job) => job.id === where.id) ?? null)),
            findUnique: jest.fn(async ({ where }: { where: { dedupeKey: string } }) => structuredClone(jobs.find((job) => job.dedupeKey === where.dedupeKey) ?? null)),
            updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string; claimToken?: string }; data: Partial<MessageTriggerJobEntity> }) => {
                const job = jobs.find((row) => row.id === where.id && (!where.status || row.status === where.status) && (!where.claimToken || row.claimToken === where.claimToken));
                if (!job) return { count: 0 }; Object.assign(job, structuredClone(data)); return { count: 1 };
            }),
        } });
    Object.assign(db.employee_schedule, { findFirst: jest.fn(async () => f.schedule) });
    const sources = new ClientAutomationSourceReader(db as never, repository as never, { findAllByBranch: async () => [] } as never, approval as never, settings as never, activation as never);
    const resolver = new MessageTriggerRecipientResolverService(sources, f.templates, repository as never);
    const lock = new MessageAutomationBranchLockService(db as never);
    const records = new AgentAutomationRecordStoreService(lock);
    const authority = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(records), sources,
        { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) } as never, undefined, resolver);
    const gate = new AgentAutomationDeliveryGateService(db as never, lock, authority);
    const aligo = { sendSms: jest.fn(async (request: { receiver: string }) => ({ response: { result_code: 1, message: "성공", msg_id: 9876, success_cnt: 1, error_cnt: 0 }, request })) };
    const logs = { save: jest.fn(async (log: unknown) => log) };
    const delivery = new SmsTriggerDeliveryService(aligo as never, {} as never, logs as never, undefined, undefined, gate, undefined, settings as never, f.templates);
    const jobRepository = { findForClientAutomationReview: jest.fn(async () => jobs), upsertPendingForRuleGeneration: jest.fn(async (job: MessageTriggerJobEntity, version: Date, stale: boolean, preserve: boolean, tx: unknown) => {
        expect(version).toBeInstanceOf(Date); expect(stale).toBe(false); expect(preserve).toBe(true); expect(tx).toBe(db);
        const previous = jobs.find((row) => row.dedupeKey === job.dedupeKey);
        if (previous) return timingJobCopy(previous);
        const saved = Object.assign(timingJobCopy(job), { id: `55000000-0000-4000-8000-${String(jobs.length + 1).padStart(12, "0")}` });
        jobs.push(structuredClone(saved)); return saved;
    }) };
    const core = new MessageTriggerService(db as never, delivery as never, approval as never, repository as never, jobRepository as never, {} as never, {} as never, {} as never,
        settings as never, undefined, activation as never, lock, sources, gate, undefined, undefined, resolver, f.templates);
    const options = { preserveExisting: true, stableBatchAt: new Date("2026-11-05T12:00:00Z") };
    const sync = () => core.syncClientRulesForClient(branchId, 7, true, false, options);
    const render = (job: MessageTriggerJobEntity, tx: Parameters<typeof delivery.resolveCanonicalDeliverySnapshot>[1]) => delivery.resolveCanonicalDeliverySnapshot(job, tx);
    const preparation = async (job: MessageTriggerJobEntity) => {
        job.markProcessing("timing-claim"); Object.assign(jobs.find((row) => row.id === job.id)!, structuredClone(job));
        return gate.authorizePreparation(job, render as never, async () => ({ kind: "allow" }));
    };
    const send = async (job: MessageTriggerJobEntity) => {
        if ((await preparation(job)).kind !== "allow") return false;
        const prepared = await delivery.prepareJob(job); if (!prepared) return false;
        Object.assign(jobs.find((row) => row.id === job.id)!, structuredClone(job));
        const permit = await gate.authorizeDispatch(job, prepared, render as never, async (tx) => {
            const changed = await tx.message_trigger_job.updateMany({ where: { id: job.id, status: "processing", claimToken: job.claimToken }, data: { status: "dispatching" } });
            return changed.count === 1 ? { kind: "allow" } : { kind: "lost" };
        });
        if (permit.kind !== "allow") return false; job.status = "dispatching";
        return delivery.sendPreparedJob(job, prepared);
    };
    return { ...f, rules, ruleOrder, clientRule, jobs, db, sources, resolver, settings, core, jobRepository, authority, gate, delivery, aligo, logs, sync, preparation, send };
}

describe("Phase7 C3 canonical caregiver catch-up timing", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => { jest.useRealTimers(); });
    it("refuses OFF past candidates before persistence while allowing future CARE through the actual final permit", async () => {
        const past = await timingFixture(false); await past.sync();
        expect(past.jobs).toEqual([]); expect(past.jobRepository.upsertPendingForRuleGeneration).not.toHaveBeenCalled();
        expect(past.aligo.sendSms).not.toHaveBeenCalled();
        const future = await timingFixture(false, true); await future.sync();
        expect(future.jobs.map((job) => [job.status, job.scheduledFor.toISOString(), job.payload.catchUp])).toEqual([
            ["pending", "2026-11-06T00:00:00.000Z", undefined], ["pending", "2026-11-06T00:00:00.000Z", undefined] ]);
        expect(await future.send(Object.assign(timingJobCopy(future.jobs[0]!), { id: future.jobs[0]!.id }))).toBe(true);
        expect(future.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("uses secondary-first literal three-minute slots, stable occurrence keys and replay, with actual authority and final permit", async () => {
        const f = await timingFixture(true); await f.sync();
        expect(f.jobs.map((job) => [job.ruleId, job.status, job.scheduledFor.toISOString(), job.dedupeKey, job.payload.catchUp])).toEqual([
            ["child-secondary", "pending", "2026-11-05T12:00:00.000Z", "group:group-a:child:child-secondary:schedule:91:event:SERVICE_START:employee:12",
                { batchId: "client:7:2026-11-05T12:00:00.000Z", sequence: 1, intervalMinutes: 3, originalScheduledFor: "2026-11-05T00:00:00.000Z", predecessorDedupeKey: null }],
            ["child-primary", "pending", "2026-11-05T12:03:00.000Z", "group:group-a:child:child-primary:schedule:91:event:SERVICE_START:employee:11",
                { batchId: "client:7:2026-11-05T12:00:00.000Z", sequence: 2, intervalMinutes: 3, originalScheduledFor: "2026-11-05T00:00:00.000Z", predecessorDedupeKey: "group:group-a:child:child-secondary:schedule:91:event:SERVICE_START:employee:12" }],
        ]);
        const before = structuredClone(f.jobs); await f.sync(); expect(f.jobs).toEqual(before);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
        const primary = Object.assign(timingJobCopy(f.jobs[1]!), { id: f.jobs[1]!.id });
        expect(await f.send(primary)).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000011", message: "합성 주 관리사님, 합성 고객 고객님의 서비스가 2026-11-05에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - 합성 지점" }));
        expect(await f.send(primary)).toBe(false); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each([
        ["child-secondary", "child-client", "child-primary"],
        ["child-client", "child-secondary", "child-primary"],
        ["child-secondary", "child-primary", "child-client"],
    ])("shares one same-transaction ordered batch beginning with %s, %s, %s", async (first, second, third) => {
        const f = await timingFixture(true, false, true); f.ruleOrder.splice(0, 3, first, second, third); await f.sync();
        expect(f.jobs.map((job) => [job.ruleId, job.status, job.scheduledFor.toISOString(), job.payload.catchUp?.sequence])).toEqual([
            [first, "pending", "2026-11-05T12:00:00.000Z", 1], [second, "pending", "2026-11-05T12:03:00.000Z", 2], [third, "pending", "2026-11-05T12:06:00.000Z", 3] ]);
        expect(f.db.$transaction).toHaveBeenCalledTimes(1);
        for (const call of f.jobRepository.upsertPendingForRuleGeneration.mock.calls) expect(call[4]).toBe(f.db);
        expect(f.db.message_trigger_job.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { dedupeKey: f.jobs[0]!.dedupeKey } }));
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("rolls back the partial mixed batch when the second persisted child fails", async () => {
        const f = await timingFixture(true, false, true);
        const persist = f.jobRepository.upsertPendingForRuleGeneration.getMockImplementation()!;
        let writes = 0;
        f.jobRepository.upsertPendingForRuleGeneration.mockImplementation(async (...args) => {
            if (++writes === 2) throw new Error("synthetic second-child persistence failure"); return persist(...args);
        });
        await expect(f.sync()).rejects.toThrow("synthetic second-child persistence failure");
        expect(writes).toBe(2); expect(f.jobs).toEqual([]); expect(f.db.$transaction).toHaveBeenCalledTimes(1); expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it.each(["OFF", "interval", "order", "due", "raw-due", "missing-predecessor", "malformed", "source"])("refuses %s catch-up changes without provider work", async (change) => {
        const f = await timingFixture(true); await f.sync();
        const job = Object.assign(timingJobCopy(f.jobs.find((row) => row.ruleId === "child-primary")!), { id: f.jobs.find((row) => row.ruleId === "child-primary")!.id });
        if (change === "OFF") f.settings.getMessageSettingsPolicyEnabled.mockResolvedValue(false);
        if (change === "interval") f.settings.getMessageAutomationPastTriggerConfig.mockResolvedValue({ sendIntervalMinutes: 4, ruleOrder: f.ruleOrder });
        if (change === "order") f.ruleOrder.reverse();
        if (change === "due") job.scheduledFor = new Date("2026-11-05T12:04:00Z");
        if (change === "raw-due") job.payload.catchUp = { ...job.payload.catchUp!, originalScheduledFor: "2026-11-04T00:00:00.000Z" };
        if (change === "missing-predecessor") f.jobs.splice(f.jobs.findIndex((row) => row.ruleId === "child-secondary"), 1);
        if (change === "malformed") Object.assign(job.payload, { catchUp: { batchId: "forged" } });
        if (change === "source") f.schedule.primaryEmployee.phone = "01000000099";
        expect(await f.send(job)).toBe(false); expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.logs.save).not.toHaveBeenCalled();
    });
});


// Phase7 C4: extend only the synthetic boundaries; all approved C3 fixtures and tests above remain byte-identical.
async function c4TimingFixture(mixed = false, reviewed = false) {
    const f = await timingFixture(true, false, mixed);
    f.jobRepository.findForClientAutomationReview.mockImplementation(async () => f.jobs.filter((row) => row.employeeScheduleId !== null).map(timingJobCopy));
    Object.assign(f.delivery, { systemTemplateService: { getByKeyForBranch: async () => ({ id: "synthetic-info", content: "{{clientName}} 안내",
        requiredVariables: [], customVariables: [], updatedAt: new Date("2026-10-01T00:00:00Z") }) } });
    const update = jest.fn(async (job: MessageTriggerJobEntity) => {
        Object.assign(f.jobs.find((row) => row.id === job.id)!, structuredClone(job)); return job;
    });
    Object.assign(f.jobRepository, { update });
    const terminalRows: Array<Record<string, unknown>> = [];
    Object.assign(f.db.message_trigger_job, { findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] }; dedupeKey?: { startsWith: string } } }) => where.id
        ? terminalRows.filter((row) => where.id!.in.includes(String(row["id"]))) : where.dedupeKey
            ? terminalRows.filter((row) => String(row["dedupeKey"]).startsWith(where.dedupeKey!.startsWith)) : terminalRows) });
    let reference: ReturnType<typeof agentAutomationTaskCommitReference> | undefined;
    if (reviewed) {
        const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
        const recordedAt = "2026-11-04T23:00:00.000Z";
        jest.setSystemTime(new Date(recordedAt));
        // Explicit synthetic configuration and unrelated legacy-resource boundaries,
        // as in the approved C3 committed-reference fixture; CARE facts stay on the actual source reader/resolver.
        jest.spyOn(f.sources, "readClientAutomationSettings").mockResolvedValue({ status: "available", rules: f.rules, defaultsPresent: true,
            dispatchEnabled: true, senderApproved: true, senderApprovedAt: null, pastTriggerEnabled: true,
            pastTriggerConfig: { sendIntervalMinutes: 3, ruleOrder: f.ruleOrder } });
        jest.spyOn(f.sources, "readClientAutomationSchedules").mockResolvedValue([]);
        jest.spyOn(f.sources, "readClientAutomationServiceRecordLinks").mockResolvedValue([]);
        const impact = new ClientAutomationImpactService(f.sources, f.delivery,
            { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) } as never, f.jobRepository as never, undefined, f.resolver);
        const plan = await impact.planClientWrite(branchId, { kind: "update", clientId: 7, values: { name: "검토 합성 고객" } });
        expect(plan.availability).toBe("available"); expect(plan.complete).toBe(true);
        expect(plan.effects.map((effect) => effect.kind).sort()).toEqual(mixed ? ["caregiver-service", "caregiver-service", "client-rule"] : ["caregiver-service", "caregiver-service"]);
        const origin = { kind: "task" as const, userId: id(1), actionId: id(2), taskId: id(3), taskRevision: 1, consentEventId: id(4) };
        const authorities: AgentAutomationAuthority[] = [], coverages: AgentAutomationCoverage[] = [];
        for (const [index, effect] of plan.effects.entries()) {
            const scope: AgentAutomationScope = { branchId, clientId: 7,
                clientIdentity: agentBindingHash({ version: 1, resource: "client", id: 7, createdAt: f.client.createdAt.toISOString() }),
                kind: effect.kind, ruleId: effect.ruleId, scheduleId: effect.scheduleId, scheduleIdentity: effect.scheduleId === null ? null : agentAutomationScheduleIdentity(incarnationId), recipientType: effect.recipientType };
            const coverage: AgentAutomationCoverage = { kind: "coverage", version: 1, id: id(100 + index), scope: agentAutomationCoverageScope(scope), sequence: 1, previousId: null,
                origin, mutationDigest: "a".repeat(64), grandfatheredScopes: [], recordedAt, recordDigest: "" };
            coverage.recordDigest = agentAutomationCoverageRecordDigest(coverage); coverages.push(coverage);
            const authority: AgentAutomationAuthority = { version: 1, id: id(200 + index), scope, sequence: 1, previousId: null, origin, decision: "allow", noSend: false,
                effects: [effect], scopeEffectDigest: agentAutomationEffectDigest([effect]), reviewedEffectDigest: agentAutomationEffectDigest([effect]), reviewedPolicyDigest: effect.policyDigest, recordedAt, recordDigest: "" };
            authority.recordDigest = agentAutomationRecordDigest(authority); authorities.push(authority);
        }
        for (const record of [...authorities, ...coverages]) {
            const terminal = createAgentAutomationTerminalRecord(record, { version: 1, kind: "task", actionId: id(2), userId: id(1), taskId: id(3), taskRevision: 1,
                questionRef: id(5), inputHash: "a".repeat(64), capability: "clients.update", resourceId: 7, receiptDigest: "a".repeat(64), recordedAt });
            terminalRows.push({ id: record.id, branchId, ruleId: "system:message_automation_intent", dedupeKey: agentAutomationRecordKey(record), status: "canceled", cancelReason: "agent_automation_authority_record",
                canceledAt: new Date(recordedAt), scheduledFor: new Date(recordedAt), sentAt: null, clientId: null, employeeScheduleId: null, recipientPhone: null, recipientType: "CLIENT", templateKey: "CLIENT_GREETING",
                nextAttemptAt: null, claimToken: null, attempts: 0, canceledByUser: false, payload: { agentAutomationRecord: terminal } });
        }
        reference = agentAutomationTaskCommitReference({ actionId: id(2), taskId: id(3), taskRevision: 1, batch: { authorities, coverages } });
        const records = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(f.db as never));
        expect(await records.verifyTaskCommitReference(f.db as never, reference, branchId)).toBe(true);
        f.client.name = "검토 합성 고객";
        jest.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    }
    const sync = (batch = "2026-11-05T12:00:00Z") => f.core.syncClientRulesForClient(branchId, 7, true, false,
        { preserveExisting: true, stableBatchAt: new Date(batch), ...(reference ? { taskOrigin: true, taskAutomationReference: reference } : {}) });
    const postpone = (job: MessageTriggerJobEntity, resend = false) => (f.core as unknown as {
        postponeCatchUpJobUntilPredecessorCompletes: (job: MessageTriggerJobEntity, resend?: boolean) => Promise<boolean>;
    }).postponeCatchUpJobUntilPredecessorCompletes(job, resend);
    const complete = (job: MessageTriggerJobEntity) => { job.status = "sent"; job.sentAt = new Date(); job.nextAttemptAt = null; };
    return { ...f, sync, postpone, update, complete, reference, terminalRows };
}

describe("Phase7 C4 completed slots and canonical predecessor retry", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([false, true])("keeps one mixed CLIENT occurrence after CARE completes, reviewed=%s", async (reviewed) => {
        const f = await c4TimingFixture(true, reviewed); await f.sync();
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!;
        expect(await f.send(timingJobCopy(secondary))).toBe(true); f.complete(secondary);
        const history = structuredClone(secondary);
        const client = f.jobs.find((row) => row.ruleId === "child-client")!;
        expect(client.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z");
        expect(client.dedupeKey).toBe("child-client:client:7:CLIENT:2026-11-05T12:03:00.000Z");
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        const clients = f.jobs.filter((row) => row.ruleId === "child-client");
        expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({ id: client.id, dedupeKey: "child-client:client:7:CLIENT:2026-11-05T12:03:00.000Z", scheduledFor: new Date("2026-11-05T12:03:00Z") });
        expect(secondary).toEqual(history);
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z")); expect(await f.postpone(clients[0]!)).toBe(false);
        expect(await f.send(timingJobCopy(clients[0]!))).toBe(true);
        f.complete(clients[0]!); await f.sync();
        expect(f.jobs.filter((row) => row.ruleId === "child-client")).toHaveLength(1);
        expect(f.aligo.sendSms.mock.calls.filter(([request]) => request.receiver === "01000000007")).toHaveLength(1);
        expect(secondary).toEqual(history);
    });
    it("preserves an all-pending mixed replay and a user-canceled CARE slot without resurrection", async () => {
        const f = await c4TimingFixture(true); await f.sync(); const initial = structuredClone(f.jobs); await f.sync(); expect(f.jobs).toEqual(initial);
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!;
        Object.assign(secondary, { status: "canceled", canceledByUser: true, canceledAt: new Date() });
        const canceled = structuredClone(secondary);
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        expect(f.jobs).toHaveLength(3); expect(secondary).toEqual(canceled);
        expect(f.jobs.find((row) => row.ruleId === "child-client")?.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z");
        expect(f.jobRepository.upsertPendingForRuleGeneration.mock.calls.filter(([job]) => job.ruleId === "child-secondary")).toHaveLength(2);
    });
    it("does not reuse a completed slot from a different intent batch", async () => {
        const f = await c4TimingFixture(true); await f.sync();
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!; f.complete(secondary); const history = structuredClone(secondary);
        jest.setSystemTime(new Date("2026-11-05T13:00:00Z")); await f.sync("2026-11-05T13:00:00Z");
        const next = f.jobs.find((row) => row.ruleId === "child-client" && row.scheduledFor.toISOString() === "2026-11-05T13:00:00.000Z")!;
        expect(next).toMatchObject({ dedupeKey: "child-client:client:7:CLIENT:2026-11-05T13:00:00.000Z", payload: { catchUp: {
            batchId: "client:7:2026-11-05T13:00:00.000Z", sequence: 1, predecessorDedupeKey: null } } });
        expect(secondary).toEqual(history);
    });
    it.each([false, true])("waits using operational retry eligibility then obtains the canonical CARE final permit, reviewed=%s", async (reviewed) => {
        const f = await c4TimingFixture(false, reviewed); await f.sync();
        const primary = timingJobCopy(f.jobs.find((row) => row.ruleId === "child-primary")!);
        const canonical = { scheduledFor: primary.scheduledFor.toISOString(), dedupeKey: primary.dedupeKey, digest: agentAutomationConcreteJobDigest(primary), seal: structuredClone(primary.payload.agentAutomationSeal) };
        if (reviewed) expect(primary.payload.agentAutomationSeal).toBeDefined();
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(primary)).toBe(true);
        expect(primary.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z");
        expect(primary.nextAttemptAt?.toISOString()).toBe("2026-11-05T12:06:00.000Z"); expect(primary.attempts).toBe(0);
        expect({ scheduledFor: primary.scheduledFor.toISOString(), dedupeKey: primary.dedupeKey, digest: agentAutomationConcreteJobDigest(primary), seal: primary.payload.agentAutomationSeal }).toEqual(canonical);
        expect(f.jobs.find((row) => row.id === primary.id)?.nextAttemptAt?.toISOString()).toBe("2026-11-05T12:06:00.000Z");
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!; f.complete(secondary);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z")); expect(await f.postpone(primary)).toBe(false);
        expect(await f.send(primary)).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1); expect(f.aligo.sendSms).toHaveBeenCalledWith(expect.objectContaining({ receiver: "01000000011" }));
    });
    it("keeps manual resend waiting in needs_setup with canonical time and no provider", async () => {
        const f = await c4TimingFixture(); await f.sync(); const primary = timingJobCopy(f.jobs.find((row) => row.ruleId === "child-primary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(primary, true)).toBe(true);
        expect(primary.status).toBe("needs_setup"); expect(primary.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z"); expect(primary.nextAttemptAt).toBeNull(); expect(primary.attempts).toBe(0);
        expect(f.aligo.sendSms).not.toHaveBeenCalled();
    });
    it("allows the unpostponed canonical CARE slot once its predecessor interval has elapsed", async () => {
        const f = await c4TimingFixture(); await f.sync();
        f.complete(f.jobs.find((row) => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
        const primary = timingJobCopy(f.jobs.find((row) => row.ruleId === "child-primary")!);
        expect(await f.postpone(primary)).toBe(false); expect(primary.nextAttemptAt).toBeNull();
        expect(primary.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z");
        expect(await f.send(primary)).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each(["due", "source", "metadata", "predecessor"])("refuses %s tampering after legitimate sealed CARE postponement", async (change) => {
        const f = await c4TimingFixture(false, true); await f.sync();
        const primary = timingJobCopy(f.jobs.find((row) => row.ruleId === "child-primary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(primary)).toBe(true);
        f.complete(f.jobs.find((row) => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        if (change === "due") primary.scheduledFor = new Date("2026-11-05T12:06:00Z");
        if (change === "source") f.schedule.primaryEmployee.phone = "01000000099";
        if (change === "metadata") primary.payload.catchUp!.originalScheduledFor = "2026-11-04T00:00:00.000Z";
        if (change === "predecessor") f.jobs.splice(f.jobs.findIndex((row) => row.ruleId === "child-secondary"), 1);
        expect(await f.send(primary)).toBe(false); expect(f.aligo.sendSms).not.toHaveBeenCalled(); expect(f.logs.save).not.toHaveBeenCalled();
    });

});

// Phase7 C4b: active-catalog change is a direct continuation of the same replay invariant.
describe("Phase7 C4b stable mixed replay after CARE catalog deactivation", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([
        { deactivate: false, reviewed: false }, { deactivate: true, reviewed: false },
        { deactivate: false, reviewed: true }, { deactivate: true, reviewed: true },
    ])("retains CLIENT identity and current-policy delivery for %j", async ({ deactivate, reviewed }) => {
        const f = await c4TimingFixture(true, reviewed);
        // The production repository returns only active rows; keep this correction local to the new regression.
        (f.core as unknown as { ruleRepository: { findActiveByEventTypes: jest.Mock } }).ruleRepository.findActiveByEventTypes
            .mockImplementation(async () => f.rules.filter((rule) => rule.isActive));
        Object.assign(f.jobRepository, { findForClientAutomationReview: jest.fn(async (scope: string, clientId: number, ruleIds: string[]) =>
            f.jobs.filter((row) => row.branchId === scope && row.clientId === clientId && ruleIds.includes(row.ruleId)).map(timingJobCopy)) });
        const effectiveOrder = () => f.ruleOrder.filter((id) => f.rules.some((rule) => rule.id === id && rule.isActive));
        f.settings.getMessageAutomationPastTriggerConfig.mockImplementation(async () => ({ sendIntervalMinutes: 3, ruleOrder: effectiveOrder() }));
        if (reviewed) jest.spyOn(f.sources, "readClientAutomationSettings").mockImplementation(async () => ({ status: "available", rules: f.rules, defaultsPresent: true,
            dispatchEnabled: true, senderApproved: true, senderApprovedAt: null, pastTriggerEnabled: true,
            pastTriggerConfig: { sendIntervalMinutes: 3, ruleOrder: effectiveOrder() } }));
        await f.sync();
        const originalClient = f.jobs.find((row) => row.ruleId === "child-client")!;
        const originalId = originalClient.id;
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!;
        expect(await f.send(timingJobCopy(secondary))).toBe(true); f.complete(secondary);
        const history = structuredClone(secondary);
        if (deactivate) for (const rule of f.rules.filter((rule) => rule.recipientType !== "CLIENT")) rule.isActive = false;
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        const clients = f.jobs.filter((row) => row.ruleId === "child-client");
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z"));
        const deliveries: Array<{ id: string; due: string; allowed: boolean }> = [];
        for (const row of clients) {
            const blocked = row.status !== "pending" || await f.postpone(row);
            deliveries.push({ id: row.id, due: row.scheduledFor.toISOString(), allowed: !blocked && await f.send(timingJobCopy(row)) });
        }
        console.log("C4B_CATALOG_REPLAY", JSON.stringify({ deactivate, reviewed, clients: clients.map((row) => ({ id: row.id, due: row.scheduledFor.toISOString(), key: row.dedupeKey, status: row.status })), deliveries }));
        expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({ id: originalId, dedupeKey: "child-client:client:7:CLIENT:2026-11-05T12:03:00.000Z", scheduledFor: new Date("2026-11-05T12:03:00Z") });
        // Inactive explicit order entries are pruned in production: the old reviewed policy must then refuse.
        const allowed = !(deactivate && reviewed);
        expect(deliveries).toEqual([{ id: originalId, due: "2026-11-05T12:03:00.000Z", allowed }]);
        expect(f.aligo.sendSms.mock.calls.filter(([request]) => request.receiver === "01000000007")).toHaveLength(allowed ? 1 : 0);
        expect(secondary).toEqual(history);
    });
    it("retains the mixed CLIENT slot through the joint path when only unrelated future END CARE remains active", async () => {
        const f = await c4TimingFixture(true);
        const end = Object.assign(MessageTriggerRuleEntity.create({ branchId, name: "future END", groupId: "group-end", isActive: true,
            eventType: MessageTriggerEventType.SERVICE_END, offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "09:00",
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE, templateKey: MessageTriggerTemplateKey.CAREGIVER_SERVICE_END_NOTICE }), { id: "child-end", jobsStale: false });
        f.rules.push(end);
        const repository = (f.core as unknown as { ruleRepository: { findActiveByEventTypes: jest.Mock } }).ruleRepository;
        repository.findActiveByEventTypes.mockImplementation(async () => f.rules.filter((rule) => rule.isActive));
        Object.assign(repository, { findGroup: jest.fn(async (scope: string, id: string) => scope === branchId ? { id, version: 3 } : null),
            findGroupRules: jest.fn(async (scope: string, id: string) => f.rules.filter((rule) => rule.branchId === scope && rule.groupId === id)) });
        Object.assign(f.jobRepository, { findForClientAutomationReview: jest.fn(async (scope: string, clientId: number, ruleIds: string[]) =>
            f.jobs.filter((row) => row.branchId === scope && row.clientId === clientId && ruleIds.includes(row.ruleId)).map(timingJobCopy)) });
        f.settings.getMessageAutomationPastTriggerConfig.mockImplementation(async () => ({ sendIntervalMinutes: 3,
            ruleOrder: f.ruleOrder.filter((id) => f.rules.some((rule) => rule.id === id && rule.isActive)) }));
        await f.sync();
        const client = f.jobs.find((row) => row.ruleId === "child-client")!; const originalId = client.id;
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!;
        expect(await f.send(timingJobCopy(secondary))).toBe(true); f.complete(secondary); const history = structuredClone(secondary);
        const endHistory = structuredClone(f.jobs.find((row) => row.ruleId === "child-end")!);
        for (const rule of f.rules.filter((rule) => rule.eventType === "SERVICE_START" && rule.recipientType !== "CLIENT")) rule.isActive = false;
        expect(f.rules.filter((rule) => rule.isActive).map((rule) => rule.id)).toEqual(["child-client", "child-end"]);
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        const clients = f.jobs.filter((row) => row.ruleId === "child-client"); expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({ id: originalId, dedupeKey: "child-client:client:7:CLIENT:2026-11-05T12:03:00.000Z", scheduledFor: new Date("2026-11-05T12:03:00Z") });
        expect(f.jobs.find((row) => row.ruleId === "child-end")).toEqual(endHistory); expect(secondary).toEqual(history);
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z")); expect(await f.postpone(clients[0]!)).toBe(false);
        expect(await f.send(timingJobCopy(clients[0]!))).toBe(true);
        expect(f.aligo.sendSms.mock.calls.filter(([request]) => request.receiver === "01000000007")).toHaveLength(1);
    });

});

// Phase7 C5: reproduce the immutable Round2 scheduler proof through the existing real collaborators.
function c5Scheduler(f: Awaited<ReturnType<typeof c4TimingFixture>>, jobs: MessageTriggerJobEntity[], retryEnabled: boolean) {
    const runtime = f.core as unknown as Record<string, unknown>;
    runtime["reclaimStaleProcessingJobs"] = jest.fn(async () => undefined);
    runtime["recoverApprovedBranches"] = jest.fn(async () => undefined);
    runtime["processStaleRuleRebuilds"] = jest.fn(async () => undefined);
    runtime["messageLogRepository"] = { findSentTriggerJobIdsSystemScope: jest.fn(async () => new Set()) };
    Object.assign(runtime["messageSenderApprovalService"] as object, { getApprovedBranchIds: jest.fn(async () => new Set([branchId])) });
    (f.settings.getMessageSettingsPolicyEnabled as jest.Mock).mockImplementation(async (_branch: string, policy?: string) => policy !== "trigger-job-retry" || retryEnabled);
    Object.assign(f.jobRepository, { cancelOrphanedPending: jest.fn(async () => undefined),
        findDueDispatchBranchIds: jest.fn(async () => [branchId]), consumeDispatchSlotsAndFindDueJobs: jest.fn(async () => jobs) });
    // SQL selection has its own adapter and real-DB tests; intentionally expose every supplied row to the consumer.
    const reached = jest.fn(async () => true);
    runtime["dispatchClaimedJob"] = reached;
    return reached;
}
describe("Phase7 C5 exact Round2 operational-wait reproduction", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it("original mixed replay retains CLIENT identity and actual permit", async () => {
        const f = await c4TimingFixture(true); await f.sync();
        const client = structuredClone(f.jobs.find(row => row.ruleId === "child-client")!);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        const clients = f.jobs.filter(row => row.ruleId === "child-client");
        expect(clients).toHaveLength(1); expect(clients[0]).toMatchObject({ id: client.id, dedupeKey: client.dedupeKey, scheduledFor: new Date("2026-11-05T12:03:00Z") });
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z"));
        expect(await f.send(timingJobCopy(clients[0]!))).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("original CARE wait preserves canonical time and obtains final permit", async () => {
        const f = await c4TimingFixture(); await f.sync();
        const primary = timingJobCopy(f.jobs.find(row => row.ruleId === "child-primary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(primary)).toBe(true);
        expect(primary).toMatchObject({ scheduledFor: new Date("2026-11-05T12:03:00Z"), nextAttemptAt: new Date("2026-11-05T12:06:00Z"), attempts: 0 });
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z")); expect(await f.postpone(primary)).toBe(false);
        expect(await f.send(primary)).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each([[true, true], [false, true], [false, false]])("actual scheduler retry=%s wait=%s resumes unattempted CARE", async (retryEnabled, wait) => {
        const f = await c4TimingFixture(); await f.sync();
        const primary = timingJobCopy(f.jobs.find(row => row.ruleId === "child-primary")!);
        const identity = { time: primary.scheduledFor, key: primary.dedupeKey, digest: agentAutomationConcreteJobDigest(primary) };
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); if (wait) expect(await f.postpone(primary)).toBe(true);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z")); expect(await f.postpone(primary)).toBe(false);
        const reached = c5Scheduler(f, [primary], retryEnabled);
        await f.core.dispatchDueJobs(); expect(reached).toHaveBeenCalledTimes(1);
        expect({ time: primary.scheduledFor, key: primary.dedupeKey, digest: agentAutomationConcreteJobDigest(primary) }).toEqual(identity);
        expect(primary.attempts).toBe(0);
        expect(await f.send(primary)).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
});

describe("Phase7 C5 actual CARE failure and sealed-wait controls", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([false, true])("keeps actual transient failure retry policy=%s", async retryEnabled => {
        const f = await c4TimingFixture(); await f.sync();
        const primary = timingJobCopy(f.jobs.find(row => row.ruleId === "child-primary")!);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
        primary.defer("transient", "synthetic provider rejection", 3 * 60_000);
        expect(primary.attempts).toBe(1); expect(primary.nextAttemptAt).toEqual(new Date("2026-11-05T12:06:00Z"));
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        const reached = c5Scheduler(f, [primary], retryEnabled); await f.core.dispatchDueJobs();
        expect(reached).toHaveBeenCalledTimes(retryEnabled ? 1 : 0);
        if (retryEnabled) expect(await f.send(primary)).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(retryEnabled ? 1 : 0);
    });
    it.each([false, true])("resumes a sealed unattempted wait with retry OFF, sourceChanged=%s", async sourceChanged => {
        const f = await c4TimingFixture(false, true); await f.sync();
        const primary = timingJobCopy(f.jobs.find(row => row.ruleId === "child-primary")!);
        const seal = structuredClone(primary.payload.agentAutomationSeal);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(primary)).toBe(true);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        const reached = c5Scheduler(f, [primary], false); await f.core.dispatchDueJobs(); expect(reached).toHaveBeenCalledTimes(1);
        if (sourceChanged) f.schedule.primaryEmployee.phone = "01000000099";
        expect(await f.send(primary)).toBe(!sourceChanged);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(sourceChanged ? 0 : 1);
        expect(primary.payload.agentAutomationSeal).toEqual(seal);
        expect(primary.scheduledFor).toEqual(new Date("2026-11-05T12:03:00Z")); expect(primary.attempts).toBe(0);
    });
});

function c6StoredCareLookup(rows: MessageTriggerJobEntity[], query: unknown) {
    const { where } = query as { where: { id?: string; branchId: string; clientId: number; AND: Array<{ payload: { equals: unknown } }> } };
    if (where.id) return structuredClone(rows.find(row => row.id === where.id) ?? null);
    return structuredClone(rows.find(row => row.branchId === where.branchId && row.clientId === where.clientId
        && row.employeeScheduleId !== null && ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"].includes(row.recipientType)
        && ["CAREGIVER_SERVICE_START_NOTICE", "CAREGIVER_SERVICE_END_NOTICE"].includes(row.templateKey)
        && row.payload.catchUp?.batchId === where.AND[0]!.payload.equals
        && row.payload.caregiverSourceSnapshot?.version === where.AND[1]!.payload.equals) ?? null);
}
// Phase7 C6: immutable nine-case parent proof, locally scoped to preserve every approved fixture.
describe("Phase7 C6 exact parent nine-case proof", () => {
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

function timingJobCopy(job: MessageTriggerJobEntity): MessageTriggerJobEntity {
    return Object.assign(Object.create(MessageTriggerJobEntity.prototype), structuredClone(job));
}
async function timingFixture(enabled: boolean, future = false, mixed = false) {
    const f = fixture();
    Object.assign(f.client, { phone: "01000000007", startDate: new Date("2026-11-05T00:00:00Z") });
    f.schedule.startDate = new Date(future ? "2026-11-06T00:00:00Z" : "2026-11-05T00:00:00Z");
    for (const rule of f.rules) Object.assign(rule, { offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "09:00", jobsStale: false });
    const clientRule = MessageTriggerRuleEntity.create({ branchId, name: "CLIENT timing control", groupId: "group-client", isActive: true,
        eventType: MessageTriggerEventType.SERVICE_START, offsetType: MessageTriggerOffsetType.SAME_DAY, offsetDays: 0, sendTime: "09:00",
        recipientType: MessageTriggerRecipientType.CLIENT, templateKey: MessageTriggerTemplateKey.INFO });
    Object.assign(clientRule, { id: "child-client", jobsStale: false });
    const rules = mixed ? [...f.rules, clientRule] : f.rules;
    const ruleOrder = mixed ? ["child-secondary", "child-client", "child-primary"] : ["child-secondary", "child-primary"];
    const repository = { findAll: jest.fn(async () => rules), findActiveByEventTypes: jest.fn(async () => rules),
        findGroup: f.groups.findGroup, findGroupRules: jest.fn(async () => f.rules) };
    const settings = { getMessageSettingsPolicyEnabled: jest.fn(async () => enabled),
        getMessageAutomationPastTriggerConfig: jest.fn(async () => ({ sendIntervalMinutes: 3, ruleOrder })),
        getMessageAutomationPolicyConfig: jest.fn(async () => ({ configuration: defaultMessageAutomationPolicy() })) };
    const approval = { isApproved: jest.fn(async () => true), getApprovedBranches: jest.fn(async () => new Map([[branchId, null]])) };
    const activation = { getTriggerDispatchEnabled: jest.fn(async () => true) };
    const jobs: MessageTriggerJobEntity[] = [];
    const db = Object.assign(f.database, { $queryRawUnsafe: jest.fn(async () => [{ exists: true }]), $executeRaw: jest.fn(async () => 1),
        $transaction: jest.fn(async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
            const before = structuredClone(jobs);
            try { return await work(db as never); } catch (error) { jobs.splice(0, jobs.length, ...before); throw error; }
        }),
        message_trigger_rule_branch_override: { findMany: jest.fn(async () => []) },
        message_trigger_job: {
            findMany: jest.fn(async () => []),
            findFirst: jest.fn(async (query: unknown) => c6StoredCareLookup(jobs, query)),
            findUnique: jest.fn(async ({ where }: { where: { dedupeKey: string } }) => structuredClone(jobs.find((job) => job.dedupeKey === where.dedupeKey) ?? null)),
            updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string; claimToken?: string }; data: Partial<MessageTriggerJobEntity> }) => {
                const job = jobs.find((row) => row.id === where.id && (!where.status || row.status === where.status) && (!where.claimToken || row.claimToken === where.claimToken));
                if (!job) return { count: 0 }; Object.assign(job, structuredClone(data)); return { count: 1 };
            }),
        } });
    Object.assign(db.employee_schedule, { findFirst: jest.fn(async () => f.schedule) });
    const sources = new ClientAutomationSourceReader(db as never, repository as never, { findAllByBranch: async () => [] } as never, approval as never, settings as never, activation as never);
    const resolver = new MessageTriggerRecipientResolverService(sources, f.templates, repository as never);
    const lock = new MessageAutomationBranchLockService(db as never);
    const records = new AgentAutomationRecordStoreService(lock);
    const authority = new AgentAutomationJobAuthorityService(new AgentAutomationAuthorityService(records), sources,
        { read: () => ({ availability: "available", identityDigest: "a".repeat(64) }) } as never, undefined, resolver);
    const gate = new AgentAutomationDeliveryGateService(db as never, lock, authority);
    const aligo = { sendSms: jest.fn(async (request: { receiver: string }) => ({ response: { result_code: 1, message: "성공", msg_id: 9876, success_cnt: 1, error_cnt: 0 }, request })) };
    const logs = { save: jest.fn(async (log: unknown) => log) };
    const delivery = new SmsTriggerDeliveryService(aligo as never, {} as never, logs as never, undefined, undefined, gate, undefined, settings as never, f.templates);
    const jobRepository = { findForClientAutomationReview: jest.fn(async () => jobs), upsertPendingForRuleGeneration: jest.fn(async (job: MessageTriggerJobEntity, version: Date, stale: boolean, preserve: boolean, tx: unknown) => {
        expect(version).toBeInstanceOf(Date); expect(stale).toBe(false); expect(preserve).toBe(true); expect(tx).toBe(db);
        const previous = jobs.find((row) => row.dedupeKey === job.dedupeKey);
        if (previous) return timingJobCopy(previous);
        const saved = Object.assign(timingJobCopy(job), { id: `55000000-0000-4000-8000-${String(jobs.length + 1).padStart(12, "0")}` });
        jobs.push(structuredClone(saved)); return saved;
    }) };
    const core = new MessageTriggerService(db as never, delivery as never, approval as never, repository as never, jobRepository as never, {} as never, {} as never, {} as never,
        settings as never, undefined, activation as never, lock, sources, gate, undefined, undefined, resolver, f.templates);
    const options = { preserveExisting: true, stableBatchAt: new Date("2026-11-05T12:00:00Z") };
    const sync = () => core.syncClientRulesForClient(branchId, 7, true, false, options);
    const render = (job: MessageTriggerJobEntity, tx: Parameters<typeof delivery.resolveCanonicalDeliverySnapshot>[1]) => delivery.resolveCanonicalDeliverySnapshot(job, tx);
    const preparation = async (job: MessageTriggerJobEntity) => {
        job.markProcessing("timing-claim"); Object.assign(jobs.find((row) => row.id === job.id)!, structuredClone(job));
        return gate.authorizePreparation(job, render as never, async () => ({ kind: "allow" }));
    };
    const send = async (job: MessageTriggerJobEntity) => {
        if ((await preparation(job)).kind !== "allow") return false;
        const prepared = await delivery.prepareJob(job); if (!prepared) return false;
        Object.assign(jobs.find((row) => row.id === job.id)!, structuredClone(job));
        const permit = await gate.authorizeDispatch(job, prepared, render as never, async (tx) => {
            const changed = await tx.message_trigger_job.updateMany({ where: { id: job.id, status: "processing", claimToken: job.claimToken }, data: { status: "dispatching" } });
            return changed.count === 1 ? { kind: "allow" } : { kind: "lost" };
        });
        if (permit.kind !== "allow") return false; job.status = "dispatching";
        return delivery.sendPreparedJob(job, prepared);
    };
    return { ...f, rules, ruleOrder, clientRule, jobs, db, sources, resolver, settings, core, jobRepository, authority, gate, delivery, aligo, logs, sync, preparation, send };
}



function wireRetry(f: Awaited<ReturnType<typeof timingFixture>>) {
    Object.assign(f.jobRepository, { update: async (job: MessageTriggerJobEntity) => {
        Object.assign(f.jobs.find((row) => row.id === job.id)!, structuredClone(job)); return job;
    } });
    return (job: MessageTriggerJobEntity) => (f.core as unknown as {
        postponeCatchUpJobUntilPredecessorCompletes: (job: MessageTriggerJobEntity) => Promise<boolean>
    }).postponeCatchUpJobUntilPredecessorCompletes(job);
}
describe("Independent C4 R2 exact original scenarios and direct scheduler impact", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it("original completed CARE replay keeps CLIENT at12:03 and sends once", async () => {
        const f = await timingFixture(true, false, true);
        f.jobRepository.findForClientAutomationReview.mockImplementation(async () => f.jobs.filter((row) => row.employeeScheduleId !== null).map(timingJobCopy));
        Object.assign(f.delivery, { systemTemplateService: { getByKeyForBranch: async () => ({ id: "synthetic-info", content: "{{clientName}} 안내", requiredVariables: [], customVariables: [], updatedAt: new Date("2026-10-01T00:00:00Z") }) } });
        await f.sync();
        const initial = structuredClone(f.jobs.find((row) => row.ruleId === "child-client")!);
        const secondary = f.jobs.find((row) => row.ruleId === "child-secondary")!;
        secondary.status="sent"; secondary.sentAt=new Date("2026-11-05T12:00:00Z");
        const sentHistory=structuredClone(secondary);
        jest.setSystemTime(new Date("2026-11-05T12:01:00Z")); await f.sync();
        const clients=f.jobs.filter((row)=>row.ruleId==="child-client");
        expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({id:initial.id,dedupeKey:"child-client:client:7:CLIENT:2026-11-05T12:03:00.000Z",scheduledFor:new Date("2026-11-05T12:03:00Z")});
        expect(secondary).toEqual(sentHistory);
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z"));
        expect(await f.send(timingJobCopy(clients[0]!))).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it("original predecessor wait preserves12:03 and allows actual final permit at12:06", async()=>{
        const f=await timingFixture(true);await f.sync();const postpone=wireRetry(f);
        const primary=timingJobCopy(f.jobs.find((row)=>row.ruleId==="child-primary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));expect(await postpone(primary)).toBe(true);
        expect(primary.scheduledFor.toISOString()).toBe("2026-11-05T12:03:00.000Z");
        expect(primary.nextAttemptAt?.toISOString()).toBe("2026-11-05T12:06:00.000Z");expect(primary.attempts).toBe(0);
        const secondary=f.jobs.find((row)=>row.ruleId==="child-secondary")!;
        secondary.status="sent";secondary.sentAt=new Date("2026-11-05T12:03:00Z");
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));expect(await postpone(primary)).toBe(false);
        expect(await f.send(primary)).toBe(true);expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
    it.each([[true,true],[false,true],[false,false]])("actual scheduler retry-enabled=%s predecessor-wait=%s receives unattempted CARE",async(retryEnabled,wait)=>{
        const f=await timingFixture(true);await f.sync();const postpone=wireRetry(f);
        const primary=timingJobCopy(f.jobs.find((row)=>row.ruleId==="child-primary")!);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));if(wait) expect(await postpone(primary)).toBe(true);
        const secondary=f.jobs.find((row)=>row.ruleId==="child-secondary")!;
        secondary.status="sent";secondary.sentAt=new Date("2026-11-05T12:03:00Z");
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));expect(await postpone(primary)).toBe(false);
        const runtime=f.core as any;
        // Exclude maintenance; exercise the actual tick's live-policy read and final consumer predicate.
        runtime.reclaimStaleProcessingJobs=jest.fn(async()=>{});
        runtime.recoverApprovedBranches=jest.fn(async()=>{});
        runtime.processStaleRuleRebuilds=jest.fn(async()=>{});
        runtime.messageLogRepository={findSentTriggerJobIdsSystemScope:jest.fn(async()=>new Set())};
        runtime.messageSenderApprovalService.getApprovedBranchIds=jest.fn(async()=>new Set([branchId]));
        (f.settings.getMessageSettingsPolicyEnabled as jest.Mock).mockImplementation(async(_branch:string,policy:string)=>policy!=="trigger-job-retry"||retryEnabled);
        Object.assign(f.jobRepository,{
            cancelOrphanedPending:jest.fn(async()=>{}),findDueDispatchBranchIds:jest.fn(async()=>[branchId]),
            // Deliberately return the row even if SQL would exclude it: the actual consumer independently filters it.
            consumeDispatchSlotsAndFindDueJobs:jest.fn(async()=>[primary]),
        });
        const reached=jest.fn(async()=>true);runtime.dispatchClaimedJob=reached;
        await f.core.dispatchDueJobs();
        expect((f.jobRepository as any).consumeDispatchSlotsAndFindDueJobs).toHaveBeenCalledTimes(1);
        expect((f.jobRepository as any).consumeDispatchSlotsAndFindDueJobs).toHaveBeenCalledWith([
            {branchId,automaticEnabled:true,retryEnabled,intervalMinutes:1,pastExpiryHours:24}
        ],new Date("2026-11-05T12:06:00Z"),100,[]);
        console.log("RETRY_OFF_OPERATIONAL_WAIT",JSON.stringify({retryEnabled,wait,attempts:primary.attempts,nextAttemptAt:primary.nextAttemptAt,status:primary.status,reached:reached.mock.calls.length}));
        expect(reached).toHaveBeenCalledTimes(1);
    });
});


describe("Independent phase R2 combined timing seam", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([false, true])("mixed CLIENT follows CARE with predecessor late=%s", async late => {
        const f = await timingFixture(true, false, true);
        Object.assign(f.delivery, { systemTemplateService: { getByKeyForBranch: async () => ({ id: "synthetic-info", content: "{{clientName}} 안내", requiredVariables: [], customVariables: [], updatedAt: new Date("2026-10-01T00:00:00Z") }) } });
        await f.sync(); const postpone = wireRetry(f);
        const secondary = f.jobs.find(row => row.ruleId === "child-secondary")!;
        const client = timingJobCopy(f.jobs.find(row => row.ruleId === "child-client")!);
        if (late) {
            jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
            expect(await postpone(client)).toBe(true);
            secondary.status = "sent"; secondary.sentAt = new Date("2026-11-05T12:03:00Z");
            jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        } else {
            secondary.status = "sent"; secondary.sentAt = new Date("2026-11-05T12:00:00Z");
            jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
        }
        expect(await postpone(client)).toBe(false);
        const sent = await f.send(client);
        console.log("MIXED_CLIENT_WAIT", JSON.stringify({ late, sent, time: client.scheduledFor, key: client.dedupeKey, catchUp: client.payload.catchUp, provider: f.aligo.sendSms.mock.calls.length }));
        expect(sent).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(1);
    });
});


describe("Independent phase R2 CARE after delayed mixed CLIENT", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([false, true])("completes mixed CARE -> CLIENT -> CARE with CLIENT delayed=%s", async late => {
        const f = await timingFixture(true, false, true);
        Object.assign(f.delivery, { systemTemplateService: { getByKeyForBranch: async () => ({ id: "synthetic-info", content: "{{clientName}} 안내", requiredVariables: [], customVariables: [], updatedAt: new Date("2026-10-01T00:00:00Z") }) } });
        await f.sync(); const postpone = wireRetry(f);
        const secondary = f.jobs.find(row => row.ruleId === "child-secondary")!;
        const client = timingJobCopy(f.jobs.find(row => row.ruleId === "child-client")!);
        const primary = timingJobCopy(f.jobs.find(row => row.ruleId === "child-primary")!);
        if(late) {
            jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
            expect(await postpone(client)).toBe(true);
        }
        expect(await f.send(timingJobCopy(secondary))).toBe(true);
        Object.assign(secondary, {status:"sent",sentAt:new Date()});
        jest.setSystemTime(new Date(late ? "2026-11-05T12:06:00Z" : "2026-11-05T12:03:00Z"));
        expect(await postpone(client)).toBe(false);
        expect(await f.send(client)).toBe(true);
        Object.assign(f.jobs.find(row=>row.id===client.id)!, {status:"sent", sentAt:new Date()});
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        if(late) { expect(await postpone(primary)).toBe(true); jest.setSystemTime(new Date("2026-11-05T12:09:00Z")); }
        expect(await postpone(primary)).toBe(false);
        const chain = await (f.authority as any).hasCanonicalCatchUpPredecessorChain(f.db, primary, primary.payload.catchUp, f.rules, f.client, new Date("2026-11-05T12:00:00Z"), undefined, f.ruleOrder);
        const sent = await f.send(primary);
        console.log("MIXED_CARE_AFTER_CLIENT_WAIT", JSON.stringify({late, chain, sent, careTime: primary.scheduledFor, next: primary.nextAttemptAt, clientTime:client.scheduledFor, clientCatchUp:client.payload.catchUp, provider:f.aligo.sendSms.mock.calls.length}));
        expect(sent).toBe(true); expect(f.aligo.sendSms).toHaveBeenCalledTimes(3);
    });
});

});

// Phase7 C6: direct mixed order, replay and current-permission controls.
describe("Phase7 C6 persisted mixed CLIENT wait identity", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each(["CARE-CLIENT-CARE", "CLIENT-CLIENT-CARE", "CARE-CLIENT-CARE-CLIENT"])("delivers every canonical %s slot after delay with retry OFF", async order => {
        const f = await c4TimingFixture(true);
        Object.assign(f.db.message_trigger_job, { findFirst: jest.fn(async (query: unknown) => c6StoredCareLookup(f.jobs, query)) });
        if (order !== "CARE-CLIENT-CARE") {
            const secondClient = Object.assign(Object.create(MessageTriggerRuleEntity.prototype), structuredClone(f.clientRule), { id: "child-client-two", createdAt: new Date(f.clientRule.createdAt), updatedAt: new Date(f.clientRule.updatedAt) }) as MessageTriggerRuleEntity;
            f.rules.push(secondClient);
            if (order === "CLIENT-CLIENT-CARE") f.rules.splice(f.rules.findIndex(rule => rule.id === "child-secondary"), 1);
            f.ruleOrder.splice(0, f.ruleOrder.length, ...(order === "CLIENT-CLIENT-CARE" ? ["child-client", "child-client-two", "child-primary"] : ["child-secondary", "child-client", "child-primary", "child-client-two"]));
        }
        await f.sync(); const jobs = f.jobs.slice().sort((a, b) => a.payload.catchUp!.sequence - b.payload.catchUp!.sequence);
        const identities = structuredClone(jobs.map(job => ({ id: job.id, time: job.scheduledFor, key: job.dedupeKey, catchUp: job.payload.catchUp })));
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z"));
        for (const [index, row] of jobs.entries()) {
            const job = timingJobCopy(row);
            if (index > 0) {
                expect(await f.postpone(job)).toBe(true);
                const due = new Date(Date.now() + 3 * 60_000);
                expect(job.nextAttemptAt).toEqual(due); expect(job.scheduledFor).toEqual(identities[index]!.time); expect(job.attempts).toBe(0);
                jest.setSystemTime(due); expect(await f.postpone(job)).toBe(false);
                const reached = c5Scheduler(f, [job], false); await f.core.dispatchDueJobs(); expect(reached).toHaveBeenCalledTimes(1);
            }
            expect(await f.send(job)).toBe(true); f.complete(row);
        }
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(order === "CARE-CLIENT-CARE-CLIENT" ? 4 : 3);
        expect(f.jobs.map(job => ({ id: job.id, time: job.scheduledFor, key: job.dedupeKey, catchUp: job.payload.catchUp })).sort((a,b) => a.catchUp!.sequence-b.catchUp!.sequence)).toEqual(identities);
    });
    it("keeps repeated mixed waits and same-batch replay on one original CLIENT row", async () => {
        const f = await c4TimingFixture(true); Object.assign(f.db.message_trigger_job, { findFirst: jest.fn(async (query: unknown) => c6StoredCareLookup(f.jobs, query)) }); await f.sync();
        const job = timingJobCopy(f.jobs.find(row => row.ruleId === "child-client")!);
        const identity = { id: job.id, time: job.scheduledFor, key: job.dedupeKey, digest: agentAutomationConcreteJobDigest(job) };
        const history = structuredClone(f.jobs.filter(row => row.recipientType !== MessageTriggerRecipientType.CLIENT));
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(job)).toBe(true);
        jest.setSystemTime(new Date("2026-11-05T12:04:00Z")); expect(await f.postpone(job)).toBe(true);
        expect(job.nextAttemptAt).toEqual(new Date("2026-11-05T12:07:00Z")); await f.sync();
        const clients = f.jobs.filter(row => row.ruleId === "child-client"); expect(clients).toHaveLength(1);
        expect(clients[0]).toMatchObject({ id: identity.id, scheduledFor: identity.time, dedupeKey: identity.key, nextAttemptAt: new Date("2026-11-05T12:07:00Z") });
        expect({ id: job.id, time: job.scheduledFor, key: job.dedupeKey, digest: agentAutomationConcreteJobDigest(job) }).toEqual(identity);
        expect(f.jobs.filter(row => row.recipientType !== MessageTriggerRecipientType.CLIENT)).toEqual(history);
    });
    it.each([false, true])("retains current sealed mixed CLIENT permission, sourceChanged=%s", async sourceChanged => {
        const f = await c4TimingFixture(true, true); Object.assign(f.db.message_trigger_job, { findFirst: jest.fn(async (query: unknown) => c6StoredCareLookup(f.jobs, query)) }); await f.sync();
        const job = timingJobCopy(f.jobs.find(row => row.ruleId === "child-client")!); const seal = structuredClone(job.payload.agentAutomationSeal);
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(job)).toBe(true);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!);
        jest.setSystemTime(new Date("2026-11-05T12:06:00Z")); const reached = c5Scheduler(f, [job], false); await f.core.dispatchDueJobs(); expect(reached).toHaveBeenCalledTimes(1);
        if (sourceChanged) f.client.name = "changed current source";
        expect(await f.send(job)).toBe(!sourceChanged); expect(f.aligo.sendSms).toHaveBeenCalledTimes(sourceChanged ? 0 : 1); expect(job.payload.agentAutomationSeal).toEqual(seal);
    });
});

describe("Phase7 C6 mixed CLIENT wait and actual failure retry controls", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-11-05T12:00:00Z")); });
    afterEach(() => jest.useRealTimers());
    it.each([[false, false], [true, false], [false, true], [true, true]])("consumer retry=%s actualFailure=%s preserves final permission", async (retryEnabled, actualFailure) => {
        const f = await c4TimingFixture(true); Object.assign(f.db.message_trigger_job, { findFirst: jest.fn(async (query: unknown) => c6StoredCareLookup(f.jobs, query)) }); await f.sync();
        const job = timingJobCopy(f.jobs.find(row => row.ruleId === "child-client")!); const identity = { time: job.scheduledFor, key: job.dedupeKey, digest: agentAutomationConcreteJobDigest(job) };
        jest.setSystemTime(new Date("2026-11-05T12:03:00Z")); expect(await f.postpone(job)).toBe(true);
        if (actualFailure) job.defer("transient", "synthetic provider rejection", 3 * 60_000);
        f.complete(f.jobs.find(row => row.ruleId === "child-secondary")!); jest.setSystemTime(new Date("2026-11-05T12:06:00Z"));
        expect(await f.postpone(job)).toBe(false); const allow = retryEnabled || !actualFailure;
        const reached = c5Scheduler(f, [job], retryEnabled); await f.core.dispatchDueJobs(); expect(reached).toHaveBeenCalledTimes(allow ? 1 : 0);
        expect({ time: job.scheduledFor, key: job.dedupeKey, digest: agentAutomationConcreteJobDigest(job) }).toEqual(identity);
        if (allow) expect(await f.send(job)).toBe(true);
        expect(f.aligo.sendSms).toHaveBeenCalledTimes(allow ? 1 : 0); expect(job.attempts).toBe(actualFailure ? 1 : 0);
        expect({ time: job.scheduledFor, key: job.dedupeKey }).toEqual({ time: identity.time, key: identity.key });
    });
});
