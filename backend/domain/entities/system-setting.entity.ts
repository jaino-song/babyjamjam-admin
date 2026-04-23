export const ALIMTALK_PROVIDERS = ["channeltalk", "aligo", "none"] as const;
export type AlimtalkProvider = (typeof ALIMTALK_PROVIDERS)[number];

export interface RibbonConfig {
    enabled: boolean;
    message: string;
    backgroundColor: string;
    textColor: string;
    linkText: string;
    linkHref: string;
    linkColor: string;
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

export class SystemSettingEntity {
    static readonly ALIMTALK_PROVIDER_KEY = "alimtalk_provider";
    static readonly DEFAULT_ALIMTALK_PROVIDER: AlimtalkProvider = "aligo";
    static readonly RIBBON_CONFIG_KEY = "ribbon_config";

    constructor(
        public readonly key: string,
        public value: string,
        public updatedAt: Date
    ) {}

    static create(key: string, value: string): SystemSettingEntity {
        return new SystemSettingEntity(key, value, new Date());
    }

    static createAlimtalkProviderSetting(provider: AlimtalkProvider): SystemSettingEntity {
        if (!ALIMTALK_PROVIDERS.includes(provider)) {
            throw new Error(
                `Invalid alimtalk provider: ${provider}. Valid values are: ${ALIMTALK_PROVIDERS.join(", ")}`
            );
        }
        return new SystemSettingEntity(
            SystemSettingEntity.ALIMTALK_PROVIDER_KEY,
            provider,
            new Date()
        );
    }

    update(newValue: string): void {
        this.value = newValue;
        this.updatedAt = new Date();
    }

    isAlimtalkProvider(): boolean {
        return this.key === SystemSettingEntity.ALIMTALK_PROVIDER_KEY;
    }

    getAlimtalkProvider(): AlimtalkProvider {
        if (!this.isAlimtalkProvider()) {
            throw new Error("Cannot get alimtalk provider from non-alimtalk_provider setting");
        }
        if (!ALIMTALK_PROVIDERS.includes(this.value as AlimtalkProvider)) {
            throw new Error(
                `Invalid alimtalk provider: ${this.value}. Valid values are: ${ALIMTALK_PROVIDERS.join(", ")}`
            );
        }
        return this.value as AlimtalkProvider;
    }
}
