import { AlimtalkTriggerEventType } from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";

export interface IAlimtalkTriggerRuleRepository {
    findAll(organizationId: string): Promise<AlimtalkTriggerRuleEntity[]>;
    findById(organizationId: string, id: string): Promise<AlimtalkTriggerRuleEntity | null>;
    findActiveByEventTypes(
        organizationId: string,
        eventTypes: AlimtalkTriggerEventType[],
    ): Promise<AlimtalkTriggerRuleEntity[]>;
    create(organizationId: string, rule: AlimtalkTriggerRuleEntity): Promise<AlimtalkTriggerRuleEntity>;
    update(organizationId: string, rule: AlimtalkTriggerRuleEntity): Promise<AlimtalkTriggerRuleEntity>;
    delete(organizationId: string, id: string): Promise<void>;
}

export const ALIMTALK_TRIGGER_RULE_REPOSITORY = "ALIMTALK_TRIGGER_RULE_REPOSITORY";
