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

function trimString(value: unknown): unknown {
    return typeof value === "string" ? value.trim() : value;
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
    dueDate!: string;

    @IsString()
    @IsNotEmpty()
    birthExperience!: string;

    @IsString()
    @IsOptional()
    @Transform(({ value }) => trimString(value))
    voucherType?: string;

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
