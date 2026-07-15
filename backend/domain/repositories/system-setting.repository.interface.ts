import { SystemSettingEntity } from "domain/entities/system-setting.entity";

export interface ISystemSettingRepository {
    findByKey(key: string): Promise<SystemSettingEntity | null>;
    upsert(entity: SystemSettingEntity): Promise<SystemSettingEntity>;
}

export const SYSTEM_SETTING_REPOSITORY = "SYSTEM_SETTING_REPOSITORY";
