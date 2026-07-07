import { MessageLogEntity } from "domain/entities/message-log.entity";

export interface IMessageLogRepository {
    save(log: MessageLogEntity): Promise<MessageLogEntity>;
    update(log: MessageLogEntity): Promise<MessageLogEntity>;
    findPendingRetries(): Promise<MessageLogEntity[]>;
    findRetryableServiceFeedbackSmsByScheduleId(scheduleId: number): Promise<MessageLogEntity[]>;
    findRecentByBranch(
        branchId: string,
        limit?: number,
        skip?: number,
    ): Promise<MessageLogEntity[]>;
}

export const MESSAGE_LOG_REPOSITORY = "MESSAGE_LOG_REPOSITORY";
