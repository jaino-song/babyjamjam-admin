import { Injectable } from "@nestjs/common";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import {
    SystemSettingEntity,
    AlimtalkProvider,
    ALIMTALK_PROVIDERS,
} from "domain/entities/system-setting.entity";

@Injectable()
export class SystemSettingService {
    constructor(
        private readonly getSettingUsecase: GetSettingUsecase,
        private readonly updateSettingUsecase: UpdateSettingUsecase
    ) {}

    async getAlimtalkProvider(): Promise<AlimtalkProvider> {
        const value = await this.getSettingUsecase.executeWithDefault(
            SystemSettingEntity.ALIMTALK_PROVIDER_KEY,
            SystemSettingEntity.DEFAULT_ALIMTALK_PROVIDER
        );
        return value as AlimtalkProvider;
    }

    async setAlimtalkProvider(provider: AlimtalkProvider): Promise<SystemSettingEntity> {
        if (!ALIMTALK_PROVIDERS.includes(provider)) {
            throw new Error(
                `Invalid alimtalk provider: ${provider}. Valid values are: ${ALIMTALK_PROVIDERS.join(", ")}`
            );
        }
        return this.updateSettingUsecase.execute(
            SystemSettingEntity.ALIMTALK_PROVIDER_KEY,
            provider
        );
    }

    async isAlimtalkEnabled(): Promise<boolean> {
        const provider = await this.getAlimtalkProvider();
        return provider !== "none";
    }
}
