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

    async create(organizationid: string, params: {
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
        return this.documentRepository.create(organizationid, doc);
    }

    /**
     * Find a document by ID
     */
    async findById(organizationid: string, id: string): Promise<DocumentEntity> {
        const doc = await this.documentRepository.findById(organizationid, id);
        if (!doc) {
            throw new NotFoundException(`Document with id ${id} not found`);
        }
        return doc;
    }

    /**
     * Find documents by organization ID
     */
    async findByOrgId(organizationid: string, orgid: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByOrgId(organizationid, orgid);
    }

    async findByCategoryId(organizationid: string, categoryId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategoryId(organizationid, categoryId);
    }

    /**
     * List all documents
     */
    async findAll(organizationid: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll(organizationid);
    }

    async update(
        organizationid: string,
        id: string,
        updates: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(organizationid, id);

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

        return this.documentRepository.update(organizationid, updated);
    }

    /**
     * Delete a document
     */
    async delete(organizationid: string, id: string): Promise<void> {
        await this.findById(organizationid, id); // Ensure it exists
        await this.documentRepository.delete(organizationid, id);
    }
}
