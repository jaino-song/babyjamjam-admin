import { MessageLogEntity } from "domain/entities/message-log.entity";

export interface IMessageLogRepository {
    save(log: MessageLogEntity): Promise<MessageLogEntity>;
    update(log: MessageLogEntity): Promise<MessageLogEntity>;
    startRetryAttempt(
        sourceLog: MessageLogEntity,
        retryLog: MessageLogEntity,
    ): Promise<MessageLogEntity | null>;
    findSentTriggerJobIds(jobIds: string[]): Promise<Set<string>>;
    findPendingRetries(): Promise<MessageLogEntity[]>;
    findRetryableServiceRecordSmsByScheduleId(scheduleId: number): Promise<MessageLogEntity[]>;
    findRecentByBranch(
        branchId: string,
        limit?: number,
        skip?: number,
    ): Promise<MessageLogEntity[]>;
}

export const MESSAGE_LOG_REPOSITORY = "MESSAGE_LOG_REPOSITORY";
