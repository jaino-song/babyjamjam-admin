import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

export interface IEformsignDocRepository {
    findById(organizationid: string, id: number): Promise<EformsignDocEntity | null>;
    findByDocumentId(organizationid: string, documentId: string): Promise<EformsignDocEntity | null>;
    findByClientId(organizationid: string, clientId: number): Promise<EformsignDocEntity[]>;
    findAll(organizationid: string): Promise<EformsignDocEntity[]>;
    create(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    update(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    upsertByDocumentId(organizationid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    delete(organizationid: string, id: number): Promise<void>;
    deleteByDocumentId(organizationid: string, documentId: string): Promise<void>;
}

export const EFORMSIGN_DOC_REPOSITORY = "EFORMSIGN_DOC_REPOSITORY";
