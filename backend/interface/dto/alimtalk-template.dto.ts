import { Transform, Type } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from "class-validator";

export class CreateAlimtalkTemplateButtonDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(14)
    name!: string;

    @IsEnum(["WL", "AL", "BK", "MD", "DS", "AC"])
    linkType!: "WL" | "AL" | "BK" | "MD" | "DS" | "AC";

    @IsOptional()
    @IsString()
    linkM?: string;

    @IsOptional()
    @IsString()
    linkP?: string;

    @IsOptional()
    @IsString()
    linkI?: string;

    @IsOptional()
    @IsString()
    linkA?: string;
}

export class CreateAlimtalkTemplateDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(30)
    name!: string;

    @IsEnum(["BA", "EX", "AD", "MI"])
    tplType!: "BA" | "EX" | "AD" | "MI";

    @IsEnum(["NONE", "TEXT", "IMAGE"])
    tplEmType!: "NONE" | "TEXT" | "IMAGE";

    @IsOptional()
    @IsString()
    @MaxLength(24)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(24)
    subtitle?: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    content!: string;

    @IsOptional()
    @IsString()
    @MaxLength(400)
    extra?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    advert?: string;

    @Transform(({ value }) => {
        if (typeof value !== "string") return value;

        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    })
    @IsArray()
    @ArrayMaxSize(5)
    @ValidateNested({ each: true })
    @Type(() => CreateAlimtalkTemplateButtonDto)
    buttons!: CreateAlimtalkTemplateButtonDto[];
}
