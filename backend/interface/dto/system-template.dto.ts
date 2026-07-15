import { IsString, IsNotEmpty, IsObject, IsOptional, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class CustomVariableDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsBoolean()
  required!: boolean;
}

export class UpdateSystemTemplateDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomVariableDto)
  customVariables?: CustomVariableDto[];
}

export class ValidateTemplateDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class PreviewTemplateDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsObject()
  @IsNotEmpty()
  data!: Record<string, unknown>;
}
