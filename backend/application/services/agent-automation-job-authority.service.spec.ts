import { createHash, randomUUID } from "node:crypto";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { SERVICE_RECORD_LINK_RULE_ID, getServiceRecordLinkScheduledFor } from "domain/constants/service-record-link-message";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG } from "domain/entities/system-setting.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { AgentAutomationJobAuthorityService } from "./agent-automation-job-authority.service";
import { buildServiceRecordLinkPayload } from "./service-record-link-automation-effect-recipe";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

const branchId = "76000000-0000-4000-8000-000000000001";
const taskId = "76000000-0000-4000-8000-000000000002";
const clientId = 41;
const scheduleId = 901;
const employeeId = 77;
const scheduleIncarnationId = "76000000-0000-4000-8000-000000000003";
const caseId = "76000000-0000-4000-8000-000000000004";
const now = new Date("2026-09-17T00:00:00.000Z");
const startDate = new Date("2026-10-01T00:00:00.000Z");
const endDate = new Date("2026-10-15T00:00:00.000Z");
const employeePhone = "010-0000-0021";
const serviceRecordUrl = "https://m.admin.babyjamjam.com/service-record/efl_synthetic_token";

function fixture() {
    const rule = MessageTriggerRuleEntity.reconstitute(
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
    const schedule = {
        id: scheduleId,
        incarnationId: scheduleIncarnationId,
        branchId,
        clientId,
        startDate,
        endDate,
        replaced: false,
        terminatedAt: null,
        primaryEmployeeId: employeeId,
        client: { id: clientId, name: "합성 고객", branchId, createdAt: now, serviceStatus: "active" },
        primaryEmployee: { id: employeeId, name: "합성 관리사", phone: employeePhone, branchId, deletedAt: null },
    };
    const serviceRecordCase = {
        id: caseId,
        branchId,
        clientId,
        status: "IN_PROGRESS",
        startDate,
        endDate,
        requiredSessionCount: 10,
        formVersion: 1,
        version: 2,
        finalizedAt: null,
        updatedAt: now,
    };
    const token = {
        id: "76000000-0000-4000-8000-000000000005",
        branchId,
        scheduleId,
        employeeId,
        serviceRecordCaseId: caseId,
        linkTokenHash: "efl_synthetic_token",
        expectedPhoneHash: createHash("sha256").update("01000000021").digest("hex"),
        expiresAt: new Date("2026-10-22T11:00:00.000Z"),
        active: true,
        revokedAt: null,
        lockedAt: null,
        failedAttempts: 0,
        createdAt: now,
    };
    const payload = buildServiceRecordLinkPayload({
        clientId,
        clientName: schedule.client.name,
        employeeId,
        employeeName: schedule.primaryEmployee.name,
        recipientPhone: employeePhone,
        buttonUrl: serviceRecordUrl,
        serviceRecordUrl,
        serviceStartDate: "2026-10-01",
        serviceEndDate: "2026-10-15",
    });
    const job = MessageTriggerJobEntity.reconstitute(
        randomUUID(),
        branchId,
        SERVICE_RECORD_LINK_RULE_ID,
        "pending",
        getServiceRecordLinkScheduledFor(startDate),
        null,
        null,
        null,
        clientId,
        scheduleId,
        MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
        employeePhone,
        MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
        payload as never,
        now,
        now,
    );
    const snapshot: SmsTriggerDeliverySnapshot = {
        templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
        receiver: employeePhone,
        maskedReceiver: "010****0021",
        recipientName: schedule.primaryEmployee.name,
        message: "합성 메시지 본문",
        title: "제공기록지 작성 링크",
        requestedDeliveryType: "AUTO",
        deliveryType: "LMS",
        estimatedCost: "1",
        templateVersion: "template-v1",
        templateHash: "a".repeat(64),
        configVersion: "config-v1",
        configHash: "b".repeat(64),
        snapshotHash: "c".repeat(64),
        systemTemplateKey: "SERVICE_RECORD_LINK" as never,
    };
    const settings = {
        status: "available" as const,
        rules: [rule],
        defaultsPresent: true,
        dispatchEnabled: true,
        senderApproved: true,
        senderApprovedAt: now,
        pastTriggerEnabled: true,
        pastTriggerConfig: DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    };
    const sources = { readClientAutomationSettings: jest.fn().mockResolvedValue(settings) };
    const sender = { read: jest.fn().mockReturnValue({ availability: "available", identityDigest: "d".repeat(64) }) };
    const transaction = {
        message_trigger_job: { findFirst: jest.fn().mockResolvedValue(structuredClone(job)) },
        employee_schedule: { findFirst: jest.fn().mockImplementation(async (query: { orderBy?: unknown }) => query.orderBy
            ? { id: scheduleId }
            : { ...schedule, startDate: new Date(schedule.startDate), endDate: new Date(schedule.endDate),
                client: { ...schedule.client, createdAt: new Date(schedule.client.createdAt) },
                primaryEmployee: { ...schedule.primaryEmployee } }) },
        service_record_case: { findFirst: jest.fn().mockResolvedValue({ ...serviceRecordCase, startDate: new Date(startDate), endDate: new Date(endDate), updatedAt: new Date(now) }) },
        service_record_token: { findFirst: jest.fn().mockResolvedValue({ ...token, expiresAt: new Date(token.expiresAt), createdAt: new Date(token.createdAt) }) },
    };
    const authority = {
        check: jest.fn().mockImplementation(async (_tx: unknown, _request: unknown, describe: (input: unknown) => Promise<unknown>) => {
            const effect = await describe({
                scope: {
                    branchId,
                    clientId,
                    clientIdentity: "e".repeat(64),
                    kind: "service-record-link",
                    ruleId: SERVICE_RECORD_LINK_RULE_ID,
                    scheduleId,
                    scheduleIdentity: agentAutomationScheduleIdentity(scheduleIncarnationId),
                    recipientType: "primary-employee",
                },
                subject: { kind: "task-client", taskId },
                change: "create",
            });
            return effect ? { status: "allowed", seal: {} } : { status: "refused", reason: "automation-authority-unavailable" };
        }),
    };
    const service = new AgentAutomationJobAuthorityService(authority as never, sources as never, sender as never);
    const render = jest.fn().mockResolvedValue(snapshot);
    return { service, transaction, job, token, render, snapshot };
}

describe("AgentAutomationJobAuthorityService service-record-link adapter", () => {
    it("resolves current rows under the transaction and does not mint, mutate or send", async () => {
        const f = fixture();
        const result = await f.service.checkAutomaticJob(f.transaction as never, f.job, "materialize", f.render);
        expect(result).toMatchObject({ status: "allowed" });
        expect(f.render).toHaveBeenCalledTimes(1);
        expect(f.transaction.service_record_token.findFirst).toHaveBeenCalledTimes(1);
        expect(f.transaction.message_trigger_job.findFirst).toHaveBeenCalledTimes(1);
        expect(f.transaction.service_record_token).not.toHaveProperty("create");
        expect(f.transaction.service_record_token).not.toHaveProperty("update");
    });

    it.each([
        ["missing token", (f: ReturnType<typeof fixture>) => { f.transaction.service_record_token.findFirst.mockResolvedValue(null); }],
        ["changed snapshot", (f: ReturnType<typeof fixture>) => { f.render.mockResolvedValue({ ...f.snapshot, snapshotHash: "f".repeat(64) }); }],
    ])("refuses %s without provider or token operations", async (_label, mutate) => {
        const f = fixture();
        mutate(f);
        const result = await f.service.checkAutomaticJob(f.transaction as never, f.job, "materialize", f.render, f.snapshot.snapshotHash);
        expect(result).toMatchObject({ status: "refused", reason: "automation-authority-unavailable" });
        expect(f.transaction.service_record_token.findFirst).toHaveBeenCalledTimes(1);
    });
});
