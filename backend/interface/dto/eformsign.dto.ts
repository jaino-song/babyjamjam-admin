import { Type } from "class-transformer";
import {
    ArrayNotEmpty,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from "class-validator";

export class GenerateSignatureRequestDto {
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    executionTime!: number;
}

export class AccessTokenRequestDto extends GenerateSignatureRequestDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    memberEmail?: string;
}

export class RefreshTokenRequestDto extends GenerateSignatureRequestDto {
    @IsString()
    @IsNotEmpty()
    refreshToken!: string;
}

class ContractDataRequestDto {
    @IsString()
    @IsNotEmpty()
    customerName!: string;

    @IsString()
    @IsNotEmpty()
    customerContact!: string;

    @IsString()
    @IsNotEmpty()
    customerDOB!: string;

    @IsString()
    @IsNotEmpty()
    customerAddress!: string;

    @IsString()
    @IsNotEmpty()
    caretaker1Name!: string;

    @IsString()
    @IsNotEmpty()
    caretaker1Contact!: string;

    @IsString()
    @IsNotEmpty()
    type!: string;

    @IsString()
    @IsNotEmpty()
    days!: string;

    @IsString()
    @IsNotEmpty()
    area!: string;

    @IsString()
    @IsNotEmpty()
    contractDuration!: string;

    @IsString()
    @IsNotEmpty()
    startYear!: string;

    @IsString()
    @IsNotEmpty()
    startMonth!: string;

    @IsString()
    @IsNotEmpty()
    startDay!: string;

    @IsString()
    @IsNotEmpty()
    startDate!: string;

    @IsString()
    @IsNotEmpty()
    endYear!: string;

    @IsString()
    @IsNotEmpty()
    endMonth!: string;

    @IsString()
    @IsNotEmpty()
    endDay!: string;

    @IsString()
    @IsNotEmpty()
    endDate!: string;

    @IsString()
    @IsNotEmpty()
    paymentYear!: string;

    @IsString()
    @IsNotEmpty()
    paymentMonth!: string;

    @IsString()
    @IsNotEmpty()
    paymentDay!: string;

    @IsString()
    @IsNotEmpty()
    receiptYear!: string;

    @IsString()
    @IsNotEmpty()
    receiptMonth!: string;

    @IsString()
    @IsNotEmpty()
    receiptDay!: string;

    @IsString()
    @IsNotEmpty()
    fullPrice!: string;

    @IsString()
    @IsNotEmpty()
    grant!: string;

    @IsString()
    @IsNotEmpty()
    actualPrice!: string;

    @IsOptional()
    @IsString()
    issuerPhone?: string;
}

export class GenerateDocumentRequestDto {
    @ValidateNested()
    @Type(() => ContractDataRequestDto)
    contractData!: ContractDataRequestDto;

    @IsString()
    @IsNotEmpty()
    accessToken!: string;

    @IsString()
    @IsNotEmpty()
    refreshToken!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    clientId?: number;
}

export class DeleteDocumentsRequestDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    document_ids!: string[];
}

class RecipientPhoneDto {
    @IsString()
    @IsNotEmpty()
    countryCode!: string;

    @IsString()
    @IsNotEmpty()
    phoneNumber!: string;
}

export class ReRequestOutsiderDocumentRequestDto {
    @IsString()
    @IsNotEmpty()
    accessToken!: string;

    @IsString()
    @IsNotEmpty()
    stepType!: string;

    @IsString()
    @IsNotEmpty()
    stepSeq!: string;

    @IsOptional()
    @IsString()
    comment?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => RecipientPhoneDto)
    recipientPhone?: RecipientPhoneDto;
}
