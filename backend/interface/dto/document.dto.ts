import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
} from "class-validator";

/**
 * 문서 생성 요청 DTO
 */
export class CreateDocumentDto {
  @IsString()
  category!: string;

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 문서 메타데이터 업데이트 요청 DTO
 */
export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

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
  category!: string;

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
