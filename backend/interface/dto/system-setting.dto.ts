import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";
import { ALIMTALK_PROVIDERS, AlimtalkProvider, RibbonConfig } from "domain/entities/system-setting.entity";

export class UpdateAlimtalkProviderDto {
    @IsString()
    @IsNotEmpty()
    @IsIn([...ALIMTALK_PROVIDERS])
    provider!: AlimtalkProvider;
}

export class AlimtalkProviderResponseDto {
    provider!: AlimtalkProvider;
    enabled!: boolean;
    updatedAt?: string;

    static from(provider: AlimtalkProvider, enabled: boolean, updatedAt?: Date): AlimtalkProviderResponseDto {
        const dto = new AlimtalkProviderResponseDto();
        dto.provider = provider;
        dto.enabled = enabled;
        dto.updatedAt = updatedAt?.toISOString();
        return dto;
    }
}

export class UpdateNotificationPreferencesDto {
    @IsBoolean()
    emailNotificationsEnabled!: boolean;
}

export class NotificationPreferencesResponseDto {
    emailNotificationsEnabled!: boolean;
    updatedAt?: string;

    static from(emailNotificationsEnabled: boolean, updatedAt?: Date): NotificationPreferencesResponseDto {
        const dto = new NotificationPreferencesResponseDto();
        dto.emailNotificationsEnabled = emailNotificationsEnabled;
        dto.updatedAt = updatedAt?.toISOString();
        return dto;
    }
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class UpdateRibbonConfigDto {
    @IsBoolean()
    enabled!: boolean;

    @IsString()
    message!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    backgroundColor!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    textColor!: string;

    @IsString()
    @IsOptional()
    linkText!: string;

    @IsString()
    @IsOptional()
    linkHref!: string;

    @IsString()
    @Matches(HEX_COLOR_REGEX)
    linkColor!: string;
}

export class RibbonConfigResponseDto {
    enabled!: boolean;
    message!: string;
    backgroundColor!: string;
    textColor!: string;
    linkText!: string;
    linkHref!: string;
    linkColor!: string;
    updatedAt?: string;

    static from(config: RibbonConfig, updatedAt?: Date): RibbonConfigResponseDto {
        const dto = new RibbonConfigResponseDto();
        dto.enabled = config.enabled;
        dto.message = config.message;
        dto.backgroundColor = config.backgroundColor;
        dto.textColor = config.textColor;
        dto.linkText = config.linkText;
        dto.linkHref = config.linkHref;
        dto.linkColor = config.linkColor;
        dto.updatedAt = updatedAt?.toISOString();
        return dto;
    }
}
