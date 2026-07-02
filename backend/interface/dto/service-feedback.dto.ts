import { IsString, IsOptional, IsBoolean, IsObject, IsDateString } from "class-validator";

/** Phone challenge — public endpoint, takes the link token + provider phone. */
export class VerifyFeedbackPhoneDto {
    @IsString()
    linkToken!: string;

    @IsString()
    phone!: string;
}

/** One-time service header (top of the 제공기록지). */
export class SaveServiceHeaderDto {
    @IsOptional() @IsString() momName?: string;
    @IsOptional() @IsString() momBirth?: string;
    @IsOptional() @IsString() babyName?: string;
    @IsOptional() @IsString() babyBirth?: string;
    @IsOptional() @IsString() deliveryType?: string;
    @IsOptional() @IsString() babyWeight?: string;
}

/** A single service session's record (used for both draft save and final submit). */
export class UpsertSessionDto {
    @IsDateString()
    serviceDate!: string;

    /** ①–⑪ structured answers, free-form per the form layout. */
    @IsOptional() @IsObject() answers?: Record<string, unknown>;

    @IsOptional() @IsString() etcService?: string;
    @IsOptional() @IsString() notes?: string;
    @IsOptional() @IsBoolean() paymentConfirmed?: boolean;
    /** 산모 확인서명 (data URL / storage ref). */
    @IsOptional() @IsString() momSignature?: string;
}
