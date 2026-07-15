import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsArray,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from "class-validator";

import { CONSULTATION_INQUIRY_STATUSES } from "domain/entities/consultation-inquiry.entity";

const PHONE_REGEX = /^01[016789]-?\d{3,4}-?\d{4}$/;
const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const UNKNOWN_VOUCHER_TYPE_SENTINEL = "__unknown__";
export const CONSULTATION_VOUCHER_TYPES = [
    "A가1형",
    "A가2형",
    "A가3형",
    "A통합1형",
    "A통합2형",
    "A통합3형",
    "A라1형",
    "A라2형",
    "A라3형",
    "B가1형",
    "B가2형",
    "B통합1형",
    "B통합2형",
    "B라1형",
    "B라2형",
    "C가1형",
    "C가2형",
    "C통합1형",
    "C통합2형",
    "C라1형",
    "C라2형",
    "D가1형",
    "D가2형",
    "D통합1형",
    "D통합2형",
    "D라1형",
    "D라2형",
] as const;

function trimString(value: unknown): unknown {
    return typeof value === "string" ? value.trim() : value;
}

function normalizeVoucherTypeValue(value: unknown): unknown {
    const trimmed = trimString(value);
    if (trimmed === "" || trimmed === UNKNOWN_VOUCHER_TYPE_SENTINEL) {
        return null;
    }

    return trimmed;
}

class SelectedServicePlanDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    @Transform(({ value }) => trimString(value))
    id!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    @Transform(({ value }) => trimString(value))
    name!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    @Transform(({ value }) => trimString(value))
    priceLabel!: string;

    @IsInt()
    @Min(1)
    @Max(365)
    @IsOptional()
    durationDays?: number | null;
}

class SelectedServiceAddonDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    @Transform(({ value }) => trimString(value))
    id!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    @Transform(({ value }) => trimString(value))
    name!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(80)
    @Transform(({ value }) => trimString(value))
    priceLabel!: string;

    @IsInt()
    @Min(1)
    @Max(99)
    quantity!: number;

    @IsString()
    @MaxLength(40)
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    group?: string | null;
}

export class SelectedServicesDto {
    @ValidateNested()
    @Type(() => SelectedServicePlanDto)
    @IsOptional()
    plan?: SelectedServicePlanDto | null;

    @IsArray()
    @ArrayMaxSize(20)
    @ValidateNested({ each: true })
    @Type(() => SelectedServiceAddonDto)
    addons!: SelectedServiceAddonDto[];
}

export class CreatePublicConsultationInquiryDto {
    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => trimString(value))
    branchSlug!: string;

    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => trimString(value))
    motherName!: string;

    @IsString()
    @Matches(PHONE_REGEX, { message: "유효한 전화번호를 입력해주세요." })
    @Transform(({ value }) => trimString(value))
    phone!: string;

    @IsString()
    @IsNotEmpty()
    @Transform(({ value }) => trimString(value))
    address!: string;

    @IsDateString()
    @Matches(ISO_DATE_ONLY_REGEX, { message: "출산 예정일은 YYYY-MM-DD 형식이어야 합니다." })
    dueDate!: string;

    @IsString()
    @IsNotEmpty()
    birthExperience!: string;

    @IsString()
    @IsOptional()
    @IsIn(CONSULTATION_VOUCHER_TYPES)
    @Transform(({ value }) => normalizeVoucherTypeValue(value))
    voucherType?: string | null;

    @IsString()
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    preferredCaregiverName?: string;

    @IsString()
    @IsNotEmpty()
    referralSource!: string;

    @IsBoolean()
    privacyAccepted!: boolean;

    @ValidateNested()
    @Type(() => SelectedServicesDto)
    @IsOptional()
    selectedServices?: SelectedServicesDto;

    @IsString()
    @MaxLength(1000)
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    additionalNotes?: string | null;
}

export class ConsultationInquiryListQueryDto {
    @IsInt()
    @Min(1)
    @IsOptional()
    @Transform(({ value }) => Number(value))
    page?: number;

    @IsInt()
    @Min(1)
    @Max(100)
    @IsOptional()
    @Transform(({ value }) => Number(value))
    limit?: number;

    @IsString()
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    search?: string;

    @IsString()
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    phone?: string;

    @IsString()
    @IsOptional()
    @IsIn(["all", ...CONSULTATION_INQUIRY_STATUSES])
    status?: string;

    @IsString()
    @IsOptional()
    @IsIn(["all", "read", "unread"])
    readState?: string;
}
