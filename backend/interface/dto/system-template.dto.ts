import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

export class UpdateSystemTemplateDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
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
