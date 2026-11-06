import { Type } from "class-transformer";
import { IsBoolean, IsDefined, IsEnum, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Min, ValidateIf, ValidateNested } from "class-validator";
import {
    MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES, MessageTriggerEventType, MessageTriggerOffsetType,
    MessageTriggerRecipientType, MessageTriggerTargetClientStatus, MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export const MESSAGE_TRIGGER_GROUP_MODES = ["CLIENT", "PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE", "BOTH_EMPLOYEES"] as const;

/** Syntax covers the stored modes; Phase6's service gate allows CLIENT only. */
export class CreateMessageTriggerRuleGroupDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/\S/)
    name!: string;

    @IsIn(MESSAGE_TRIGGER_GROUP_MODES)
    recipientMode!: MessageTriggerRecipientType | "BOTH_EMPLOYEES";

    @IsEnum(MessageTriggerEventType)
    eventType!: MessageTriggerEventType;

    @IsEnum(MessageTriggerOffsetType)
    offsetType!: MessageTriggerOffsetType;

    @ValidateIf((_object, value) => value !== undefined)
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    sendTime?: string;

    @ValidateIf((_object, value) => value !== undefined)
    @IsIn(MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES)
    targetClientStatus?: MessageTriggerTargetClientStatus;

    @ValidateIf((_object, value) => value !== undefined)
    @IsBoolean()
    retryOnFailure?: boolean;

    @ValidateIf((_object, value) => value !== undefined)
    @IsBoolean()
    isActive?: boolean;

    @IsObject()
    recipientTemplates!: Partial<Record<MessageTriggerRecipientType, MessageTriggerTemplateKey>>;
}

export class UpdateMessageTriggerRuleGroupDto extends CreateMessageTriggerRuleGroupDto {
    @IsInt()
    @Min(1)
    expectedVersion!: number;
}

/** The future preview shares this draft syntax; it performs no resolution here. */
export class PreviewMessageTriggerRuleGroupDto {
    @IsDefined()
    @ValidateNested()
    @Type(() => CreateMessageTriggerRuleGroupDto)
    draft!: CreateMessageTriggerRuleGroupDto;

    @IsOptional()
    @IsInt()
    @Min(1)
    clientId?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    employeeScheduleId?: number;
}
