import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import {
    GetAccessTokenDto,
    RefreshAccessTokenDto,
    FetchDocumentsDto,
    FetchDocumentByIdDto,
    CreateEformsignDocLocalDto,
} from "interface/dto/eformsign-doc.dto";

@Controller("eformsign-docs")
export class EformsignDocController {
    constructor(private readonly eformsignDocService: EformsignDocService) {}

    // ============ Local DB Endpoints ============

    /**
     * POST /eformsign-docs
     * Create a new eformsign document record in local DB
     * Called by frontend after document is created in eformsign
     */
    @Post()
    create(@Body() dto: CreateEformsignDocLocalDto) {
        return this.eformsignDocService.create({
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
        });
    }

    /**
     * GET /eformsign-docs
     * List all stored eformsign documents from local DB
     */
    @Get()
    findAll() {
        return this.eformsignDocService.findAll();
    }

    /**
     * GET /eformsign-docs/id?id=123
     * Find a stored eformsign document by its DB id
     */
    @Get("id")
    findById(@Query("id") id: string) {
        return this.eformsignDocService.findById(Number(id));
    }

    /**
     * GET /eformsign-docs/document-id?documentId=abc123
     * Find a stored eformsign document by the eformsign document_id
     */
    @Get("document-id")
    findByDocumentId(@Query("documentId") documentId: string) {
        return this.eformsignDocService.findByDocumentId(documentId);
    }

    /**
     * GET /eformsign-docs/client?clientId=123
     * Find all stored eformsign documents linked to a client
     */
    @Get("client")
    findByClientId(@Query("clientId") clientId: string) {
        return this.eformsignDocService.findByClientId(Number(clientId));
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

