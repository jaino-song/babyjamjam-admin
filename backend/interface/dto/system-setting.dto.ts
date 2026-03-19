import { IsBoolean, IsIn, IsNotEmpty, IsString } from "class-validator";
import { ALIMTALK_PROVIDERS, AlimtalkProvider } from "domain/entities/system-setting.entity";

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
