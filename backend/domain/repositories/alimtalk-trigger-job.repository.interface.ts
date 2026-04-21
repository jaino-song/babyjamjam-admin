import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";

export interface IAlimtalkTriggerJobRepository {
    create(job: AlimtalkTriggerJobEntity): Promise<AlimtalkTriggerJobEntity>;
    update(job: AlimtalkTriggerJobEntity): Promise<AlimtalkTriggerJobEntity>;
    findById(id: string): Promise<AlimtalkTriggerJobEntity | null>;
    findDuePending(limit?: number): Promise<AlimtalkTriggerJobEntity[]>;
    findUpcomingPendingByBranch(
        branchId: string,
        limit?: number,
    ): Promise<AlimtalkTriggerJobEntity[]>;
    findPendingByRuleId(ruleId: string): Promise<AlimtalkTriggerJobEntity[]>;
    findPendingByRuleIdsAndClientId(ruleIds: string[], clientId: number): Promise<AlimtalkTriggerJobEntity[]>;
    findPendingByRuleIdsAndEmployeeScheduleId(
        ruleIds: string[],
        employeeScheduleId: number,
    ): Promise<AlimtalkTriggerJobEntity[]>;
    upsertPending(job: AlimtalkTriggerJobEntity): Promise<AlimtalkTriggerJobEntity>;
}

export const ALIMTALK_TRIGGER_JOB_REPOSITORY = "ALIMTALK_TRIGGER_JOB_REPOSITORY";
