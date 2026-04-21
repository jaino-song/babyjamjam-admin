import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";

export interface IAlimtalkLogRepository {
    save(log: AlimtalkLogEntity): Promise<AlimtalkLogEntity>;
    update(log: AlimtalkLogEntity): Promise<AlimtalkLogEntity>;
    findPendingRetries(): Promise<AlimtalkLogEntity[]>;
    findRecentByBranch(
        branchId: string,
        limit?: number,
    ): Promise<AlimtalkLogEntity[]>;
}

export const ALIMTALK_LOG_REPOSITORY = "ALIMTALK_LOG_REPOSITORY";
