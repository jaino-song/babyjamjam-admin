import { IsArray, IsBoolean, IsDateString, IsOptional, IsString } from "class-validator";

export class CreateEmployeeDto {
    @IsString()
    name!: string;

    @IsArray()
    @IsString({ each: true })
    workArea!: string[];

    @IsString()
    phone!: string;

    @IsString()
    grade!: string;

    @IsBoolean()
    openToNextWork!: boolean;

    @IsOptional()
    @IsDateString()
    registeredDate?: string;
}

export class UpdateEmployeeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    workArea?: string[];

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    grade?: string;

    @IsOptional()
    @IsBoolean()
    openToNextWork?: boolean;
}

export class ChangeEmployeeOpenStatusDto {
    @IsBoolean()
    openToNextWork!: boolean;
}

export class EmployeesByRegisteredRangeDto {
    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}

