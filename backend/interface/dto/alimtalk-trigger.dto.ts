import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, Min } from "class-validator";
import {
    AlimtalkTriggerEventType,
    AlimtalkTriggerOffsetType,
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";

export class CreateAlimtalkTriggerRuleDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsEnum(AlimtalkTriggerEventType)
    eventType!: AlimtalkTriggerEventType;

    @IsEnum(AlimtalkTriggerOffsetType)
    offsetType!: AlimtalkTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @IsEnum(AlimtalkTriggerRecipientType)
    recipientType!: AlimtalkTriggerRecipientType;

    @IsEnum(AlimtalkTriggerTemplateKey)
    templateKey!: AlimtalkTriggerTemplateKey;
}

export class UpdateAlimtalkTriggerRuleDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsEnum(AlimtalkTriggerEventType)
    eventType?: AlimtalkTriggerEventType;

    @IsOptional()
    @IsEnum(AlimtalkTriggerOffsetType)
    offsetType?: AlimtalkTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @IsOptional()
    @IsEnum(AlimtalkTriggerRecipientType)
    recipientType?: AlimtalkTriggerRecipientType;

    @IsOptional()
    @IsEnum(AlimtalkTriggerTemplateKey)
    templateKey?: AlimtalkTriggerTemplateKey;
}
