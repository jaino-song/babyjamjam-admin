import { Body, Controller, Get, Post, Query, Logger, UseGuards } from "@nestjs/common";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { ListPendingStaffCompletionUsecase } from "application/usecases/eformsign-doc/list-pending-staff-completion.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import {
    GetAccessTokenDto,
    RefreshAccessTokenDto,
    FetchDocumentsDto,
    FetchDocumentByIdDto,
    CreateEformsignDocLocalDto,
} from "interface/dto/eformsign-doc.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("eformsign-docs")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignDocController {
    private readonly logger = new Logger(EformsignDocController.name);

    constructor(
        private readonly eformsignDocService: EformsignDocService,
        private readonly listPendingStaffCompletionUsecase: ListPendingStaffCompletionUsecase,
        private readonly listClientNamesByBranchUsecase: ListClientNamesByBranchUsecase,
    ) {}

    // ============ Local DB Endpoints ============

    /**
     * POST /eformsign-docs
     * Create a new eformsign document record in local DB
     * Called by frontend after document is created in eformsign
     */
    @Post()
    async create(@CurrentTenant() tenant: { branchId?: string }, @Body() dto: CreateEformsignDocLocalDto) {
        this.logger.log(`[POST /eformsign-docs] Received request to create doc record: documentId=${dto.documentId}, clientId=${dto.clientId}`);
        try {
            const result = await this.eformsignDocService.create(tenant.branchId ?? "", {
                documentId: dto.documentId,
                clientId: dto.clientId,
                statusType: dto.statusType,
                statusDetail: dto.statusDetail,
                stepType: dto.stepType,
                stepIndex: dto.stepIndex,
                stepName: dto.stepName,
                stepRecipientType: dto.stepRecipientType,
                stepRecipientName: dto.stepRecipientName,
                stepRecipientSms: dto.stepRecipientSms,
                expiredDate: new Date(dto.expiredDate),
                linkToClient: dto.linkToClient,
            });
            this.logger.log(`[POST /eformsign-docs] Successfully created record id=${result.id}`);
            return result;
        } catch (error) {
            this.logger.error(`[POST /eformsign-docs] Failed to create record: ${error}`);
            throw error;
        }
    }

    /**
     * GET /eformsign-docs
     * List all stored eformsign documents from local DB
     */
    @Get()
    findAll(@CurrentTenant() tenant: { branchId?: string }) {
        return this.eformsignDocService.findAll(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/id?id=123
     * Find a stored eformsign document by its DB id
     */
    @Get("id")
    findById(@CurrentTenant() tenant: { branchId?: string }, @Query("id") id: string) {
        return this.eformsignDocService.findById(tenant.branchId ?? "", Number(id));
    }

    /**
     * GET /eformsign-docs/document-id?documentId=abc123
     * Find a stored eformsign document by the eformsign documentId
     */
    @Get("document-id")
    findByDocumentId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("documentId") documentId: string
    ) {
        return this.eformsignDocService.findByDocumentId(tenant.branchId ?? "", documentId);
    }

    @Get("pending-staff-completion")
    listPendingStaffCompletion(@CurrentTenant() tenant: { branchId?: string }) {
        return this.listPendingStaffCompletionUsecase.execute(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/client-names
     * Returns documentId → clientName mapping for current branch.
     * Used by the contracts list to show the customer's name even after the
     * doc has progressed past step 1 (eformsign list_document loses outsider info).
     */
    @Get("client-names")
    listClientNames(@CurrentTenant() tenant: { branchId?: string }) {
        return this.listClientNamesByBranchUsecase.execute(tenant.branchId ?? "");
    }

    /**
     * GET /eformsign-docs/client?clientId=123
     * Find all stored eformsign documents linked to a client
     */
    @Get("client")
    findByClientId(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("clientId") clientId: string
    ) {
        return this.eformsignDocService.findByClientId(tenant.branchId ?? "", Number(clientId));
    }

    // ============ External API Endpoints ============

    /**
     * POST /eformsign-docs/access-token
     * Get access token from eformsign API
     */
    @Post("access-token")
    getAccessToken(@Body() dto: GetAccessTokenDto) {
        return this.eformsignDocService.getAccessToken(dto.executionTime, dto.memberEmail);
    }

    /**
     * POST /eformsign-docs/refresh-token
     * Refresh access token using refresh token
     */
    @Post("refresh-token")
    refreshAccessToken(@Body() dto: RefreshAccessTokenDto) {
        return this.eformsignDocService.refreshAccessToken(dto.executionTime, dto.refreshToken);
    }

    /**
     * POST /eformsign-docs/fetch-all
     * Fetch all documents from eformsign API (returns raw API response)
     */
    @Post("fetch-all")
    fetchAllFromApi(@Body() dto: FetchDocumentsDto) {
        return this.eformsignDocService.fetchAllFromApi(dto.accessToken);
    }

    /**
     * POST /eformsign-docs/fetch
     * Fetch a single document from eformsign API (returns raw API response)
     */
    @Post("fetch")
    fetchFromApi(@Body() dto: FetchDocumentByIdDto) {
        return this.eformsignDocService.fetchFromApi(dto.accessToken, dto.documentId);
    }

}
