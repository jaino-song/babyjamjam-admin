import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class GenerateStaffDocumentRequestDto {
    @IsString()
    @IsNotEmpty()
    documentId!: string;

    @IsString()
    @IsNotEmpty()
    accessToken!: string;

    @IsString()
    @IsNotEmpty()
    refreshToken!: string;

    @IsOptional()
    @IsString()
    prefillEndDate?: string;
}
