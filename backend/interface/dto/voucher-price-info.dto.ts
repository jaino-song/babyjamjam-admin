import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateVoucherPriceInfoDto {
    @IsString()
    type!: string;

    @IsNumberString()
    duration!: string;

    @IsString()
    fullPrice!: string;

    @IsString()
    grant!: string;

    @IsString()
    actualPrice!: string;

    @IsNumber()
    year!: number;
}

export class UpdateVoucherPriceInfoDto {
    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsNumberString()
    duration?: string | null;

    @IsOptional()
    @IsString()
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    grant?: string | null;

    @IsOptional()
    @IsString()
    actualPrice?: string | null;

    @IsOptional()
    @IsNumber()
    year?: number | null;
}

// 파싱된 바우처 가격 항목 DTO
export class ParsedVoucherPriceItemDto {
  @IsString()
  type!: string;

  @IsNumber()
  duration!: number;

  @IsString()
  fullPrice!: string;

  @IsString()
  grant!: string;

  @IsString()
  actualPrice!: string;

  @IsOptional()
  @IsNumber()
  year?: number;
}

// Bulk Update 요청 DTO
export class BulkUpdateVoucherPriceInfoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedVoucherPriceItemDto)
  items!: ParsedVoucherPriceItemDto[];

  @IsNumber()
  year!: number;
}

// 이미지 파싱 응답 DTO
export class ParseImageResponseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedVoucherPriceItemDto)
  parsedData!: ParsedVoucherPriceItemDto[];

  @IsBoolean()
  hasValidationWarnings!: boolean;

  @IsArray()
  @IsString({ each: true })
  warnings!: string[];
}

// Bulk Update 결과 DTO
export class BulkUpdateResultDto {
  @IsArray()
  @IsNumber({}, { each: true })
  updated!: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  created!: number[];

  @IsArray()
  @IsString({ each: true })
  errors!: string[];
}

