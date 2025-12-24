import { IsNumber, IsOptional, IsString } from "class-validator";

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

