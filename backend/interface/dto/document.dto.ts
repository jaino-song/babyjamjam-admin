import { IsString, IsOptional, IsArray, IsNumber, Min } from "class-validator";

export class CreateDocumentDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    categoryId!: string;

    @IsArray()
    @IsString({ each: true })
    tags!: string[];

    @IsString()
    mimetype!: string;

    @IsNumber()
    @Min(0)
    filesize!: number;

    @IsString()
    storagepath!: string;

    @IsOptional()
    @IsString()
    storageurl?: string;

    @IsOptional()
    @IsString()
    orgid?: string;

    @IsString()
    uploadedby!: string;
}

export class UpdateDocumentDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    categoryId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsString()
    mimetype?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    filesize?: number;

    @IsOptional()
    @IsString()
    storagepath?: string;

    @IsOptional()
    @IsString()
    storageurl?: string;

    @IsOptional()
    @IsString()
    orgid?: string;

    @IsOptional()
    @IsString()
    uploadedby?: string;
}

export class UploadDocumentDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    categoryId!: string;

    @IsOptional()
    tags?: string[] | string;

    @IsOptional()
    @IsString()
    orgid?: string;

    @IsOptional()
    @IsString()
    uploadedby?: string;
}
