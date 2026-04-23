import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

export interface IEformsignDocRepository {
    findById(branchid: string, id: number): Promise<EformsignDocEntity | null>;
    findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null>;
    findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]>;
    findAll(branchid: string): Promise<EformsignDocEntity[]>;
    create(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    update(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    upsertByDocumentId(branchid: string, doc: EformsignDocEntity): Promise<EformsignDocEntity>;
    delete(branchid: string, id: number): Promise<void>;
    deleteByDocumentId(branchid: string, documentId: string): Promise<void>;
}

export const EFORMSIGN_DOC_REPOSITORY = "EFORMSIGN_DOC_REPOSITORY";
