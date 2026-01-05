import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

export interface IEformsignDocRepository {
    findById(id: number): Promise<EformsignDocEntity | null>;
    findByDocumentId(documentId: string): Promise<EformsignDocEntity | null>;
    findByClientId(clientId: number): Promise<EformsignDocEntity[]>;
    findAll(): Promise<EformsignDocEntity[]>;
    create(doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    update(doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    upsertByDocumentId(doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    delete(id: number): Promise<void>;
    deleteByDocumentId(documentId: string): Promise<void>;
}

export const EFORMSIGN_DOC_REPOSITORY = "EFORMSIGN_DOC_REPOSITORY";

