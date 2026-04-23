import { AlimtalkTriggerEventType } from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerRuleEntity } from "domain/entities/alimtalk-trigger-rule.entity";

export interface IAlimtalkTriggerRuleRepository {
    findAll(branchId: string): Promise<AlimtalkTriggerRuleEntity[]>;
    findById(branchId: string, id: string): Promise<AlimtalkTriggerRuleEntity | null>;
    findActiveByEventTypes(
        branchId: string,
        eventTypes: AlimtalkTriggerEventType[],
    ): Promise<AlimtalkTriggerRuleEntity[]>;
    create(branchId: string, rule: AlimtalkTriggerRuleEntity): Promise<AlimtalkTriggerRuleEntity>;
    update(branchId: string, rule: AlimtalkTriggerRuleEntity): Promise<AlimtalkTriggerRuleEntity>;
    delete(branchId: string, id: string): Promise<void>;
}

export const ALIMTALK_TRIGGER_RULE_REPOSITORY = "ALIMTALK_TRIGGER_RULE_REPOSITORY";
