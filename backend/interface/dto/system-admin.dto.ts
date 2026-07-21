import { Transform } from "class-transformer";
import {
    IsBoolean,
    IsEmail,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    MaxLength,
    MinLength,
} from "class-validator";

import { MessageSenderApprovalStatus } from "interface/dto/message-sender-approval.dto";

const trimString = ({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value;

export class CreateSystemAdminBranchDto {
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name!: string;

    @Transform(trimString)
    @IsString()
    @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    @MaxLength(100)
    slug!: string;

    @IsOptional()
    @IsUUID()
    ownerId?: string | null;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(100)
    region?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(100)
    district?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(255)
    address?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(30)
    phone?: string;

    @IsOptional()
    @Transform(trimString)
    @IsEmail()
    @MaxLength(255)
    email?: string;

    @IsBoolean()
    isActive!: boolean;
}

export class UpdateSystemAdminBranchDto {
    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    @MaxLength(100)
    slug?: string;

    @IsOptional()
    @IsUUID()
    ownerId?: string | null;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(100)
    region?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(100)
    district?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(255)
    address?: string;

    @IsOptional()
    @Transform(trimString)
    @IsString()
    @MaxLength(30)
    phone?: string;

    @IsOptional()
    @Transform(trimString)
    @IsEmail()
    @MaxLength(255)
    email?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export interface SystemAdminBranchUserDto {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
}

export interface SystemAdminBranchMessageSenderApprovalDto {
    approvalStatus: MessageSenderApprovalStatus;
    requestedAt: string | null;
    approvedAt: string | null;
    requestedBy: SystemAdminBranchUserDto | null;
}

export interface SystemAdminBranchRequestDto {
    id: string;
    name: string;
    slug: string;
    region: string | null;
    district: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    owner: SystemAdminBranchUserDto | null;
    messageSenderApproval: SystemAdminBranchMessageSenderApprovalDto;
}
