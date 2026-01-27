import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { DocumentEntity } from "domain/entities/document.entity";
import { IDocumentRepository, DOCUMENT_REPOSITORY } from "domain/repositories/document.repository.interface";

@Injectable()
export class DocumentService {
    constructor(
        @Inject(DOCUMENT_REPOSITORY)
        private readonly documentRepository: IDocumentRepository,
    ) {}

    /**
     * Create a new document
     */
    async create(params: {
        name: string;
        description?: string;
        category: string;
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
            category: params.category,
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

    /**
     * Find a document by ID
     */
    async findById(id: string): Promise<DocumentEntity> {
        const doc = await this.documentRepository.findById(id);
        if (!doc) {
            throw new NotFoundException(`Document with id ${id} not found`);
        }
        return doc;
    }

    /**
     * Find documents by organization ID
     */
    async findByOrgId(orgid: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByOrgId(orgid);
    }

    /**
     * Find documents by category
     */
    async findByCategory(category: string): Promise<DocumentEntity[]> {
        return this.documentRepository.findByCategory(category);
    }

    /**
     * List all documents
     */
    async findAll(): Promise<DocumentEntity[]> {
        return this.documentRepository.findAll();
    }

    /**
     * Update a document
     */
    async update(
        id: string,
        params: {
            name?: string;
            description?: string;
            category?: string;
            tags?: string[];
            mimetype?: string;
            filesize?: number;
            storagepath?: string;
            storageurl?: string;
            orgid?: string;
            uploadedby?: string;
        },
    ): Promise<DocumentEntity> {
        const existing = await this.findById(id);

        const updated = DocumentEntity.reconstitute({
            id: existing.id,
            name: params.name ?? existing.name,
            description: params.description ?? existing.description,
            category: params.category ?? existing.category,
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

    /**
     * Delete a document
     */
    async delete(id: string): Promise<void> {
        await this.findById(id); // Ensure it exists
        await this.documentRepository.delete(id);
    }
}
