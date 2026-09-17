import { MessageTriggerEventType, MessageTriggerOffsetType, MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import type { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

export interface MessageTriggerRuleDefaults {
    name: string;
    isActive?: boolean;
    eventType: MessageTriggerEventType;
    offsetType: MessageTriggerOffsetType;
    offsetDays?: number;
    sendTime?: string;
    recipientType: MessageTriggerRecipientType;
    templateKey: MessageTriggerTemplateKey;
}


export const DEFAULT_SERVICE_INFO_TRIGGER: MessageTriggerRuleDefaults = {
    name: "서비스 시작 7일 전 서비스 안내",
    isActive: true,
    eventType: MessageTriggerEventType.SERVICE_START,
    offsetType: MessageTriggerOffsetType.BEFORE_DAYS,
    offsetDays: 7,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
};

export const DEFAULT_CLIENT_GREETING_TRIGGER: MessageTriggerRuleDefaults = {
    name: "신규 고객 인사 메시지",
    isActive: true,
    eventType: MessageTriggerEventType.CLIENT_CREATED,
    offsetType: MessageTriggerOffsetType.IMMEDIATE,
    offsetDays: 0,
    recipientType: MessageTriggerRecipientType.CLIENT,
    templateKey: MessageTriggerTemplateKey.CLIENT_GREETING,
};

export function matchesTriggerDefaults(rule: MessageTriggerRuleEntity, defaults: MessageTriggerRuleDefaults, templateOnly: boolean): boolean {
    if (templateOnly) return rule.templateKey === defaults.templateKey;
    return rule.eventType === defaults.eventType && rule.offsetType === defaults.offsetType
        && rule.offsetDays === (defaults.offsetDays ?? 0) && rule.recipientType === defaults.recipientType
        && rule.templateKey === defaults.templateKey;
}

