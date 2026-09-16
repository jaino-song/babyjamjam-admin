export interface RibbonConfig {
    enabled: boolean;
    message: string;
    backgroundColor: string;
    textColor: string;
    linkText: string;
    linkHref: string;
    linkColor: string;
}

export interface MessageAutomationPastTriggerConfig {
    sendIntervalMinutes: number;
    ruleOrder: string[];
}

export interface ContractAutoFinalizeConfig {
    enabled: boolean;
    graceDays: number;
    maxAttempts: number;
}

export const DEFAULT_RIBBON_CONFIG: RibbonConfig = {
    enabled: false,
    message: "",
    backgroundColor: "#004AAD",
    textColor: "#FFFFFF",
    linkText: "",
    linkHref: "",
    linkColor: "#FFB27B",
};

export const DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG: MessageAutomationPastTriggerConfig = {
    sendIntervalMinutes: 1,
    ruleOrder: [],
};

export const DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG: ContractAutoFinalizeConfig = {
    enabled: true,
    graceDays: 7,
    maxAttempts: 3,
};

export function normalizeContractAutoFinalizeConfig(config: unknown): ContractAutoFinalizeConfig {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        return DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG;
    }

    const candidate = config as Partial<ContractAutoFinalizeConfig>;
    return {
        enabled: typeof candidate.enabled === "boolean"
            ? candidate.enabled
            : DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.enabled,
        graceDays: Number.isInteger(candidate.graceDays)
            ? Math.min(Math.max(candidate.graceDays as number, 0), 30)
            : DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.graceDays,
        maxAttempts: Number.isInteger(candidate.maxAttempts)
            ? Math.min(Math.max(candidate.maxAttempts as number, 1), 10)
            : DEFAULT_CONTRACT_AUTO_FINALIZE_CONFIG.maxAttempts,
    };
}

export class SystemSettingEntity {
    static readonly RIBBON_CONFIG_KEY = "ribbon_config";

    constructor(
        public readonly key: string,
        public value: string,
        public updatedAt: Date
    ) {}

    static create(key: string, value: string): SystemSettingEntity {
        return new SystemSettingEntity(key, value, new Date());
    }

    update(newValue: string): void {
        this.value = newValue;
        this.updatedAt = new Date();
    }

}
