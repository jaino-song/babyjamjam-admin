import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString } from "class-validator";
import { SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";

export class CreateClientDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsInt()
    primaryEmployeeId?: number | null;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

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
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean | null;

    @IsBoolean()
    voucherClient!: boolean;

    @IsOptional()
    @IsString()
    birthday?: string | null;

    @IsOptional()
    @IsDateString()
    dueDate?: string | null;

    @IsOptional()
    @IsIn(SERVICE_STATUS_VALUES)
    serviceStatus?: string | null;

    @IsBoolean()
    breastPump!: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;

    @IsOptional()
    @IsString()
    areaId?: string | null;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;
}

export class UpdateClientDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsInt()
    primaryEmployeeId?: number;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

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
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean | null;

    @IsOptional()
    @IsBoolean()
    voucherClient?: boolean;

    @IsOptional()
    @IsString()
    birthday?: string | null;

    @IsOptional()
    @IsDateString()
    dueDate?: string | null;

    @IsOptional()
    @IsIn(SERVICE_STATUS_VALUES)
    serviceStatus?: string | null;

    @IsOptional()
    @IsBoolean()
    breastPump?: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;

    @IsOptional()
    @IsString()
    areaId?: string | null;
}

/**
 * DTO for terminating a client's service
 */
export class TerminateServiceDto {
    @IsOptional()
    @IsString()
    reason?: string;
}

/**
 * DTO for requesting a provider replacement
 */
export class RequestReplacementDto {
    @IsInt()
    newPrimaryEmployeeId!: number;

    @IsOptional()
    @IsInt()
    newSecondaryEmployeeId?: number | null;
}
