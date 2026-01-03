import { Controller, Post, Get, Body, Query, Param, HttpException, HttpStatus } from "@nestjs/common";
import { EformsignService } from "../../application/services/eformsign.service";
import { ContractDataDto } from "../../application/dto/contract.dto";
import { AreaTemplateService } from "../../application/services/area-template.service";

@Controller("api")
export class EformsignController {
    constructor(
        private readonly eformsignService: EformsignService,
        private readonly areaTemplateService: AreaTemplateService,
    ) {}

    @Post("generate-signature")
    async generateSignature(@Body() body: { executionTime: number }) {
        try {
            const signature = this.eformsignService.generateSignature(body.executionTime);
            return { signature };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("access-token")
    async getAccessToken(@Body() body: { executionTime: number; memberEmail?: string }) {
        try {
            const result = await this.eformsignService.getAccessToken(
                body.executionTime,
                body.memberEmail
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("refresh-token")
    async refreshAccessToken(@Body() body: { executionTime: number; refreshToken: string }) {
        try {
            const result = await this.eformsignService.refreshAccessToken(
                body.executionTime,
                body.refreshToken
            );
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("generate-document")
    async generateDocument(
        @Body() body: { contractData: ContractDataDto; accessToken: string; refreshToken: string }
    ) {
        try {
            // Look up template_id based on area
            let templateId: string | undefined;
            if (body.contractData.area) {
                const areaTemplate = await this.areaTemplateService.findByArea(body.contractData.area);
                templateId = areaTemplate?.templateId;
            }

            const documentOptions = this.eformsignService.generateDocumentOptions(
                body.contractData,
                body.accessToken,
                body.refreshToken,
                templateId
            );
            return documentOptions;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get all documents (combines in-progress, completed, rejected in single request)
     * More efficient than making 3 separate requests from frontend
     */
    @Get("documents")
    async getAllDocuments(@Query("accessToken") accessToken: string) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const documents = await this.eformsignService.getAllDocuments(accessToken);
            return documents;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get in-progress documents (진행 중 - type: 01)
     */
    @Get("documents/in-progress")
    async getInProgressDocuments(@Query("accessToken") accessToken: string) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const documents = await this.eformsignService.getInProgressDocuments(accessToken);
            return documents;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get completed documents (완료 - type: 03)
     */
    @Get("documents/completed")
    async getCompletedDocuments(@Query("accessToken") accessToken: string) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const documents = await this.eformsignService.getCompletedDocuments(accessToken);
            return documents;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get rejected documents (거부/반려 - type: 04)
     */
    @Get("documents/rejected")
    async getRejectedDocuments(@Query("accessToken") accessToken: string) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const documents = await this.eformsignService.getRejectedDocuments(accessToken);
            return documents;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    /**
     * Get single document by ID
     */
    @Get("documents/:documentId")
    async getDocumentById(
        @Param("documentId") documentId: string,
        @Query("accessToken") accessToken: string
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const document = await this.eformsignService.getDocumentById(accessToken, documentId);
            return document;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}

