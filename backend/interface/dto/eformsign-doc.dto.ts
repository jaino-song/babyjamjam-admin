import { IsNumber, IsOptional, IsString, IsDateString, IsBoolean } from "class-validator";

/**
 * DTO for getting access token
 */
export class GetAccessTokenDto {
    @IsNumber()
    executionTime!: number;

    @IsOptional()
    @IsString()
    memberEmail?: string;
}

/**
 * DTO for refreshing access token
 */
export class RefreshAccessTokenDto {
    @IsNumber()
    executionTime!: number;

    @IsString()
    refreshToken!: string;
}

/**
 * DTO for fetching documents from API
 */
export class FetchDocumentsDto {
    @IsString()
    accessToken!: string;
}

/**
 * DTO for fetching a single document from API
 */
export class FetchDocumentByIdDto {
    @IsString()
    accessToken!: string;

    @IsString()
    documentId!: string;
}

/**
 * DTO for creating a new eformsign doc record in local DB
 */
export class CreateEformsignDocLocalDto {
    @IsString()
    documentId!: string;

    @IsNumber()
    clientId!: number;

    @IsString()
    statusType!: string;

    @IsString()
    statusDetail!: string;

    @IsString()
    stepType!: string;

    @IsString()
    stepIndex!: string;

    @IsString()
    stepName!: string;

    @IsString()
    stepRecipientType!: string;

    @IsString()
    stepRecipientName!: string;

    @IsString()
    stepRecipientSms!: string;

    @IsDateString()
    expiredDate!: string; // ISO date string

    @IsOptional()
    @IsBoolean()
    linkToClient?: boolean; // If true, also update client.e_doc_id
}

