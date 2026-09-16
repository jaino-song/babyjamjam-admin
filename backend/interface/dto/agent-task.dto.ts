import { IsArray, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ArrayMaxSize } from "class-validator";

/**
 * Task payload DTOs intentionally keep operations opaque at the transport
 * boundary. The shared Zod contracts remain the authoritative validator for
 * operation names, fields, and values inside AgentTaskService.
 */
export class AgentTaskCreateDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    schemaVersion?: number;

    @IsString()
    @MaxLength(200)
    sessionId!: string;

    @IsString()
    @MaxLength(100)
    capabilityId!: string;

    @IsString()
    @MaxLength(200)
    clientEventId!: string;

    @IsArray()
    @ArrayMaxSize(100)
    @IsObject({ each: true })
    operations!: unknown[];
}

export class AgentTaskPatchDto {
    @IsString()
    @MaxLength(200)
    clientEventId!: string;

    @IsInt()
    @Min(0)
    expectedRevision!: number;

    @IsArray()
    @ArrayMaxSize(100)
    @IsObject({ each: true })
    operations!: unknown[];
}
