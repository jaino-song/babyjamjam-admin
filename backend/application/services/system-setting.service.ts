import { Injectable } from "@nestjs/common";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import {
    SystemSettingEntity,
    AlimtalkProvider,
    ALIMTALK_PROVIDERS,
    RibbonConfig,
    DEFAULT_RIBBON_CONFIG,
} from "domain/entities/system-setting.entity";

@Injectable()
export class SystemSettingService {
    constructor(
        private readonly getSettingUsecase: GetSettingUsecase,
        private readonly updateSettingUsecase: UpdateSettingUsecase
    ) {}

    private getUserEmailNotificationPreferenceKey(userId: string): string {
        return `user:${userId}:email_notifications_enabled`;
    }

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

    async getUserEmailNotificationsEnabled(userId: string): Promise<boolean> {
        const value = await this.getSettingUsecase.executeWithDefault(
            this.getUserEmailNotificationPreferenceKey(userId),
            "true"
        );

        return value === "true";
    }

    async setUserEmailNotificationsEnabled(userId: string, enabled: boolean): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            this.getUserEmailNotificationPreferenceKey(userId),
            enabled ? "true" : "false"
        );
    }

    async getRibbonConfig(): Promise<RibbonConfig> {
        const value = await this.getSettingUsecase.execute(
            SystemSettingEntity.RIBBON_CONFIG_KEY
        );
        if (!value) return DEFAULT_RIBBON_CONFIG;
        try {
            return { ...DEFAULT_RIBBON_CONFIG, ...JSON.parse(value) };
        } catch {
            return DEFAULT_RIBBON_CONFIG;
        }
    }

    async setRibbonConfig(config: RibbonConfig): Promise<SystemSettingEntity> {
        return this.updateSettingUsecase.execute(
            SystemSettingEntity.RIBBON_CONFIG_KEY,
            JSON.stringify(config)
        );
    }
}
