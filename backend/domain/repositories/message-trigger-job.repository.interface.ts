import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

export interface IMessageTriggerJobRepository {
    create(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    update(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
    findById(id: string): Promise<MessageTriggerJobEntity | null>;
    claimPending(id: string): Promise<boolean>;
    findDuePending(limit?: number): Promise<MessageTriggerJobEntity[]>;
    findStaleProcessing(cutoff: Date, limit?: number): Promise<MessageTriggerJobEntity[]>;
    findUpcomingPendingByBranch(
        branchId: string,
        limit?: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findPendingByRuleId(ruleId: string): Promise<MessageTriggerJobEntity[]>;
    findPendingByRuleIdsAndClientId(ruleIds: string[], clientId: number): Promise<MessageTriggerJobEntity[]>;
    findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    findSentByRuleIdAndEmployeeScheduleId(
        ruleId: string,
        employeeScheduleId: number,
    ): Promise<MessageTriggerJobEntity[]>;
    cancelPendingByRuleId(ruleId: string, reason: string): Promise<number>;
    upsertPending(job: MessageTriggerJobEntity): Promise<MessageTriggerJobEntity>;
}

export const MESSAGE_TRIGGER_JOB_REPOSITORY = "MESSAGE_TRIGGER_JOB_REPOSITORY";
