import { Injectable, Logger } from "@nestjs/common";
import {
    FindEformsignDocByIdUsecase,
    FindEformsignDocByDocumentIdUsecase,
    FindEformsignDocsByClientIdUsecase,
    ListEformsignDocsUsecase,
    GetEformsignAccessTokenUsecase,
    RefreshEformsignAccessTokenUsecase,
    FetchAllEformsignDocsFromApiUsecase,
    FetchEformsignDocFromApiUsecase,
    CreateEformsignDocUsecase,
    CreateEformsignDocParams,
    UpdateEformsignDocStatusUsecase,
    CreateAndSendContractUsecase,
    CreateAndSendContractParams,
    CreateAndSendContractResult,
} from "application/usecases/eformsign-doc";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";

const COMPLETED_STATUS_CODES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
const REJECTED_STATUS_CODES = new Set(["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"]);

@Injectable()
export class EformsignDocService {
    private readonly logger = new Logger(EformsignDocService.name);

    constructor(
        // Local DB use cases
        private readonly findEformsignDocByIdUsecase: FindEformsignDocByIdUsecase,
        private readonly findEformsignDocByDocumentIdUsecase: FindEformsignDocByDocumentIdUsecase,
        private readonly findEformsignDocsByClientIdUsecase: FindEformsignDocsByClientIdUsecase,
        private readonly listEformsignDocsUsecase: ListEformsignDocsUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly updateEformsignDocStatusUsecase: UpdateEformsignDocStatusUsecase,
        // External API use cases
        private readonly getEformsignAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly refreshEformsignAccessTokenUsecase: RefreshEformsignAccessTokenUsecase,
        private readonly fetchAllEformsignDocsFromApiUsecase: FetchAllEformsignDocsFromApiUsecase,
        private readonly fetchEformsignDocFromApiUsecase: FetchEformsignDocFromApiUsecase,
        // Contract creation
        private readonly createAndSendContractUsecase: CreateAndSendContractUsecase,
    ) {}

    // ============ Local DB Operations ============

    /**
     * Create a new eformsign doc record in local DB
     * @param params - document creation parameters
     */
    async create(branchid: string, params: CreateEformsignDocParams): Promise<EformsignDocEntity> {
        this.logger.log(`Creating eformsign doc record: documentId=${params.documentId}, clientId=${params.clientId}, linkToClient=${params.linkToClient}`);
        const result = await this.createEformsignDocUsecase.execute(branchid, params);
        this.logger.log(`Successfully created eformsign doc record: id=${result.id}, documentId=${result.documentId}`);
        return result;
    }

    /**
     * Find a stored eformsign doc by its DB id
     */
    findById(branchid: string, id: number): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByIdUsecase.execute(branchid, id);
    }

    /**
     * Find a stored eformsign doc by the eformsign documentId
     */
    findByDocumentId(branchid: string, documentId: string): Promise<EformsignDocEntity | null> {
        return this.findEformsignDocByDocumentIdUsecase.execute(branchid, documentId);
    }

    /**
     * Find all stored eformsign docs linked to a client
     */
    findByClientId(branchid: string, clientId: number): Promise<EformsignDocEntity[]> {
        return this.findEformsignDocsByClientIdUsecase.execute(branchid, clientId);
    }

    /**
     * List all stored eformsign docs
     */
    findAll(branchid: string): Promise<EformsignDocEntity[]> {
        return this.listEformsignDocsUsecase.execute(branchid);
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

    async syncStatusFromApi(
        branchid: string,
        accessToken: string,
        documentId: string
    ): Promise<EformsignDocEntity> {
        const document = await this.fetchEformsignDocFromApiUsecase.execute(accessToken, documentId);
        const currentStatus = document.current_status;
        const statusType = this.normalizeStatusCode(currentStatus?.status_type);

        return this.updateEformsignDocStatusUsecase.execute(branchid, {
            documentId,
            statusType,
            statusDetail: this.statusDetail(statusType, currentStatus?.step_name),
            stepType: currentStatus?.step_type,
            stepIndex: currentStatus?.step_index,
            stepName: currentStatus?.step_name,
            expired: currentStatus?._expired,
        });
    }

    createAndSendContract(
        branchid: string,
        params: CreateAndSendContractParams
    ): Promise<CreateAndSendContractResult> {
        return this.createAndSendContractUsecase.execute(branchid, params);
    }

    private normalizeStatusCode(statusType: string | null | undefined): string {
        return statusType?.trim().padStart(3, "0") || "000";
    }

    private statusDetail(statusType: string, stepName: string | null | undefined): string {
        if (COMPLETED_STATUS_CODES.has(statusType)) {
            return "완료";
        }
        if (REJECTED_STATUS_CODES.has(statusType)) {
            return "거부";
        }
        return stepName?.trim() || "진행중";
    }
}
