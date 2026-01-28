import { Injectable } from "@nestjs/common";
import {
    UploadDocumentUsecase,
    UploadDocumentParams,
    GetDocumentsUsecase,
    GetDocumentUsecase,
    UpdateDocumentUsecase,
    DeleteDocumentUsecase,
} from "application/usecases/document";
import { DocumentEntity } from "domain/entities/document.entity";
import { DocumentFilter } from "domain/repositories/document.repository.interface";

@Injectable()
export class DocumentService {
    constructor(
        private readonly uploadDocumentUsecase: UploadDocumentUsecase,
        private readonly getDocumentsUsecase: GetDocumentsUsecase,
        private readonly getDocumentUsecase: GetDocumentUsecase,
        private readonly updateDocumentUsecase: UpdateDocumentUsecase,
        private readonly deleteDocumentUsecase: DeleteDocumentUsecase,
    ) {}

    async create(params: {
        name: string;
        description?: string;
        categoryId: string;
        tags: string[];
        mimetype: string;
        filesize: number;
        storagepath: string;
        storageurl?: string;
        orgid?: string;
        uploadedby: string;
    }): Promise<DocumentEntity> {
        const doc = DocumentEntity.create({
            name: params.name,
            description: params.description,
            categoryId: params.categoryId,
            tags: params.tags,
            mimetype: params.mimetype,
            filesize: params.filesize,
            storagepath: params.storagepath,
            storageurl: params.storageurl,
            orgid: params.orgid,
            uploadedby: params.uploadedby,
            createdat: new Date(),
        });
        return this.documentRepository.create(doc);
    }

    list(filter?: DocumentFilter): Promise<DocumentEntity[]> {
        return this.getDocumentsUsecase.execute({ filter });
    }

    findById(id: string): Promise<DocumentEntity> {
        return this.getDocumentUsecase.execute({ id });
    }

    async findByCategoryId(categoryId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategoryId(categoryId);
    }

    /**
     * List all documents
     */
    async findAll(): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll();
    }

    async update(
        id: string,
        updates: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(id);

        const updated = DocumentEntity.reconstitute({
            id: existing.id,
            name: params.name ?? existing.name,
            description: params.description ?? existing.description,
            categoryId: params.categoryId ?? existing.categoryId,
            tags: params.tags ?? existing.tags,
            mimetype: params.mimetype ?? existing.mimetype,
            filesize: params.filesize ?? existing.filesize,
            storagepath: params.storagepath ?? existing.storagepath,
            storageurl: params.storageurl ?? existing.storageurl,
            orgid: params.orgid ?? existing.orgid,
            uploadedby: params.uploadedby ?? existing.uploadedby,
            createdat: existing.createdat,
            updatedat: new Date(),
        });

        return this.documentRepository.update(updated);
    }

    delete(id: string): Promise<void> {
        return this.deleteDocumentUsecase.execute({ id });
    }
}
