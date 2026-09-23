import {
    IsBoolean,
    IsDateString,
    MaxLength,
    IsObject,
    IsOptional,
    IsString,
    ValidateBy,
    ValidateIf,
    ValidationArguments,
    ValidationOptions,
} from "class-validator";

import {
    getServiceRecordHeaderFieldError,
    type ServiceRecordHeaderValidationKey,
} from "@babyjamjam/shared/utils/service-record-input";

import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";

const PNG_DATA_URI_PREFIX = "data:image/png;base64,";
const MAX_SIGNATURE_BYTES = 192 * 1024;
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function IsValidMomSignature(validationOptions?: ValidationOptions): PropertyDecorator {
    return ValidateBy({
        name: "isValidMomSignature",
        validator: {
            validate(value: unknown): boolean {
                if (typeof value !== "string" || !value.startsWith(PNG_DATA_URI_PREFIX)) {
                    return false;
                }
                const body = value.slice(PNG_DATA_URI_PREFIX.length);
                if (!body || !STRICT_BASE64_PATTERN.test(body)) {
                    return false;
                }
                return Buffer.from(body, "base64").length <= MAX_SIGNATURE_BYTES;
            },
            defaultMessage(): string {
                return "clientSignature must be a PNG data URI no larger than 192KB";
            },
        },
    }, validationOptions);
}

/** Phone challenge — public endpoint, takes the link token + provider phone. */
export class VerifyServiceRecordPhoneDto {
    @IsString()
    linkToken!: string;

    @IsString()
    phone!: string;
}

/** Server and UI share the same strict rules; no normalization occurs here. */
function IsServiceRecordHeaderInput(key: ServiceRecordHeaderValidationKey): PropertyDecorator {
    return ValidateBy({
        name: "isServiceRecordHeaderInput",
        validator: {
            validate(value: unknown): boolean {
                return getServiceRecordHeaderFieldError(key, value, new Date(), { required: true }) === null;
            },
            defaultMessage(args: ValidationArguments): string {
                return getServiceRecordHeaderFieldError(key, args.value, new Date(), { required: true })
                    ?? "입력 형식을 확인해 주세요.";
            },
        },
    });
}

/** Partial updates stay supported, but supplied empty/null/malformed values are rejected. */
export class SaveServiceHeaderDto {
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("momName") momName?: string;
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("momBirth") momBirth?: string;
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("babyName") babyName?: string;
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("babyBirth") babyBirth?: string;
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("deliveryType") deliveryType?: string;
    @ValidateIf((_object, value) => value !== undefined) @IsServiceRecordHeaderInput("babyWeight") babyWeight?: string;
}

/** A single service session's record (used for both draft save and final submit). */
export class UpsertSessionDto {
    @IsDateString()
    serviceDate!: string;

    /** ①–⑪ structured answers, free-form per the form layout. */
    @IsOptional() @IsObject() answers?: Record<string, unknown>;

    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.etcService)
    etcService?: string;

    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.notes)
    notes?: string;
    @IsOptional() @IsBoolean() paymentConfirmed?: boolean;
    /** 산모 확인 (data URL / storage ref). */
    @IsOptional() @IsString() momApproval?: string;

    @IsOptional() @IsString() @IsValidMomSignature()
    clientSignature?: string;
}
