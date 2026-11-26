import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsInt, Min, IsString, IsUUID, Matches, Max, ValidateIf, ValidateNested } from "class-validator";
import type {
    AdminServiceRecordCaseSummary,
    ServiceRecordEditServiceDays,
    ServiceRecordScheduleProjection,
} from "@babyjamjam/shared/types/service-record";

const RECIPIENT_PHONE_PATTERN = /^01[016789]-?\d{3,4}-?\d{4}$/;

const MAX_LINK_MEMBERS = 32;
const LINK_TOKEN = /^efl_[A-Za-z0-9_-]{40,64}$/;

class ScopedAdminRecordLinkDto {
    @ValidateIf((_object, value) => value !== undefined)
    @IsInt()
    @Min(1)
    @Max(32767)
    employeeId?: number;
}

class AdminRecordLinkMemberDto {
    @IsUUID()
    caseId!: string;

    @IsInt()
    @Min(1)
    @Max(2147483647)
    assignmentVersion!: number;
}

class AdminPreparedRecordLinkMemberDto extends AdminRecordLinkMemberDto {
    @IsString()
    @Matches(LINK_TOKEN)
    preparedLinkToken!: string;
}

export class PrepareAdminServiceRecordLinkDto extends ScopedAdminRecordLinkDto {
    @ValidateIf((_object, value) => value !== undefined)
    @IsUUID()
    caseId?: string;

    @ValidateIf((_object, value) => value !== undefined)
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_LINK_MEMBERS)
    @ArrayUnique((value: unknown) => typeof value === "string" ? value.toLowerCase() : value)
    @IsUUID(undefined, { each: true })
    caseIds?: string[];

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(RECIPIENT_PHONE_PATTERN)
    recipientPhone?: string;
}

export class SendAdminServiceRecordLinkDto extends ScopedAdminRecordLinkDto {
    @ValidateIf((_object, value) => value !== undefined)
    @IsUUID()
    caseId?: string;

    @ValidateIf((_object, value) => value !== undefined)
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_LINK_MEMBERS)
    @ArrayUnique((value: AdminPreparedRecordLinkMemberDto | null) => typeof value?.caseId === "string" ? value.caseId.toLowerCase() : value)
    @ValidateNested({ each: true })
    @Type(() => AdminPreparedRecordLinkMemberDto)
    members?: AdminPreparedRecordLinkMemberDto[];

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(LINK_TOKEN)
    preparedLinkToken?: string;

    @ValidateIf((_object, value) => value !== undefined)
    @IsString()
    @Matches(RECIPIENT_PHONE_PATTERN)
    recipientPhone?: string;
}

export class ResetAdminServiceRecordLinkDto extends ScopedAdminRecordLinkDto {
    @ValidateIf((_object, value) => value !== undefined)
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_LINK_MEMBERS)
    @ArrayUnique((value: AdminRecordLinkMemberDto | null) => typeof value?.caseId === "string" ? value.caseId.toLowerCase() : value)
    @ValidateNested({ each: true })
    @Type(() => AdminRecordLinkMemberDto)
    members?: AdminRecordLinkMemberDto[];
}

export interface AdminServiceRecordPreparedLinkDto {
    kind: "legacy";
    serviceRecordUrl: string;
    preparedLinkToken: string;
    expiresAt: Date;
}

export interface AdminServiceRecordResetLinkDto {
    kind: "legacy";
    serviceRecordUrl: string;
    expiresAt: Date;
}

export type AdminServiceRecordLinkStatus = "none" | "scheduled" | "sending" | "sent" | "failed" | "canceled";
export type AdminServiceRecordTokenState = "active" | "expired" | "revoked" | null;

export interface AdminServiceRecordTokenDto {
    issuedAt: Date;
    verifiedAt: Date | null;
    expiresAt: Date;
    state: AdminServiceRecordTokenState;
}

export interface AdminServiceRecordLinkDto {
    status: AdminServiceRecordLinkStatus;
    scheduledFor: Date | null;
    sentCount: number;
    lastSentAt: Date | null;
    token: AdminServiceRecordTokenDto | null;
}

export interface AdminServiceRecordEmployeeDto {
    id: number;
    name: string;
    phone: string;
}

export interface AdminServiceRecordHeaderDto {
    momName: string | null;
    momBirth: string | null;
    babyName: string | null;
    babyBirth: string | null;
    deliveryType: string | null;
    babyWeight: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export class KeepServiceRecordPeriodMismatchDto {
    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsInt({ each: true })
    @Min(1, { each: true })
    sessionIndexes!: number[];
}

export class FitServiceRecordPeriodMismatchDto {}

export class AdoptLegacyServiceRecordCaseDto {
    @IsUUID()
    babyId!: string;
}

export interface AdminServiceRecordSessionDto {
    periodMismatchKeptAt: string | null;
    sessionIndex: number;
    serviceDate: Date;
    locked: boolean;
    submittedAt: Date | null;
    updatedAt: Date;
    answers: Prisma.JsonValue;
    etcService: string | null;
    notes: string | null;
    paymentConfirmed: boolean;
    hasMomApproval: boolean;
    clientSignature?: string | null;
    clientSignedAt?: Date | null;
    employeeId: number | null;
    employeeName: string | null;
    formVersion: number;
}

export interface AdminServiceRecordSignatureDocDto {
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepName: string;
    createdDate: Date;
    updatedDate: Date;
    snapshotVersion: number | null;
    snapshotChunkIndex: number | null;
    employeeScheduleId: number | null;
}

export interface AdminServiceRecordCaseDto {
    id: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    totalSessions: number;
    completedAt: Date | null;
    finalizationDueAt: Date | null;
    finalizedAt: Date | null;
    documentsCompletedAt: Date | null;
    lastError: string | null;
    header: AdminServiceRecordHeaderDto | null;
    sessions: AdminServiceRecordSessionDto[];
    signatureDocs: AdminServiceRecordSignatureDocDto[];
}

export interface AdminServiceRecordAssignmentDto {
    scheduleId: number;
    startDate: Date;
    endDate: Date;
    replaced: boolean;
    employee: AdminServiceRecordEmployeeDto;
    link: AdminServiceRecordLinkDto;
    header: AdminServiceRecordHeaderDto | null;
    totalSessions: number;
    sessions: AdminServiceRecordSessionDto[];
    signatureDoc: AdminServiceRecordSignatureDocDto | null;
}

export interface AdminServiceRecordOverviewDto {
    legacyLinkAssignment?: { scheduleId: number; employeeId: number } | null;
    cases?: AdminServiceRecordCaseSummary[];
    record: AdminServiceRecordCaseDto | null;
    assignments: AdminServiceRecordAssignmentDto[];
    /** Editor-only latest confirmation for each session reported by the revision changes policy. */
    adminEditConfirmedAtBySession?: { sessionIndex: number; confirmedAt: string }[];
    /** Canonical all-session projection used by the administrator date editor. */
    scheduleProjection?: ServiceRecordScheduleProjection;
    /** The client's service-day toggles, which the projection and session counts above already follow. */
    serviceDays?: ServiceRecordEditServiceDays;
}
