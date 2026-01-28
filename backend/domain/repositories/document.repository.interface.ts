import { DocumentEntity } from "domain/entities/document.entity";

export interface IDocumentRepository {
    findById(id: string): Promise<DocumentEntity | null>;
    findByOrgId(orgid: string): Promise<DocumentEntity[]>;
    findByCategoryId(categoryId: string): Promise<DocumentEntity[]>;
    findAll(): Promise<DocumentEntity[]>;
    create(doc: DocumentEntity): Promise<DocumentEntity>;
    update(doc: DocumentEntity): Promise<DocumentEntity>;
    delete(id: string): Promise<void>;
}

export const DOCUMENT_REPOSITORY = "DOCUMENT_REPOSITORY";
