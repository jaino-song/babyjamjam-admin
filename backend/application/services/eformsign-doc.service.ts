import { Injectable } from "@nestjs/common";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    GetEformsignAccessTokenUsecase,
    RefreshEformsignAccessTokenUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
} from "application/usecases/eformsign-doc";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";

@Injectable()
export class EformsignDocService {
    constructor(
        // Local DB use cases
        private readonly findEformsignDocByIdUsecase: FindEformsignDocByIdUsecase,
        private readonly findEformsignDocByDocumentIdUsecase: FindEformsignDocByDocumentIdUsecase,
        private readonly findEformsignDocsByClientIdUsecase: FindEformsignDocsByClientIdUsecase,
        private readonly listEformsignDocsUsecase: ListEformsignDocsUsecase,
        // External API use cases
        private readonly getEformsignAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly refreshEformsignAccessTokenUsecase: RefreshEformsignAccessTokenUsecase,
        private readonly fetchAllEformsignDocsFromApiUsecase: FetchAllEformsignDocsFromApiUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
    ) {}

    // ============ Local DB Operations ============

    /**
     * Find a stored eformsign doc by its DB id
     */
    findById(id: number): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByIdUsecase.execute(id);
    }

    /**
     * Find a stored eformsign doc by the eformsign document_id
     */
    findByDocumentId(documentId: string): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByDocumentIdUsecase.execute(documentId);
    }

    /**
     * Find all stored eformsign docs linked to a client
     */
    findByClientId(clientId: number): Promise<EformsignDocEntity[]> {
        return this.findEformsignDocsByClientIdUsecase.execute(clientId);
    }

    /**
     * List all stored eformsign docs
     */
    findAll(): Promise<EformsignDocEntity[]> {
        return this.listEformsignDocsUsecase.execute();
    }

    // ============ External API Operations ============

    /**
     * Get access token from eformsign API
     * @param executionTime - timestamp used for signature generation
     * @param memberEmail - optional member email (uses default if not provided)
     */
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse> {
        return this.getEformsignAccessTokenUsecase.execute(executionTime, memberEmail);
    }

    /**
     * Refresh access token using refresh token
     * @param executionTime - timestamp used for signature generation
     * @param refreshToken - the refresh token from previous token response
     */
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        return this.refreshEformsignAccessTokenUsecase.execute(executionTime, refreshToken);
    }

    /**
     * Fetch all documents from eformsign API
     * @param accessToken - valid access token
     */
    fetchAllFromApi(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        return this.fetchAllEformsignDocsFromApiUsecase.execute(accessToken);
    }

    /**
     * Fetch a single document from eformsign API
     * @param accessToken - valid access token
     * @param documentId - the eformsign document id
     */
    fetchFromApi(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
        return this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
    }
}

