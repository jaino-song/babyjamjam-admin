import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
  Min,
} from "class-validator";

export class CreateDocumentDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    categoryId!: string;

    @IsArray()
    @IsString({ each: true })
    tags!: string[];

    @IsString()
    mimetype!: string;

    @IsNumber()
    @Min(0)
    filesize!: number;

    @IsString()
    storagepath!: string;

    @IsOptional()
    @IsString()
    storageurl?: string;

    @IsOptional()
    @IsString()
    branchid?: string;

    @IsString()
    uploadedby!: string;
}

export class UpdateDocumentDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    categoryId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];
}

/**
 * 문서 조회 필터 DTO (쿼리 파라미터)
 */
export class DocumentFilterDto {
    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsString()
    uploadedBy?: string;

    @IsOptional()
    @IsString()
    orgId?: string;
}

/**
 * 문서 응답 DTO
 */
export class DocumentResponseDto {
    @IsString()
    id!: string;

    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    description!: string | null;

    @IsString()
    categoryId!: string;

    @IsArray()
    @IsString({ each: true })
    tags!: string[];

    @IsString()
    mimeType!: string;

    @IsNumber()
    fileSize!: number;

    @IsString()
    storagePath!: string;

    @IsOptional()
    @IsString()
    storageUrl!: string | null;

    @IsOptional()
    @IsString()
    orgId!: string | null;

    @IsString()
    uploadedBy!: string;

    @IsDateString()
    createdAt!: Date;

    @IsDateString()
    updatedAt!: Date;
}

export class UploadDocumentDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    categoryId!: string;

    @IsOptional()
    tags?: string[] | string;

    @IsOptional()
    @IsString()
    branchid?: string;

    @IsOptional()
    @IsString()
    uploadedby?: string;
}
