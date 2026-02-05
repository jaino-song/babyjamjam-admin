import { DocumentEntity } from 'domain/entities/document.entity';

export interface DocumentFilter {
    category?: string;
    tags?: string[];
    uploadedBy?: string;
    orgId?: string;
}

export interface IDocumentRepository {
    findById(organizationid: string, id: string): Promise<DocumentEntity | null>;
    findByOrgId(organizationid: string, orgid: string): Promise<DocumentEntity[]>;
    findByCategoryId(organizationid: string, categoryId: string): Promise<DocumentEntity[]>;
    findAll(organizationid: string): Promise<DocumentEntity[]>;
    create(organizationid: string, doc: DocumentEntity): Promise<DocumentEntity>;
    update(organizationid: string, doc: DocumentEntity): Promise<DocumentEntity>;
    delete(organizationid: string, id: string): Promise<void>;
}

export const DOCUMENT_REPOSITORY = 'DOCUMENT_REPOSITORY';
