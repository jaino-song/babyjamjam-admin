import { IsNotEmpty, IsString } from "class-validator";

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
}

export class PendingStaffCompletionItemDto {
    documentId!: string;
    clientId!: number;
    clientName!: string;
    signedAt!: string;
    statusDetail!: string;
}
