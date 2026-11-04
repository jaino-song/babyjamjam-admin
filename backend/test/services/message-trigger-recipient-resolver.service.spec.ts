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
