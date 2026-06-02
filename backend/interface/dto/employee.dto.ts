import { Transform } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString } from "class-validator";
import { EMPLOYEE_GRADES, normalizeEmployeeGrade } from "domain/constants/employee-grade.constants";

export class CreateEmployeeDto {
    @IsString()
    name!: string;

    @IsArray()
    @IsString({ each: true })
    workArea!: string[];

    @IsString()
    phone!: string;

    @IsString()
    @Transform(({ value }) => typeof value === "string" ? normalizeEmployeeGrade(value) : value)
    @IsIn(EMPLOYEE_GRADES)
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
    @Transform(({ value }) => typeof value === "string" ? normalizeEmployeeGrade(value) : value)
    @IsIn(EMPLOYEE_GRADES)
    grade?: string;

    @IsOptional()
    @IsBoolean()
    openToNextWork?: boolean;
}

export class ChangeEmployeeOpenStatusDto {
    @IsBoolean()
    openToNextWork!: boolean;
}

export class EmployeesByRegisteredDateDto {
    @IsDateString()
    date!: string;
}

export class EmployeesByRegisteredRangeDto {
    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;
}
