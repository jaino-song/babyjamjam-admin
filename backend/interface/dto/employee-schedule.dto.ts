import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from "class-validator";

export class CreateEmployeeScheduleDto {
    @IsInt()
    clientId!: number;

    @IsInt()
    primaryEmployeeId!: number;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsString()
    workAddress!: string;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;

    @IsOptional()
    @IsBoolean()
    replaced?: boolean;
}

export class UpdateEmployeeScheduleDto {
    @IsOptional()
    @IsString()
    workAddress?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsBoolean()
    replaced?: boolean;
}
