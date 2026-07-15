import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    ValidateIf,
    ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { PROPOSAL_FIELDS } from "application/services/call-extraction.prompt";

export class CreateCallIngestTokenDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    label!: string;
}

export class TranscriptTurnDto {
    @IsString()
    @MaxLength(50)
    speaker!: string;

    @IsString()
    @MaxLength(2_000)
    text!: string;
}

export class CallSummaryDto {
    @IsOptional() @IsString() @MaxLength(2_000)
    inquiry_type?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    customer_info?: string;

    @IsOptional() @IsString() @MaxLength(5_000)
    key_content?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    result_action?: string;
}

export class ProposalDto {
    @IsIn([...PROPOSAL_FIELDS])
    field!: string;

    @ValidateIf((_, value) => value !== null)
    value!: string | number | boolean | null;

    @IsString()
    @MaxLength(2_000)
    evidence!: string;

    @IsIn(["high", "low"])
    confidence!: "high" | "low";
}

export class PatchClientDraftDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProposalDto)
    proposals?: ProposalDto[];

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    clientId?: number | null;
}

export class ConfirmNewClientDraftDto {
    /** staff-final values; same shape as CreateClientDto minus employee fields */
    @IsObject()
    fields!: Record<string, unknown>;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;
}

export class ConfirmClientUpdateDraftDto {
    /** included changes only; keys validated against PROPOSAL_FIELDS in the service */
    @IsObject()
    changes!: Record<string, unknown>;
}

/** Permissive union DTO used by the controller — the service discriminates by draft type */
export class ConfirmDraftDto {
    @IsOptional()
    @IsObject()
    fields?: Record<string, unknown>;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;

    @IsOptional()
    @IsObject()
    changes?: Record<string, unknown>;
}

export class DiscardClientDraftDto {
    @IsOptional()
    @IsString()
    @MaxLength(1_000)
    reason?: string;
}

export class CallTranscriptWebhookDto {
    @IsString()
    @MaxLength(200)
    fileId!: string;

    @IsString()
    @MaxLength(500)
    fileName!: string;

    @IsOptional()
    @IsDateString({ strict: true })
    recordedAt?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => TranscriptTurnDto)
    transcript!: TranscriptTurnDto[];

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => CallSummaryDto)
    summary?: CallSummaryDto;
}
