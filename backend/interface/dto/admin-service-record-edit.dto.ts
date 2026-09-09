import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Min,
    MinLength,
    MaxLength,
    ValidateNested,
} from "class-validator";

import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";
import type { ServiceRecordEditDraft } from "domain/repositories/service-record-edit.repository.interface";

/**
 * Header values the administrator editor is allowed to draft. Identity,
 * lifecycle, signature, and server provenance fields intentionally do not
 * appear in this DTO; they are read from the case by the application service.
 */
export class ServiceRecordEditHeaderChangesDto {
    @IsOptional() @IsString() momName?: string;
    @IsOptional() @IsString() momBirth?: string;
    @IsOptional() @IsString() babyName?: string;
    @IsOptional() @IsString() babyBirth?: string;
    @IsOptional() @IsString() deliveryType?: string;
    @IsOptional() @IsString() babyWeight?: string;
}

/**
 * A session patch is addressed by its existing 1-based case index. The index
 * is a locator, not a mutable assignment identifier. Assignment, employee,
 * submitted/signature, and approval fields are deliberately absent.
 */
export class ServiceRecordEditSessionChangesDto {
    @IsInt()
    @Min(1)
    sessionIndex!: number;

    /** Date-only input; timestamps would blur the business-date boundary. */
    @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) serviceDate?: string;
    @IsOptional() @IsObject() answers?: Record<string, unknown>;
    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.etcService)
    etcService?: string;
    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.notes)
    notes?: string;
    @IsOptional() @IsBoolean() paymentConfirmed?: boolean;
}

/** The complete mutable portion of a draft. */
export class ServiceRecordEditChangesDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => ServiceRecordEditHeaderChangesDto)
    header?: ServiceRecordEditHeaderChangesDto;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => ServiceRecordEditSessionChangesDto)
    sessions?: ServiceRecordEditSessionChangesDto[];
}

/** Body used when an application service starts or resumes a draft. */
export class CreateServiceRecordEditDraftDto {
    @IsOptional()
    @ValidateNested()
    @Type(() => ServiceRecordEditChangesDto)
    changes?: ServiceRecordEditChangesDto;
}

/** Body used for compare-and-swap draft saves. */
export class ServiceRecordEditDateMoveDto {
    @IsInt()
    @Min(1)
    sessionIndex!: number;

    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    toDate!: string;
}

export class UpdateServiceRecordEditDraftDto {
    @IsInt()
    @Min(1)
    expectedDraftVersion!: number;

    @ValidateNested()
    @Type(() => ServiceRecordEditChangesDto)
    changes!: ServiceRecordEditChangesDto;

    /** A single server-normalized suffix move; never inferred from snapshots. */
    @IsOptional()
    @ValidateNested()
    @Type(() => ServiceRecordEditDateMoveDto)
    dateMove?: ServiceRecordEditDateMoveDto;
}

/** Body used for a read-only authoritative preview. */
export class PreviewServiceRecordEditDraftDto {
    @IsInt()
    @Min(1)
    expectedDraftVersion!: number;
}

/** Body used for the one-shot atomic draft confirmation. */
export class ConfirmServiceRecordEditDraftDto {
    @IsInt()
    @Min(1)
    expectedDraftVersion!: number;

    @IsString()
    @MaxLength(100)
    @Matches(/^srp_[0-9a-f]{64}$/i)
    previewId!: string;

    @IsString()
    @IsUUID()
    idempotencyKey!: string;
}

/** Body used for compare-and-swap draft discard. */
export class DiscardServiceRecordEditDraftDto {
    @IsInt()
    @Min(1)
    expectedDraftVersion!: number;
}

/** Stable response envelope shared by start/read/save/discard routes. */
export interface AdminServiceRecordEditStateDto {
    draft: ServiceRecordEditDraft | null;
    sourceChanged: boolean;
    sourceCaseVersion: number;
    sourceFingerprint: string;
}

export type {
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionDocumentSummary,
    ServiceRecordRevisionHistoryResponse,
} from "@babyjamjam/shared/types/service-record";

/** Exact retry body. Branch and actor authority are always server-derived. */
export class RetryServiceRecordDocumentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    @Matches(/\S/)
    expectedGeneration!: string;
}

// Explicit aliases make the adapter naming clear without introducing a second
// validation shape for administrator routes.
export {
    ServiceRecordEditChangesDto as AdminServiceRecordEditChangesDto,
    ServiceRecordEditHeaderChangesDto as AdminServiceRecordEditHeaderChangesDto,
    ServiceRecordEditSessionChangesDto as AdminServiceRecordEditSessionChangesDto,
};
