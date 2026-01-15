import { Injectable, Inject } from "@nestjs/common";
import {
    ISystemSettingRepository,
    SYSTEM_SETTING_REPOSITORY,
} from "domain/repositories/system-setting.repository.interface";

@Injectable()
export class GetSettingUsecase {
    constructor(
        @Inject(SYSTEM_SETTING_REPOSITORY)
        private readonly repository: ISystemSettingRepository
    ) {}

    async execute(key: string): Promise<string | null> {
        const entity = await this.repository.findByKey(key);
        return entity?.value ?? null;
    }

    async executeWithDefault(key: string, defaultValue: string): Promise<string> {
        const value = await this.execute(key);
        return value ?? defaultValue;
    }
}
