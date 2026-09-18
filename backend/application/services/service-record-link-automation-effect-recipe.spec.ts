import { createHash } from "node:crypto";
import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG } from "domain/entities/system-setting.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { agentAutomationEffectDigest } from "application/agent/agent-automation-consent";
import { getServiceRecordLinkScheduledFor, SERVICE_RECORD_LINK_RULE_ID } from "domain/constants/service-record-link-message";
import {
    buildServiceRecordLinkPayload,
    describeServiceRecordLinkEffect,
    type ServiceRecordLinkCaseSource,
    type ServiceRecordLinkScheduleSource,
    type ServiceRecordLinkTokenSource,
} from "./service-record-link-automation-effect-recipe";
import type { ClientMessageEffectPolicy } from "./client-message-effect-recipe";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

const branchId = "76000000-0000-4000-8000-000000000001";
const clientId = 41;
const scheduleId = 901;
const employeeId = 77;
const scheduleIncarnationId = "76000000-0000-4000-8000-000000000003";
const caseId = "76000000-0000-4000-8000-000000000004";
const taskId = "76000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-17T00:00:00.000Z");
const startDate = new Date("2026-10-01T00:00:00.000Z");
const endDate = new Date("2026-10-15T00:00:00.000Z");
const serviceRecordUrl = "https://m.admin.babyjamjam.com/service-record/efl_synthetic_token";
const employeePhone = "010-0000-0021";

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
    const schedule: ServiceRecordLinkScheduleSource = {
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
    const serviceRecordCase: ServiceRecordLinkCaseSource = {
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
    const token: ServiceRecordLinkTokenSource = {
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
    const sourcePayload = buildServiceRecordLinkPayload({
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
    const policy: ClientMessageEffectPolicy = {
        dispatchEnabled: true,
        senderApproved: true,
        senderIdentityDigest: "d".repeat(64),
        senderApprovedAt: "2026-09-01T00:00:00.000Z",
        pastTriggerEnabled: true,
        pastTriggerConfig: DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    };
    const input = {
        branchId,
        subject: { kind: "task-client" as const, taskId },
        rule,
        schedule,
        serviceRecordCase,
        token,
        scheduleIdentity: agentAutomationScheduleIdentity(scheduleIncarnationId),
        serviceRecordUrl,
        sourcePayload,
        scheduledFor: getServiceRecordLinkScheduledFor(startDate),
        dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary`,
        snapshot,
        change: "create" as const,
        policy,
        now,
    };
    return { input, schedule, token, snapshot };
}

describe("service-record-link automation effect recipe", () => {
    it("describes a current link using digests only and no provider data", () => {
        const f = fixture();
        const effect = describeServiceRecordLinkEffect(f.input);
        expect(effect).not.toBeNull();
        expect(effect).toMatchObject({
            kind: "service-record-link",
            ruleId: SERVICE_RECORD_LINK_RULE_ID,
            scheduleId,
            recipientType: "primary-employee",
            templateKey: MessageTriggerTemplateKey.SERVICE_RECORD_LINK,
            change: "create",
        });
        expect(agentAutomationEffectDigest([effect!])).toMatch(/^[a-f0-9]{64}$/);
        for (const digest of [effect!.recipientDigest, effect!.sourceDigest, effect!.templateDigest, effect!.policyDigest, effect!.recipeDigest]) {
            expect(digest).toMatch(/^[a-f0-9]{64}$/);
        }
        for (const raw of [employeePhone, "합성 고객", "합성 관리사", serviceRecordUrl, "efl_synthetic_token", "합성 메시지 본문"]) {
            expect(JSON.stringify(effect)).not.toContain(raw);
        }
    });

    it.each([
        ["incarnation", (f: ReturnType<typeof fixture>) => { f.schedule.incarnationId = "76000000-0000-4000-8000-000000000006"; }],
        ["token", (f: ReturnType<typeof fixture>) => { f.token.active = false; }],
        ["snapshot", (f: ReturnType<typeof fixture>) => { (f.snapshot as { snapshotHash: string }).snapshotHash = "invalid"; }],
        ["payload", (f: ReturnType<typeof fixture>) => { f.input.sourcePayload["buttonUrl"] = ""; }],
    ])("fails closed when the current %s changes", (_label, mutate) => {
        const f = fixture();
        mutate(f);
        expect(describeServiceRecordLinkEffect(f.input)).toBeNull();
    });
});
