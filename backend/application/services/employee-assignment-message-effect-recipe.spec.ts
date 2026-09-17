import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG } from "domain/entities/system-setting.entity";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";
import { agentAutomationScheduleIdentity } from "application/agent/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type { ClientMessageEffectPolicy } from "./client-message-effect-recipe";
import { buildEmployeeAssignmentMessageEffect } from "./employee-assignment-message-effect-recipe";
import { buildEmployeeAssignmentMessageRecipe, type EmployeeAssignmentScheduleSource } from "./message-trigger-recipes";
import type { SmsTriggerDeliverySnapshot } from "./sms-trigger-delivery.service";

const branchId = "7b000000-0000-4000-8000-000000000001";
const clientId = 971300001;
const scheduleId = 971300011;
const incarnationId = "7b000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-18T00:00:00.000Z");
const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: clientId, createdAt: now.toISOString() });

const policy: ClientMessageEffectPolicy = {
    dispatchEnabled: true,
    senderApproved: true,
    senderIdentityDigest: "a".repeat(64),
    senderApprovedAt: "2026-09-17T00:00:00.000Z",
    pastTriggerEnabled: true,
    pastTriggerConfig: DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
};

const rule = new MessageTriggerRuleEntity(
    "employee-assignment-rule",
    branchId,
    "합성 직원 배정",
    true,
    MessageTriggerEventType.EMPLOYEE_ASSIGNED,
    MessageTriggerOffsetType.IMMEDIATE,
    0,
    MessageTriggerRecipientType.PRIMARY_EMPLOYEE,
    MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
    now,
    now,
);

const schedule: EmployeeAssignmentScheduleSource & { incarnationId: string } = {
    id: scheduleId,
    incarnationId,
    branchId,
    clientId,
    workAddress: "합성 주소",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2026-10-10T00:00:00.000Z"),
    replaced: false,
    terminatedAt: null,
    primaryEmployeeId: 971300021,
    secondaryEmployeeId: 971300022,
    client: { id: clientId, name: "합성 고객" },
    primaryEmployee: { id: 971300021, name: "합성 담당자", phone: "01000000231" },
    secondaryEmployee: { id: 971300022, name: "합성 보조자", phone: "01000000232" },
};

function snapshot(): SmsTriggerDeliverySnapshot {
    return {
        templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
        receiver: "01000000231",
        maskedReceiver: "010****0231",
        recipientName: "합성 담당자",
        message: "합성 배정 안내",
        title: "직원 배정 안내",
        requestedDeliveryType: "AUTO",
        deliveryType: "LMS",
        estimatedCost: "1",
        templateVersion: "synthetic-template-v1",
        templateHash: "b".repeat(64),
        configVersion: "synthetic-config-v1",
        configHash: "c".repeat(64),
        snapshotHash: "d".repeat(64),
    };
}

function buildEffect(overrides: Partial<Parameters<typeof buildEmployeeAssignmentMessageEffect>[0]> = {}) {
    const recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, now);
    if (!recipe) throw new Error("Missing synthetic employee recipe");
    return buildEmployeeAssignmentMessageEffect({
        branchId,
        subject: { kind: "client", clientId, clientIdentity },
        rule,
        schedule,
        scheduleIdentity: agentAutomationScheduleIdentity(incarnationId),
        recipe,
        snapshot: snapshot(),
        change: "create",
        policy,
        ...overrides,
    });
}

describe("employee-assignment message effect recipe", () => {
    it("describes the canonical employee assignment without persisting source values", () => {
        const effect = buildEffect();
        expect(effect).toMatchObject({
            kind: "employee-assignment",
            ruleId: rule.id,
            scheduleId,
            recipientType: "primary-employee",
            templateKey: MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED,
            change: "create",
        });
        expect(JSON.stringify(effect)).not.toContain("01000000231");
        expect(JSON.stringify(effect)).not.toContain("합성 담당자");
        expect(JSON.stringify(effect)).not.toContain("합성 주소");
    });

    it.each([
        ["retimed schedule", { schedule: { ...schedule, startDate: new Date("2026-10-02T00:00:00.000Z") } }],
        ["replaced schedule", { schedule: { ...schedule, replaced: true } }],
        ["terminated schedule", { schedule: { ...schedule, terminatedAt: new Date("2026-09-20T00:00:00.000Z") } }],
        ["employee change", { schedule: { ...schedule, primaryEmployee: { ...schedule.primaryEmployee!, id: 971300023, name: "변경 담당자", phone: "01000000233" }, primaryEmployeeId: 971300023 } }],
    ] as const)("refuses %s source drift", (_label, changed) => {
        const recipe = buildEmployeeAssignmentMessageRecipe(rule, schedule, now);
        if (!recipe) throw new Error("Missing synthetic employee recipe");
        expect(buildEmployeeAssignmentMessageEffect({
            branchId,
            subject: { kind: "client", clientId, clientIdentity },
            rule,
            schedule: changed.schedule,
            scheduleIdentity: agentAutomationScheduleIdentity(incarnationId),
            recipe,
            snapshot: snapshot(),
            change: "create",
            policy,
        })).toBeNull();
    });

    it("requires a matching schedule incarnation, policy and rendered snapshot", () => {
        expect(buildEffect({ scheduleIdentity: agentBindingHash("wrong-incarnation") })).toBeNull();
        expect(buildEffect({ policy: { ...policy, senderApproved: false } })).toBeNull();
        expect(buildEffect({ snapshot: { ...snapshot(), snapshotHash: "e".repeat(64) } })).not.toBeNull();
        expect(buildEffect({ subject: { kind: "client", clientId, clientIdentity: "e".repeat(64) } })).not.toBeNull();
    });
});
