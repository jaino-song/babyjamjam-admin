import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

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
    @MaxLength(5_000)
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

export class CallTranscriptWebhookDto {
    @IsString()
    @MaxLength(200)
    fileId!: string;

    @IsString()
    @MaxLength(500)
    fileName!: string;

    @IsOptional()
    @IsDateString()
    recordedAt?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2_000)
    @ValidateNested({ each: true })
    @Type(() => TranscriptTurnDto)
    transcript!: TranscriptTurnDto[];

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => CallSummaryDto)
    summary?: CallSummaryDto;
}
