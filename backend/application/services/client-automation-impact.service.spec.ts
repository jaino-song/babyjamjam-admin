import { createHash } from "node:crypto";
import { createLegacyAutomationDeliveryGate } from "../../test/fixtures/legacy-automation-delivery-gate";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG } from "domain/entities/system-setting.entity";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import type { ClientAutomationWrite } from "domain/ports/client-automation-impact.port";
import type { MessageTriggerJobReviewSnapshot } from "domain/repositories/message-trigger-job.repository.interface";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";
import { ClientAutomationImpactService } from "./client-automation-impact.service";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";
import { buildClientMessageRecipe, buildEmployeeAssignmentMessageRecipe, type ClientTriggerSource } from "./message-trigger-recipes";
import { SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";

const branchId = "76000000-0000-4000-8000-000000000001";
const taskId = "76000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-17T00:00:00Z");
function setup() {
    const client: ClientTriggerSource = { id: 41, name: "합성 고객", phone: "01000000041", createdAt: now,
        startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-15T00:00:00Z"),
        serviceEndNoticeSentAt: null, type: "A통합1형", duration: 10, fullPrice: "100000", grant: "0", actualPrice: "100000", area: null };
    const greeting = new MessageTriggerRuleEntity("greeting", branchId, "합성 등록", true,
        MessageTriggerEventType.CLIENT_CREATED, MessageTriggerOffsetType.IMMEDIATE, 0,
        MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.CLIENT_GREETING, now, now);
    const info = new MessageTriggerRuleEntity("info", branchId, "합성 시작", true,
        MessageTriggerEventType.SERVICE_START, MessageTriggerOffsetType.BEFORE_DAYS, 7,
        MessageTriggerRecipientType.CLIENT, MessageTriggerTemplateKey.SERVICE_INFO, now, now);
    const rules = [greeting, info];
    const settings = { status: "available" as const, rules, defaultsPresent: true, dispatchEnabled: true,
        senderApproved: true, senderApprovedAt: now, pastTriggerEnabled: true, pastTriggerConfig: DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG };
    const sources = {
        readClientAutomationSettings: jest.fn().mockImplementation(async () => settings),
        readClientAutomationSource: jest.fn().mockImplementation(async () => client),
        readClientAutomationArea: jest.fn().mockResolvedValue({ bankAccountInfo: { bankName: "합성 은행", accNum: "000000041" } }),
        readClientAutomationSchedules: jest.fn().mockResolvedValue([]),
        readClientAutomationServiceRecordLinks: jest.fn().mockResolvedValue([]),
        ensureDefaultRulesForBranch: jest.fn(), syncClientRulesForClient: jest.fn(),
    };
    const jobs: MessageTriggerJobReviewSnapshot[] = [];
    const repository = { findForClientAutomationReview: jest.fn().mockImplementation(async () => jobs), update: jest.fn(), upsertPending: jest.fn() };
    const template = { id: "template-a", content: "{{name}}님 합성 안내", updatedAt: now, requiredVariables: [], customVariables: [] };
    const templates = { getByKeyForBranch: jest.fn().mockImplementation(async () => template) };
    const aligo = { sendSms: jest.fn() };
    const logs = { save: jest.fn(), update: jest.fn() };
    const enrichers = { enrich: jest.fn() };
    const delivery = new SmsTriggerDeliveryService(aligo as never, templates as never, logs as never, undefined, enrichers as never, createLegacyAutomationDeliveryGate());
    const sender = new AligoDefaultSenderPolicyService(new E2eAligoApiStub());
    const service = new ClientAutomationImpactService(sources as never, delivery, sender, repository as never);
    const create: ClientAutomationWrite = { kind: "create", taskId, values: { name: client.name, phone: client.phone, startDate: client.startDate } };
    function pending(rule = info) {
        const job = Object.assign(MessageTriggerJobEntity.create(buildClientMessageRecipe(rule, client, now)!), { id: `job-${rule.id}`, canceledByUser: false });
        jobs.push(job);
        return job;
    }
    return { service, client, create, settings, sources, repository, jobs, rules, greeting, info, pending, sender,
        template, templates, aligo, logs, enrichers };
}

function addServiceRecordLinkSource(
    fixture: ReturnType<typeof setup>,
    tokenOverrides: Partial<{
        linkTokenHash: string;
        expectedPhoneHash: string;
        expiresAt: Date;
        active: boolean;
        revokedAt: Date | null;
        lockedAt: Date | null;
        failedAttempts: number;
    }> = {},
): void {
    fixture.settings.rules.push(MessageTriggerRuleEntity.reconstitute(
        SERVICE_RECORD_LINK_RULE_ID,
        null,
        "제공기록지 링크",
        true,
        MessageTriggerEventType.SERVICE_START,
        MessageTriggerOffsetType.SAME_DAY,
        0,
        MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        now,
        now,
        true,
        false,
        "15:00",
    ));
    fixture.sources.readClientAutomationServiceRecordLinks = jest.fn().mockResolvedValue([{
        schedule: {
            id: 17,
            incarnationId: "76000000-0000-4000-8000-000000000003",
            branchId,
            clientId: fixture.client.id,
            startDate: new Date("2026-10-01T00:00:00Z"),
            endDate: new Date("2026-10-15T00:00:00Z"),
            replaced: false,
            terminatedAt: null,
            primaryEmployeeId: 71,
            client: { id: fixture.client.id, name: fixture.client.name, branchId, createdAt: now, serviceStatus: "active" },
            primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071", branchId, deletedAt: null },
        },
        serviceRecordCase: null,
        token: {
            id: "76000000-0000-4000-8000-000000000005",
            branchId,
            scheduleId: 17,
            employeeId: 71,
            serviceRecordCaseId: null,
            linkTokenHash: "efl_synthetic_token",
            expectedPhoneHash: createHash("sha256").update("01000000071").digest("hex"),
            expiresAt: new Date("2026-10-22T11:00:00Z"),
            active: true,
            revokedAt: null,
            lockedAt: null,
            failedAttempts: 0,
            createdAt: now,
            ...tokenOverrides,
        },
    }]);
}

describe("read-only normalized client automation impact", () => {
    beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
    afterEach(() => jest.useRealTimers());

    it("describes all applicable creation rules without writes, provider calls or source preimages", async () => {
        const fixture = setup();
        const result = await fixture.service.planClientWrite(branchId, fixture.create);
        expect(result).toMatchObject({ availability: "available", complete: true, clientIdentity: null, affectedJobs: [] });
        expect(result.effects.map(({ ruleId, change }) => [ruleId, change])).toEqual([["greeting", "create"], ["info", "create"]]);
        for (const raw of [fixture.client.name, fixture.client.phone, "합성 안내"]) expect(JSON.stringify(result)).not.toContain(raw);
        for (const fn of [fixture.sources.ensureDefaultRulesForBranch, fixture.sources.syncClientRulesForClient,
            fixture.repository.update, fixture.repository.upsertPending, fixture.aligo.sendSms, fixture.logs.save, fixture.enrichers.enrich]) expect(fn).not.toHaveBeenCalled();
        expect(fixture.repository.findForClientAutomationReview).not.toHaveBeenCalled();
    });

    it("keeps creation recipes and source guards stable across rule order and preview clock", async () => {
        const f = setup();
        const first = await f.service.planClientWrite(branchId, f.create);
        f.rules.reverse();
        jest.setSystemTime(new Date(now.getTime() + 60_000));
        expect(await f.service.planClientWrite(branchId, f.create)).toEqual(first);
    });

    it("shares ordinary pre-start catch-up suppression, including the Korean start-day boundary", async () => {
        const f = setup();
        const write = { ...f.create, values: { ...f.create.values, startDate: new Date("2026-09-18T00:00:00Z") } };
        expect((await f.service.planClientWrite(branchId, write)).effects.some(({ ruleId }) => ruleId === "info")).toBe(true);
        for (const startDate of [new Date("2026-09-16T00:00:00Z"), new Date("2026-09-17T08:00:00Z")]) {
            const result = await f.service.planClientWrite(branchId, { ...write, values: { ...write.values, startDate } });
            expect(result.effects.map(({ ruleId }) => ruleId)).toEqual(["greeting"]);
        }
    });

    it.each(["sender-unavailable", "unsupported-content"])("keeps delayed creation %s descriptors stable across preview days", async (reason) => {
        const f = setup();
        f.greeting.offsetType = MessageTriggerOffsetType.AFTER_DAYS;
        f.greeting.offsetDays = 2;
        if (reason === "sender-unavailable") f.settings.senderApproved = false;
        else Object.assign(f.template, { requiredVariables: [{ key: "opaqueFutureLink", required: true }] });
        const first = await f.service.planClientWrite(branchId, f.create);
        expect(first).toMatchObject({ availability: "unavailable", reason });
        jest.setSystemTime(new Date(now.getTime() + 86_400_000));
        expect(await f.service.planClientWrite(branchId, f.create)).toEqual(first);
    });

    it("reports missing defaults without creating them or omitting known effects", async () => {
        const f = setup();
        f.settings.defaultsPresent = false;
        const result = await f.service.planClientWrite(branchId, f.create);
        expect(result).toMatchObject({ availability: "unavailable", reason: "missing-default-rules", complete: true });
        expect(result.effects).toHaveLength(2);
        expect(f.sources.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
    });

    it("preserves pending jobs when changed fields are irrelevant to their recipes", async () => {
        const f = setup();
        const job = f.pending();
        const snapshot = JSON.stringify(job);
        const result = await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { fullPrice: "200000", actualPrice: "200000" } });
        expect(result).toMatchObject({ availability: "none", effects: [], affectedJobs: [], complete: true });
        expect(result.grandfatheredEffects?.map(({ ruleId }) => ruleId)).toEqual(["greeting", "info"]);
        expect(JSON.stringify(job)).toBe(snapshot);
    });

    it("refreshes only changed pending scopes and never invents another immediate greeting", async () => {
        const f = setup();
        const job = f.pending();
        const result = await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { phone: "01000000042" } });
        expect(result.effects).toHaveLength(1);
        expect(result.effects[0]).toMatchObject({ ruleId: "info", change: "refresh" });
        expect(result.affectedJobs).toEqual([{ id: job.id, version: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
        expect(f.repository.findForClientAutomationReview).toHaveBeenCalledWith(branchId, 41, ["greeting", "info", SERVICE_RECORD_LINK_RULE_ID]);
    });

    it("includes cancellation when clearing the source date and leaves all stored jobs unchanged", async () => {
        const f = setup();
        const job = f.pending();
        const result = await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { startDate: null } });
        expect(result).toMatchObject({ availability: "available", complete: true });
        expect(result.effects).toHaveLength(1);
        expect(result.effects[0]).toMatchObject({ ruleId: "info", change: "cancel" });
        expect(job.status).toBe("pending");
        expect(f.repository.update).not.toHaveBeenCalled();
    });

    it("does not re-arm a terminal dedupe row or a past occurrence", async () => {
        const f = setup();
        f.pending().status = "sent";
        expect(await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { phone: "01000000042" } }))
            .toMatchObject({ availability: "none", effects: [], affectedJobs: [] });
        f.jobs.length = 0;
        f.client.startDate = new Date("2026-09-01T00:00:00Z");
        expect(await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { phone: "01000000042" } }))
            .toMatchObject({ availability: "none", effects: [] });
    });

    it("binds refreshed immediate jobs that already exist, without changing their stored catch-up schedule", async () => {
        const f = setup();
        const job = f.pending(f.greeting);
        job.payload.catchUp = { batchId: "synthetic", sequence: 2, intervalMinutes: 10, originalScheduledFor: now.toISOString(), predecessorDedupeKey: "previous" };
        const copy = JSON.stringify(job);
        const result = await f.service.planClientWrite(branchId, { kind: "update", clientId: 41, values: { name: "정정 합성 고객" } });
        expect(result.effects.find(({ ruleId }) => ruleId === "greeting")).toMatchObject({ change: "refresh" });
        expect(JSON.stringify(job)).toBe(copy);
    });

    it("describes a claimed immediate job as cancellation and binds its claim generation", async () => {
        const f = setup();
        const job = f.pending(f.greeting);
        const write = { kind: "update" as const, clientId: 41, values: { name: "정정 합성 고객" } };
        const pending = await f.service.planClientWrite(branchId, write);
        expect(pending.effects.find(({ ruleId }) => ruleId === "greeting")).toMatchObject({ change: "refresh" });
        job.status = "processing";
        job.claimToken = "synthetic-claim";
        const processing = await f.service.planClientWrite(branchId, write);
        expect(processing).toMatchObject({ availability: "available", complete: true });
        expect(processing.effects.find(({ ruleId }) => ruleId === "greeting")).toMatchObject({ change: "cancel" });
        expect(processing.affectedJobs).not.toEqual(pending.affectedJobs);
        expect(job.status).toBe("processing");
        f.pending(f.greeting);
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false });
    });

    it("distinguishes an eligible system-canceled occurrence from an explicit user cancellation", async () => {
        const f = setup();
        const job = f.pending();
        job.status = "canceled";
        const write = { kind: "update" as const, clientId: 41, values: { phone: "01000000042" } };
        expect((await f.service.planClientWrite(branchId, write)).effects).toEqual([expect.objectContaining({ ruleId: "info", change: "create" })]);
        job.canceledByUser = true;
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "none", effects: [] });
    });

    it("resolves scoped bank data for PRICE_INFO and fails closed for an invalid area", async () => {
        const f = setup();
        f.info.templateKey = MessageTriggerTemplateKey.PRICE_INFO;
        f.template.content = "{{name}} {{bankName}} {{accNum}}";
        const write = { kind: "update" as const, clientId: 41, values: { areaId: "synthetic-area" } };
        const result = await f.service.planClientWrite(branchId, write);
        expect(result).toMatchObject({ availability: "available", complete: true });
        expect(result.effects).toHaveLength(1);
        expect(f.sources.readClientAutomationArea).toHaveBeenCalledWith(branchId, "synthetic-area");
        expect(JSON.stringify(result)).not.toContain("000000041");
        f.sources.readClientAutomationArea.mockResolvedValue(undefined);
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", reason: "source-unavailable", complete: false });
    });

    it("retains affected scope descriptions when sender or content is unavailable, without granting yes", async () => {
        const f = setup();
        f.settings.senderApproved = false;
        const result = await f.service.planClientWrite(branchId, f.create);
        expect(result).toMatchObject({ availability: "unavailable", reason: "sender-unavailable", complete: true });
        expect(result.effects).toHaveLength(2);
        f.settings.senderApproved = true;
        Object.assign(f.template, { requiredVariables: [{ key: "opaqueFutureLink", required: true }] });
        expect(await f.service.planClientWrite(branchId, f.create)).toMatchObject({ availability: "unavailable", reason: "unsupported-content", complete: true });
        expect(f.enrichers.enrich).not.toHaveBeenCalled();
    });

    it("refuses incomplete, foreign, oversized and already-dispatching source snapshots", async () => {
        const f = setup();
        const write = { kind: "update" as const, clientId: 41, values: { phone: "01000000042" } };
        const job = f.pending();
        job.branchId = "foreign";
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false });
        job.branchId = branchId;
        job.status = "dispatching";
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false, affectedJobs: [] });
        f.repository.findForClientAutomationReview.mockResolvedValue(Array(501).fill(job));
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false });
        f.sources.readClientAutomationSource.mockResolvedValue(null);
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false });
        f.sources.readClientAutomationSettings.mockRejectedValue(new Error("private raw source"));
        const failed = await f.service.planClientWrite(branchId, write);
        expect(failed).toMatchObject({ availability: "unavailable", complete: false });
        expect(JSON.stringify(failed)).not.toContain("private raw source");
    });

    it("does not silently omit an active global rule with no supported recipe owner", async () => {
        const f = setup();
        f.greeting.branchId = null;
        expect(await f.service.planClientWrite(branchId, f.create)).toMatchObject({ availability: "unavailable", complete: false });
    });

    it("serializes creation and job timestamps before hashing, so resource reuse and job changes invalidate guards", async () => {
        const f = setup();
        const job = f.pending();
        const write = { kind: "update" as const, clientId: 41, values: { phone: "01000000042" } };
        const first = await f.service.planClientWrite(branchId, write);
        job.updatedAt = new Date(now.getTime() + 1);
        const jobChanged = await f.service.planClientWrite(branchId, write);
        expect(jobChanged.affectedJobs).not.toEqual(first.affectedJobs);
        expect(jobChanged.sourceGuard).not.toBe(first.sourceGuard);
        f.client.createdAt = new Date(now.getTime() + 1);
        const recreated = await f.service.planClientWrite(branchId, write);
        expect(recreated.clientIdentity).not.toBe(first.clientIdentity);
        expect(recreated.effects).not.toEqual(first.effects);
    });

    it("requires a complete source for affected active schedules and binds immutable schedule incarnations", async () => {
        const f = setup();
        const assignment = new MessageTriggerRuleEntity("assignment", branchId, "합성 배정", true,
            MessageTriggerEventType.EMPLOYEE_ASSIGNED, MessageTriggerOffsetType.IMMEDIATE, 0,
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE, MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED, now, now);
        f.rules.push(assignment);
        const schedule = { id: 17, incarnationId: taskId, branchId, clientId: 41, client: { id: 41, name: f.client.name },
            workAddress: "합성 주소", startDate: f.client.startDate, endDate: f.client.endDate, replaced: false, terminatedAt: null,
            primaryEmployeeId: 71, secondaryEmployeeId: null, primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071" }, secondaryEmployee: null };
        f.sources.readClientAutomationSchedules.mockResolvedValue([schedule]);
        const write = { kind: "update" as const, clientId: 41, values: { name: "정정 합성 고객" } };
        const first = await f.service.planClientWrite(branchId, write);
        expect(first).toMatchObject({ availability: "unavailable", reason: "unsupported-content", complete: true });
        const effect = first.effects.find(({ kind }) => kind === "employee-assignment");
        expect(effect).toMatchObject({ scheduleId: 17, recipientType: "primary-employee" });
        schedule.incarnationId = "76000000-0000-4000-8000-000000000003";
        expect((await f.service.planClientWrite(branchId, write)).effects.find(({ kind }) => kind === "employee-assignment")).not.toEqual(effect);
        expect(await f.service.planClientWrite(branchId, { ...write, values: { startDate: new Date("2026-10-02T00:00:00Z") } }))
            .toMatchObject({ availability: "unavailable", complete: false });
        const canceled = Object.assign(MessageTriggerJobEntity.create(buildEmployeeAssignmentMessageRecipe(assignment, schedule as never, now)!),
            { id: "canceled-assignment", canceledByUser: true });
        canceled.status = "canceled";
        f.jobs.push(canceled);
        expect((await f.service.planClientWrite(branchId, write)).effects.some(({ kind }) => kind === "employee-assignment")).toBe(false);
        schedule.incarnationId = "";
        expect(await f.service.planClientWrite(branchId, write)).toMatchObject({ availability: "unavailable", complete: false });
    });

    it("describes a production service-record-link effect for a renamed scheduled client", async () => {
        const f = setup();
        const serviceRule = MessageTriggerRuleEntity.reconstitute(
            SERVICE_RECORD_LINK_RULE_ID,
            null,
            "제공기록지 링크",
            true,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerOffsetType.SAME_DAY,
            0,
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            now,
            now,
            true,
            false,
            "15:00",
        );
        f.settings.rules.push(serviceRule);
        f.sources.readClientAutomationServiceRecordLinks = jest.fn().mockResolvedValue([{
            schedule: {
                id: 17,
                incarnationId: "76000000-0000-4000-8000-000000000003",
                branchId,
                clientId: f.client.id,
                startDate: new Date("2026-10-01T00:00:00Z"),
                endDate: new Date("2026-10-15T00:00:00Z"),
                replaced: false,
                terminatedAt: null,
                primaryEmployeeId: 71,
                client: { id: f.client.id, name: f.client.name, branchId, createdAt: now, serviceStatus: "active" },
                primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071", branchId, deletedAt: null },
            },
            serviceRecordCase: null,
            token: {
                id: "76000000-0000-4000-8000-000000000005",
                branchId,
                scheduleId: 17,
                employeeId: 71,
                serviceRecordCaseId: null,
                linkTokenHash: "efl_synthetic_token",
                expectedPhoneHash: createHash("sha256").update("01000000071").digest("hex"),
                expiresAt: new Date("2026-10-22T11:00:00Z"),
                active: true,
                revokedAt: null,
                lockedAt: null,
                failedAttempts: 0,
                createdAt: now,
            },
        }]);

        const result = await f.service.planClientWrite(branchId, {
            kind: "update", clientId: f.client.id, values: { name: "정정 합성 고객" },
        });
        expect(result).toMatchObject({ availability: "available", complete: true });
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 17, change: "create" }),
        ]));
        expect(JSON.stringify(result)).not.toContain("efl_synthetic_token");
        expect(JSON.stringify(result)).not.toContain("01000000071");
    });

    it("keeps a missing service-record token as an unavailable schedule scope", async () => {
        const f = setup();
        f.settings.rules.push(MessageTriggerRuleEntity.reconstitute(
            SERVICE_RECORD_LINK_RULE_ID,
            null,
            "제공기록지 링크",
            true,
            MessageTriggerEventType.SERVICE_START,
            MessageTriggerOffsetType.SAME_DAY,
            0,
            MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            now,
            now,
            true,
            false,
            "15:00",
        ));
        f.sources.readClientAutomationServiceRecordLinks = jest.fn().mockResolvedValue([{
            schedule: {
                id: 17,
                incarnationId: "76000000-0000-4000-8000-000000000003",
                branchId,
                clientId: f.client.id,
                startDate: new Date("2026-10-01T00:00:00Z"),
                endDate: new Date("2026-10-15T00:00:00Z"),
                replaced: false,
                terminatedAt: null,
                primaryEmployeeId: 71,
                client: { id: f.client.id, name: f.client.name, branchId, createdAt: now, serviceStatus: "active" },
                primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071", branchId, deletedAt: null },
            },
            serviceRecordCase: null,
            token: null,
        }]);

        const result = await f.service.planClientWrite(branchId, {
            kind: "update", clientId: f.client.id, values: { name: "정정 합성 고객" },
        });
        expect(result).toMatchObject({ availability: "unavailable", reason: "source-unavailable", complete: true });
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 17, change: "create" }),
        ]));
        expect(JSON.stringify(result)).not.toContain("01000000071");
    });

    it("keeps a missing system rule as an unavailable schedule scope", async () => {
        const f = setup();
        f.sources.readClientAutomationServiceRecordLinks = jest.fn().mockResolvedValue([{
            schedule: {
                id: 17,
                incarnationId: "76000000-0000-4000-8000-000000000003",
                branchId,
                clientId: f.client.id,
                startDate: new Date("2026-10-01T00:00:00Z"),
                endDate: new Date("2026-10-15T00:00:00Z"),
                replaced: false,
                terminatedAt: null,
                primaryEmployeeId: 71,
                client: { id: f.client.id, name: f.client.name, branchId, createdAt: now, serviceStatus: "active" },
                primaryEmployee: { id: 71, name: "합성 관리사", phone: "01000000071", branchId, deletedAt: null },
            },
            serviceRecordCase: null,
            token: {
                id: "76000000-0000-4000-8000-000000000005",
                branchId,
                scheduleId: 17,
                employeeId: 71,
                serviceRecordCaseId: null,
                linkTokenHash: "efl_synthetic_token",
                expectedPhoneHash: createHash("sha256").update("01000000071").digest("hex"),
                expiresAt: new Date("2026-10-22T11:00:00Z"),
                active: true,
                revokedAt: null,
                lockedAt: null,
                failedAttempts: 0,
                createdAt: now,
            },
        }]);

        const result = await f.service.planClientWrite(branchId, {
            kind: "update", clientId: f.client.id, values: { name: "정정 합성 고객" },
        });
        expect(result).toMatchObject({ availability: "unavailable", reason: "source-unavailable", complete: true });
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 17, change: "create" }),
        ]));
        expect(JSON.stringify(result)).not.toContain("efl_synthetic_token");
        expect(JSON.stringify(result)).not.toContain("01000000071");
    });

    it.each([
        ["inactive", { active: false }],
        ["revoked", { revokedAt: new Date("2026-09-16T00:00:00Z") }],
        ["locked", { lockedAt: new Date("2026-09-16T00:00:00Z") }],
        ["expired", { expiresAt: new Date("2026-09-16T00:00:00Z") }],
        ["phone-mismatched", { expectedPhoneHash: createHash("sha256").update("01000000072").digest("hex") }],
    ] as const)("keeps a present but %s service-record source available for no-send coverage", async (_state, tokenOverrides) => {
        const f = setup();
        addServiceRecordLinkSource(f, tokenOverrides);

        const result = await f.service.planClientWrite(branchId, {
            kind: "update", clientId: f.client.id, values: { name: "정정 합성 고객" },
        });
        expect(result).toMatchObject({ availability: "unavailable", reason: "unsupported-content", complete: true });
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 17, change: "create" }),
        ]));
        expect(JSON.stringify(result)).not.toContain("efl_synthetic_token");
        expect(JSON.stringify(result)).not.toContain("01000000071");
    });

    it("keeps policy-blocked service-record coverage complete without granting yes", async () => {
        const f = setup();
        f.settings.senderApproved = false;
        addServiceRecordLinkSource(f);

        const result = await f.service.planClientWrite(branchId, {
            kind: "update", clientId: f.client.id, values: { name: "정정 합성 고객" },
        });
        expect(result).toMatchObject({ availability: "unavailable", reason: "sender-unavailable", complete: true });
        expect(result.effects).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "service-record-link", ruleId: SERVICE_RECORD_LINK_RULE_ID, scheduleId: 17, change: "create" }),
        ]));
    });
});
