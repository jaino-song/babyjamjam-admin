import { createHash } from "node:crypto";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
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
    it("preserves the pinned recipe digests for current and pre-기록-08 jobs", () => {
        const f = fixture();
        const current = describeServiceRecordLinkEffect({
            ...f.input, scheduledFor: new Date("2026-09-30T03:00:00.000Z"),
        });
        const legacy = describeServiceRecordLinkEffect({
            ...f.input, scheduledFor: new Date("2026-10-01T06:00:00.000Z"),
        });
        expect(current).not.toBeNull();
        expect(legacy).not.toBeNull();
        expect(current?.recipeDigest).toBe("3539dd6d9d2d4e49eaf26f8f98615682b1e385c25061eed94a7872fe017cb9df");
        expect(legacy?.recipeDigest).toBe("a95c69e0986a35c46b9b9dd9d29b70734781b50f339e3ea6d37b3ad402b876de");
        expect(legacy?.recipeDigest).toBe(agentBindingHash({
            version: "service-record-link-automation-recipe-v1",
            operation: "service-record-link",
            scheduling: { kind: "service-start-15-kst", scheduledFor: "2026-10-01T06:00:00.000Z" },
            eventType: MessageTriggerEventType.SERVICE_START,
            offsetType: MessageTriggerOffsetType.SAME_DAY,
            offsetDays: 0,
            sendTime: "15:00",
            recipientType: MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
            scheduleIdentity: agentAutomationScheduleIdentity("76000000-0000-4000-8000-000000000003"),
            serviceRecordCaseId: "76000000-0000-4000-8000-000000000004",
        }));
        for (const digest of ["recipientDigest", "sourceDigest", "templateDigest", "policyDigest"] as const) {
            expect(legacy?.[digest]).toBe(current?.[digest]);
        }
    });

    it.each(["2026-10-01T05:00:00.000Z", "2026-09-29T03:00:00.000Z", "2026-09-17T00:00:00.000Z"])(
        "refuses a non-nominal or immediate send time %s", (scheduledFor) => {
            expect(describeServiceRecordLinkEffect({ ...fixture().input, scheduledFor: new Date(scheduledFor) })).toBeNull();
        },
    );

    it("refuses a manual dedupe key even at the legacy send time", () => {
        const f = fixture();
        expect(describeServiceRecordLinkEffect({
            ...f.input,
            scheduledFor: new Date("2026-10-01T06:00:00.000Z"),
            dedupeKey: `${SERVICE_RECORD_LINK_RULE_ID}:schedule:${scheduleId}:primary:manual:synthetic`,
        })).toBeNull();
    });

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

    it("ignores lifecycle bookkeeping changes that do not change the link payload", () => {
        const f = fixture();
        const before = describeServiceRecordLinkEffect(f.input);
        f.input.serviceRecordCase!.version += 1;
        f.input.serviceRecordCase!.updatedAt = new Date("2026-09-18T02:00:00Z");
        const after = describeServiceRecordLinkEffect(f.input);
        expect(after?.sourceDigest).toBe(before?.sourceDigest);
        expect(after?.recipeDigest).toBe(before?.recipeDigest);
    });
});
