import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

@Injectable()
export class DocumentService {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    async create(branchId: string, params: {
        name: string;
        description?: string;
        categoryId: string;
        tags: string[];
        mimetype: string;
        filesize: number;
        storagepath: string;
        storageurl?: string;
        branchid?: string;
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
            orgId: params.branchid,
            uploadedBy: params.uploadedby,
        });
        return this.documentRepository.create(branchId, doc);
    }

    /**
     * Find a document by ID
     */
    async findById(branchId: string, id: string): Promise<DocumentEntity> {
        const doc = await this.documentRepository.findById(branchId, id);
        if (!doc) {
            throw new NotFoundException(`Document with id ${id} not found`);
        }
        return doc;
    }

    /**
     * Find documents by branch ID
     */
    async findByOrgId(branchId: string, orgId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByOrgId(branchId, orgId);
    }

    async findByCategoryId(branchId: string, categoryId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategoryId(branchId, categoryId);
    }

    /**
     * List all documents
     */
    async findAll(branchId: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll(branchId);
    }

    async update(
        branchId: string,
        id: string,
        updates: {
            name?: string;
            description?: string;
            categoryId?: string;
            tags?: string[];
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(branchId, id);

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

        return this.documentRepository.update(branchId, updated);
    }

    /**
     * Delete a document
     */
    async delete(branchId: string, id: string): Promise<void> {
        await this.findById(branchId, id); // Ensure it exists
        await this.documentRepository.delete(branchId, id);
    }
}
