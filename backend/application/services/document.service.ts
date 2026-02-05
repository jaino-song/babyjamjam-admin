import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

@Injectable()
export class DocumentService {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    async create(organizationId: string, params: {
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
            mimeType: params.mimetype,
            fileSize: params.filesize,
            storagePath: params.storagepath,
            storageUrl: params.storageurl,
            orgId: params.orgid,
            uploadedBy: params.uploadedby,
        });
        return this.documentRepository.create(organizationId, doc);
    }

    /**
     * Find a document by ID
     */
    async findById(organizationId: string, id: string): Promise<DocumentEntity> {
        const doc = await this.documentRepository.findById(organizationId, id);
        if (!doc) {
            throw new NotFoundException(`Document with id ${id} not found`);
        }
        return doc;
    }

    /**
     * Find documents by organization ID
     */
    async findByOrgId(organizationId: string, orgId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByOrgId(organizationId, orgId);
    }

    async findByCategoryId(organizationId: string, categoryId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategoryId(organizationId, categoryId);
    }

    /**
     * List all documents
     */
    async findAll(organizationId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll(organizationId);
    }

    async update(
        organizationId: string,
        id: string,
        updates: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(organizationId, id);

        const updated = DocumentEntity.reconstitute(
            existing.id,
            updates.name ?? existing.name,
            updates.description ?? existing.description,
            updates.categoryId ?? existing.categoryId,
            updates.tags ?? existing.tags,
            existing.mimeType,
            existing.fileSize,
            existing.storagePath,
            existing.storageUrl,
            existing.orgId,
            existing.uploadedBy,
            existing.createdAt,
            new Date(),
        );

        return this.documentRepository.update(organizationId, updated);
    }

    /**
     * Delete a document
     */
    async delete(organizationId: string, id: string): Promise<void> {
        await this.findById(organizationId, id); // Ensure it exists
        await this.documentRepository.delete(organizationId, id);
    }
}
