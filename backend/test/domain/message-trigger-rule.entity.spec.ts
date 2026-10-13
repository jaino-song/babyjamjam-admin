import {
    DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
    DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
    MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
    isMessageTriggerTargetClientStatus,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

describe("MessageTriggerRuleEntity 대상 고객 상태 / 실패 시 재전송 (규칙 메시지-04)", () => {
    const base = {
        name: "규칙",
        eventType: MessageTriggerEventType.CLIENT_CREATED,
        offsetType: MessageTriggerOffsetType.IMMEDIATE,
        recipientType: MessageTriggerRecipientType.CLIENT,
        templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
    };

    it("allows exactly all, pre_booking, waiting and active", () => {
        expect([...MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES]).toEqual(["all", "pre_booking", "waiting", "active"]);
        for (const value of MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES) {
            expect(isMessageTriggerTargetClientStatus(value)).toBe(true);
        }
        for (const value of ["completed", "terminated", "replacement_requested", "ALL", "", null, undefined, 1]) {
            expect(isMessageTriggerTargetClientStatus(value)).toBe(false);
        }
    });

    it("defaults to 전체 / 재전송 켬 on create and on reconstitute", () => {
        expect(DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS).toBe("all");
        expect(DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE).toBe(true);
        const created = MessageTriggerRuleEntity.create(base);
        expect(created.targetClientStatus).toBe("all");
        expect(created.retryOnFailure).toBe(true);
        const reconstituted = MessageTriggerRuleEntity.reconstitute(
            "r", null, "규칙", true, base.eventType, base.offsetType, 0, base.recipientType, base.templateKey,
            new Date(0), new Date(0),
        );
        expect(reconstituted.targetClientStatus).toBe("all");
        expect(reconstituted.retryOnFailure).toBe(true);
    });

    it("keeps explicit values on create and reconstitute", () => {
        const created = MessageTriggerRuleEntity.create({ ...base, targetClientStatus: "waiting", retryOnFailure: false });
        expect(created).toMatchObject({ targetClientStatus: "waiting", retryOnFailure: false });
        const reconstituted = MessageTriggerRuleEntity.reconstitute(
            "r", null, "규칙", true, base.eventType, base.offsetType, 0, base.recipientType, base.templateKey,
            new Date(0), new Date(0), false, false, "09:00", "active", false,
        );
        expect(reconstituted).toMatchObject({ targetClientStatus: "active", retryOnFailure: false });
    });

    it("leaves both fields unchanged when an update does not mention them", () => {
        const rule = MessageTriggerRuleEntity.create({ ...base, targetClientStatus: "pre_booking", retryOnFailure: false });
        rule.update({ name: "이름만 변경", isActive: false, sendTime: "10:30" });
        expect(rule).toMatchObject({ name: "이름만 변경", targetClientStatus: "pre_booking", retryOnFailure: false });
    });

    it("changes only the field an update names", () => {
        const rule = MessageTriggerRuleEntity.create({ ...base, targetClientStatus: "pre_booking", retryOnFailure: false });
        rule.update({ retryOnFailure: true });
        expect(rule).toMatchObject({ targetClientStatus: "pre_booking", retryOnFailure: true });
        rule.update({ targetClientStatus: "active" });
        expect(rule).toMatchObject({ targetClientStatus: "active", retryOnFailure: true });
    });
});
