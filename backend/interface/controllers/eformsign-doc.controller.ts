import { Body, Controller, Get, Post, Query, Logger } from "@nestjs/common";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import {
    GetAccessTokenDto,
    RefreshAccessTokenDto,
    FetchDocumentsDto,
    FetchDocumentByIdDto,
    CreateEformsignDocLocalDto,
} from "interface/dto/eformsign-doc.dto";
import { CurrentTenant } from "infrastructure/tenant";

@Controller("eformsign-docs")
export class EformsignDocController {
    private readonly logger = new Logger(EformsignDocController.name);

    constructor(private readonly eformsignDocService: EformsignDocService) {}

    // ============ Local DB Endpoints ============

    /**
     * POST /eformsign-docs
     * Create a new eformsign document record in local DB
     * Called by frontend after document is created in eformsign
     */
    @Post()
    async create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateEformsignDocLocalDto) {
        this.logger.log(`[POST /eformsign-docs] Received request to create doc record: documentId=${dto.documentId}, clientId=${dto.clientId}`);
        try {
            const result = await this.eformsignDocService.create(tenant.organizationId ?? "", {
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
    findAll(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.eformsignDocService.findAll(tenant.organizationId ?? "");
    }

    /**
     * GET /eformsign-docs/id?id=123
     * Find a stored eformsign document by its DB id
     */
    @Get("id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Query("id") id: string) {
        return this.eformsignDocService.findById(tenant.organizationId ?? "", Number(id));
    }

    /**
     * GET /eformsign-docs/document-id?documentId=abc123
     * Find a stored eformsign document by the eformsign document_id
     */
    @Get("document-id")
    findByDocumentId(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("documentId") documentId: string
    ) {
        return this.eformsignDocService.findByDocumentId(tenant.organizationId ?? "", documentId);
    }

    /**
     * GET /eformsign-docs/client?clientId=123
     * Find all stored eformsign documents linked to a client
     */
    @Get("client")
    findByClientId(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("clientId") clientId: string
    ) {
        return this.eformsignDocService.findByClientId(tenant.organizationId ?? "", Number(clientId));
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
