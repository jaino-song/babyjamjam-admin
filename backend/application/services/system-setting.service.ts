import { Injectable } from "@nestjs/common";
import { GetSettingUsecase, UpdateSettingUsecase } from "application/usecases/system-setting";
import {
    SystemSettingEntity,
    AlimtalkProvider,
    ALIMTALK_PROVIDERS,
    RibbonConfig,
    DEFAULT_RIBBON_CONFIG,
    MessageAutomationPastTriggerConfig,
    DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
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

    private getMessageAutomationPastTriggerConfigKey(branchId: string): string {
        return `branch:${branchId}:message_automation:past_trigger`;
    }

    async getAlimtalkProvider(): Promise<AlimtalkProvider> {
        const value = await this.getSettingUsecase.executeWithDefault(
            SystemSettingEntity.ALIMTALK_PROVIDER_KEY,
            SystemSettingEntity.DEFAULT_ALIMTALK_PROVIDER
        );
        return value as AlimtalkProvider;
    }

    async getAlimtalkProviderSetting(): Promise<SystemSettingEntity | null> {
        return this.getSettingUsecase.executeEntity(SystemSettingEntity.ALIMTALK_PROVIDER_KEY);
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

    async getMessageAutomationPastTriggerConfig(
        branchId: string,
    ): Promise<MessageAutomationPastTriggerConfig> {
        const value = await this.getSettingUsecase.execute(
            this.getMessageAutomationPastTriggerConfigKey(branchId)
        );
        return this.parseMessageAutomationPastTriggerConfig(value);
    }

    async setMessageAutomationPastTriggerConfig(
        branchId: string,
        config: MessageAutomationPastTriggerConfig,
    ): Promise<SystemSettingEntity> {
        const normalized = this.normalizeMessageAutomationPastTriggerConfig(config);
        return this.updateSettingUsecase.execute(
            this.getMessageAutomationPastTriggerConfigKey(branchId),
            JSON.stringify(normalized)
        );
    }

    private parseMessageAutomationPastTriggerConfig(
        value: string | null,
    ): MessageAutomationPastTriggerConfig {
        if (!value) return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;

        try {
            return this.normalizeMessageAutomationPastTriggerConfig(JSON.parse(value));
        } catch {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }
    }

    private normalizeMessageAutomationPastTriggerConfig(
        config: unknown,
    ): MessageAutomationPastTriggerConfig {
        if (typeof config !== "object" || config === null) {
            return DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG;
        }

        const candidate = config as Partial<MessageAutomationPastTriggerConfig>;
        const sendIntervalMinutes = Number.isInteger(candidate.sendIntervalMinutes)
            ? candidate.sendIntervalMinutes
            : DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG.sendIntervalMinutes;
        const ruleOrder = Array.isArray(candidate.ruleOrder)
            ? candidate.ruleOrder.filter((id): id is string => typeof id === "string" && id.length > 0)
            : DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG.ruleOrder;

        return {
            sendIntervalMinutes: Math.min(Math.max(sendIntervalMinutes ?? 1, 1), 1440),
            ruleOrder: [...new Set(ruleOrder)],
        };
    }
}
