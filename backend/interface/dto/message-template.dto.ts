import { IsString, IsArray, IsBoolean, ValidateNested, IsOptional, IsEnum, IsNumber, Matches } from "class-validator";
import { Type } from "class-transformer";
import { MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES } from "domain/entities/message-template.entity";

export class TemplateVariableDto {
    @IsString()
    key!: string;

    @IsEnum(["text", "phone", "select", "date", "number", "textarea"])
    type!: "text" | "phone" | "select" | "date" | "number" | "textarea";

    @IsString()
    label!: string;

    @IsString()
    @IsOptional()
    placeholder?: string;

    @IsBoolean()
    required!: boolean;

    @IsOptional()
    @IsEnum(["custom", "dataSource"])
    optionType?: "custom" | "dataSource";

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    options?: string[];

    @IsOptional()
    @IsString()
    dataSource?: string;

    @IsOptional()
    @IsString()
    fallback?: string;

    @IsOptional()
    @IsNumber()
    min?: number;

    @IsOptional()
    @IsNumber()
    max?: number;
}

export class CreateMessageTemplateDto {
    @IsString()
    @Matches(/\S/, { message: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.name })
    name!: string;

    @IsString()
    @Matches(/\S/, { message: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.content })
    content!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateVariableDto)
    variables!: TemplateVariableDto[];
}

export class UpdateMessageTemplateDto {
    @IsString()
    @IsOptional()
    @Matches(/\S/, { message: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.name })
    name?: string;

    @IsString()
    @IsOptional()
    @Matches(/\S/, { message: MESSAGE_TEMPLATE_REQUIRED_FIELD_MESSAGES.content })
    content?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TemplateVariableDto)
    @IsOptional()
    variables?: TemplateVariableDto[];
}
