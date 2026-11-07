import { Type } from "class-transformer";
import {
    IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString,
    IsUUID, Max, MaxLength, Min, ValidateNested,
} from "class-validator";

export class EformsignBackupDocumentsQueryDto {
    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    cursor?: number;

    @Type(() => Number) @IsInt() @Min(1) @Max(200)
    limit = 200;
}
export class EformsignBackupRunsQueryDto {
    @Type(() => Number) @IsInt() @Min(1) @Max(100)
    limit = 60;
}
// Required properties are populated and validated by Nest's global validation pipe.
export class EformsignBackupFileParamsDto {
    @IsUUID()
    fileId!: string;
}
export class EformsignBackupFailureDto {
    @IsString()
    docId!: string;

    @IsString() @MaxLength(500)
    reason!: string;
}
export class EformsignBackupCreateRunDto {
    @IsDateString()
    startedAt!: string;

    @IsDateString()
    finishedAt!: string;

    @IsIn(["success", "partial", "failed"])
    status!: "success" | "partial" | "failed";

    @IsBoolean()
    limited!: boolean;

    @IsInt() @Min(0)
    totalDocs!: number;

    @IsInt() @Min(0)
    savedFiles!: number;

    @IsInt() @Min(0)
    skippedFiles!: number;

    @IsInt() @Min(0)
    failedFiles!: number;

    @IsIn(["ok", "failed", "skipped"])
    driveStatus!: "ok" | "failed" | "skipped";

    @IsArray() @ValidateNested({ each: true }) @Type(() => EformsignBackupFailureDto)
    failures!: EformsignBackupFailureDto[];
}
