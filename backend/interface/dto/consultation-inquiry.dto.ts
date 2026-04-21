import { Transform } from "class-transformer";
import {
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
} from "class-validator";

import { CONSULTATION_INQUIRY_STATUSES } from "domain/entities/consultation-inquiry.entity";

const PHONE_REGEX = /^01[016789]-?\d{3,4}-?\d{4}$/;

function trimString(value: unknown): unknown {
    return typeof value === "string" ? value.trim() : value;
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
    @IsIn(["all", ...CONSULTATION_INQUIRY_STATUSES])
    status?: string;
}
