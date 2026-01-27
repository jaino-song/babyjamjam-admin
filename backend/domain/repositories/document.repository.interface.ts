import { DocumentEntity } from 'domain/entities/document.entity';

export interface DocumentFilter {
    category?: string;
    tags?: string[];
    uploadedBy?: string;
    orgId?: string;
}

export interface IDocumentRepository {
    findById(id: string): Promise<DocumentEntity | null>;
    findAll(filter?: DocumentFilter): Promise<DocumentEntity[]>;
    create(document: DocumentEntity): Promise<DocumentEntity>;
    update(document: DocumentEntity): Promise<DocumentEntity>;
    delete(id: string): Promise<void>;
}

export const DOCUMENT_REPOSITORY = 'DOCUMENT_REPOSITORY';
