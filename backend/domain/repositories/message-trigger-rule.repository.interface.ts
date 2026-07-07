import { MessageTriggerEventType } from "domain/constants/message-trigger-catalog";
import { MessageTriggerRuleEntity } from "domain/entities/message-trigger-rule.entity";

export interface IMessageTriggerRuleRepository {
    findAll(branchId: string): Promise<MessageTriggerRuleEntity[]>;
    findById(branchId: string, id: string): Promise<MessageTriggerRuleEntity | null>;
    findActiveByEventTypes(
        branchId: string,
        eventTypes: MessageTriggerEventType[],
    ): Promise<MessageTriggerRuleEntity[]>;
    create(branchId: string, rule: MessageTriggerRuleEntity): Promise<MessageTriggerRuleEntity>;
    update(branchId: string, rule: MessageTriggerRuleEntity): Promise<MessageTriggerRuleEntity>;
    delete(branchId: string, id: string): Promise<void>;
}

export const MESSAGE_TRIGGER_RULE_REPOSITORY = "MESSAGE_TRIGGER_RULE_REPOSITORY";
