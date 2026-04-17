import { IsBoolean, IsDateString, IsOptional, IsString } from "class-validator";

export class SubmitDailyRecordEntryDto {
    @IsDateString()
    recordDate!: string; // ISO date string, e.g. "2026-04-17"

    @IsOptional()
    @IsString()
    content?: string | null;

    @IsOptional()
    @IsString()
    submittedBy?: string | null; // employee UUID (optional; can default to current user)
}

export class FinalizeServiceRecordDto {
    @IsOptional()
    @IsBoolean()
    force?: boolean; // if true, finalize even with missing dates
}

export class DailyRecordEntryResponseDto {
    id!: string;
    eformsignDocId!: number;
    recordDate!: string;
    content!: string | null;
    submittedBy!: string | null;
    submittedAt!: string;
    createdAt!: string;
}

export class ListDailyRecordEntriesResponseDto {
    entries!: DailyRecordEntryResponseDto[];
    missingDates!: string[]; // ISO YYYY-MM-DD
    collectionStartDate!: string | null;
    collectionEndDate!: string | null;
    collectionPeriodDays!: number | null;
}

export class FinalizeServiceRecordResponseDto {
    documentId!: string;
    statusType!: string;
    finalizedAt!: string | null;
    forced!: boolean;
    missingDates!: string[];
}
