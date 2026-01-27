import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";
import { IFileStoragePort, FILE_STORAGE_PORT } from "domain/ports/file-storage.port";

export type UploadDocumentParams = {
    file: Buffer;
    filename: string;
    mimetype: string;
    filesize: number;
    category: string;
    tags: string[];
    description?: string;
    orgId?: string;
    uploadedBy: string;
};

@Injectable()
export class UploadDocumentUsecase {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
        @Inject(FILE_STORAGE_PORT)
        private readonly fileStorage: IFileStoragePort,
    ) {}

    async execute(params: UploadDocumentParams): Promise<DocumentEntity> {
        if (!DocumentEntity.validateFileSize(params.filesize)) {
            throw new BadRequestException("파일 크기가 25MB를 초과했습니다.");
        }

        if (!DocumentEntity.validateMimeType(params.mimetype)) {
            throw new BadRequestException(`허용되지 않은 파일 형식: ${params.mimetype}`);
        }

        if (!DocumentEntity.validateCategory(params.category)) {
            throw new BadRequestException(`유효하지 않은 카테고리: ${params.category}`);
        }

        const storagePath = `documents/${Date.now()}-${randomUUID()}-${params.filename}`;

        await this.fileStorage.upload(params.file, storagePath, params.mimetype);

        const document = DocumentEntity.create({
            name: params.filename,
            description: params.description,
            category: params.category as any,
            tags: params.tags,
            mimeType: params.mimetype as any,
            fileSize: params.filesize,
            storagePath,
            storageUrl: null,
            orgId: params.orgId ?? null,
            uploadedBy: params.uploadedBy,
        });

        return this.documentRepository.create(document);
    }
}
