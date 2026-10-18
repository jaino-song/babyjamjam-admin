import { Equals, IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsInt, Min, Matches, ValidateIf } from "class-validator";
import {
    MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES,
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTargetClientStatus,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export class CreateMessageTriggerRuleDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsEnum(MessageTriggerEventType)
    eventType!: MessageTriggerEventType;

    @IsEnum(MessageTriggerOffsetType)
    offsetType!: MessageTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "발송 시각은 HH:mm 형식이어야 합니다 (한국 시간)." })
    sendTime?: string;

    @IsEnum(MessageTriggerRecipientType)
    recipientType!: MessageTriggerRecipientType;

    @IsEnum(MessageTriggerTemplateKey)
    templateKey!: MessageTriggerTemplateKey;

    @ValidateIf((_object, value) => value !== undefined)
    @IsIn(MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES)
    targetClientStatus?: MessageTriggerTargetClientStatus;

    @ValidateIf((_object, value) => value !== undefined)
    @IsBoolean()
    retryOnFailure?: boolean;
}

export class UpdateMessageTriggerRuleDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsEnum(MessageTriggerEventType)
    eventType?: MessageTriggerEventType;

    @IsOptional()
    @IsEnum(MessageTriggerOffsetType)
    offsetType?: MessageTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "발송 시각은 HH:mm 형식이어야 합니다 (한국 시간)." })
    sendTime?: string;

    @IsOptional()
    @IsEnum(MessageTriggerRecipientType)
    recipientType?: MessageTriggerRecipientType;

    @IsOptional()
    @IsEnum(MessageTriggerTemplateKey)
    templateKey?: MessageTriggerTemplateKey;

    @ValidateIf((_object, value) => value !== undefined)
    @IsIn(MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES)
    targetClientStatus?: MessageTriggerTargetClientStatus;

    @ValidateIf((_object, value) => value !== undefined)
    @IsBoolean()
    retryOnFailure?: boolean;
}

export class UpdateMessageTriggerRuleBranchActivationDto {
    @IsBoolean()
    isActive!: boolean;
}

export class UpdateMessageTriggerRuleActivationWithParentDto {
    @IsBoolean()
    @Equals(true)
    isActive!: true;

    @IsBoolean()
    @Equals(true)
    enableParent!: true;
}
