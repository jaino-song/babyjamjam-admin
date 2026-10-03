import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class GetHolidaysQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(2000)
    @Max(2100)
    year?: number;
}

export class CreateHolidayOverrideDto {
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    @IsISO8601({ strict: true })
    date!: string;

    @IsIn(["add", "exclude"])
    kind!: "add" | "exclude";

    @IsOptional()
    @IsString()
    @MaxLength(50)
    name?: string;
}
