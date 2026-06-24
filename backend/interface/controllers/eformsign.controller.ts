import { BadRequestException, Controller, Post, Get, Delete, Body, Query, Param, HttpException, HttpStatus, UseGuards, Res } from "@nestjs/common";
import { EformsignService } from "../../application/services/eformsign.service";
import { EformsignDocService } from "../../application/services/eformsign-doc.service";
import { AreaTemplateService } from "../../application/services/area-template.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { INCHEON_STAFF_BRANCH_SLUG } from "domain/constants/branch-routing.constants";
import { GenerateStaffDocumentRequestDto } from "../dto/staff-document.dto";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { Response } from "express";
import { parseInteger } from "interface/parse-integer";
import {
    AccessTokenRequestDto,
    DeleteDocumentsRequestDto,
    GenerateDocumentRequestDto,
    GenerateSignatureRequestDto,
    RefreshTokenRequestDto,
    ReRequestOutsiderDocumentRequestDto,
} from "interface/dto/eformsign.dto";

function throwHttpOrInternalError(error: unknown): never {
    if (error instanceof HttpException) {
        throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    throw new HttpException(
        { error: message },
        HttpStatus.INTERNAL_SERVER_ERROR
    );
}

function parseBooleanQuery(value: string | undefined, name: string, defaultValue: boolean): boolean {
    if (value === undefined || value === "") {
        return defaultValue;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }

    throw new BadRequestException(`${name} must be true or false`);
}

type DownloadFileType = "document" | "audit_trail";

function parseDownloadFileType(value: string | undefined): DownloadFileType {
    if (value === undefined || value === "") {
        return "document";
    }
    if (value === "document" || value === "audit_trail") {
        return value;
    }

    throw new BadRequestException("fileType must be document or audit_trail");
}

@Controller("api")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignController {
    constructor(
        private readonly eformsignService: EformsignService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly eformsignDocService: EformsignDocService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * 현재 지점이 로컬에 적재한(=생성한) 전자서명 문서만 남긴다.
     * 외부 eformsign API는 회사(EFORMSIGN_COMPANY_ID) 전체 문서를 반환하므로,
     * 로컬 eformsign_doc에 현재 branchId로 기록된 documentId 집합과 교차시켜 거른다.
     * 로컬 매핑이 없는 문서(어느 지점이 만들었는지 모르는 문서)는 제외한다.
     * 단, 인천점(staff slug=incheon)은 본사 성격이라 필터를 우회해
     * branchId 매핑이 없는 문서까지 전부 본다.
     */
    private async filterDocumentsByBranch<T extends { id: string }>(
        branchId: string,
        documents: T[],
    ): Promise<T[]> {
        if (!branchId) {
            return [];
        }
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { slug: true },
        });
        if (branch?.slug === INCHEON_STAFF_BRANCH_SLUG) {
            return documents;
        }
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        return documents.filter((doc) => allowedIds.has(doc.id));
    }

    @Post("generate-signature")
    async generateSignature(@Body() body: GenerateSignatureRequestDto) {
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
    async getAccessToken(@Body() body: AccessTokenRequestDto) {
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
    async refreshAccessToken(@Body() body: RefreshTokenRequestDto) {
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
        @CurrentTenant() tenant: { branchId?: string },
        @Body() body: GenerateDocumentRequestDto
    ) {
        try {
            // Look up templateId based on area
            let templateId: string | undefined;
            if (body.contractData.area) {
                const areaTemplate = await this.areaTemplateService.findByArea(
                    tenant.branchId ?? "",
                    body.contractData.area
                );
                templateId = areaTemplate?.templateId;
            }

            const documentOptions = this.eformsignService.generateDocumentOptions(
                body.contractData,
                body.accessToken,
                body.refreshToken,
                templateId
            );

            // Return clientId for frontend to use when creating eformsign doc record
            return {
                ...documentOptions,
                clientId: body.clientId,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post("generate-staff-document")
    async generateStaffDocument(@Body() body: GenerateStaffDocumentRequestDto) {
        try {
            return await this.eformsignService.generateStaffCompletionOptions(
                body.documentId,
                body.accessToken,
                body.refreshToken,
                body.prefillEndDate,
            );
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
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
    async getAllDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const result = await this.eformsignService.getAllDocuments(
                accessToken,
                parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 }),
                parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
            );
            const documents = await this.filterDocumentsByBranch(tenant.branchId ?? "", result.documents);
            return {
                ...result,
                documents,
                total_rows: documents.length,
            };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get in-progress documents (진행 중 - type: 01)
     */
    @Get("documents/in-progress")
    async getInProgressDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const result = await this.eformsignService.getInProgressDocuments(
                accessToken,
                parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 }),
                parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
            );
            const documents = await this.filterDocumentsByBranch(tenant.branchId ?? "", result.documents ?? []);
            return { ...result, documents };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get completed documents (완료 - type: 03)
     */
    @Get("documents/completed")
    async getCompletedDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const result = await this.eformsignService.getCompletedDocuments(
                accessToken,
                parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 }),
                parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
            );
            const documents = await this.filterDocumentsByBranch(tenant.branchId ?? "", result.documents ?? []);
            return { ...result, documents };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Get rejected documents (거부/반려 - type: 04)
     */
    @Get("documents/rejected")
    async getRejectedDocuments(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
        @Query("limit") limit?: string,
        @Query("skip") skip?: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const result = await this.eformsignService.getRejectedDocuments(
                accessToken,
                parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 }),
                parseInteger(skip, "skip", { defaultValue: 0, min: 0 }),
            );
            const documents = await this.filterDocumentsByBranch(tenant.branchId ?? "", result.documents ?? []);
            return { ...result, documents };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Delete one or more documents
     */
    @Delete("documents")
    async deleteDocuments(
        @Query("accessToken") accessToken: string,
        @Query("is_permanent") isPermanent: string,
        @Body() body: DeleteDocumentsRequestDto
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            if (!body.document_ids || !Array.isArray(body.document_ids) || body.document_ids.length === 0) {
                throw new HttpException(
                    { error: "document_ids array is required and must not be empty" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const permanent = parseBooleanQuery(isPermanent, "is_permanent", false);
            const result = await this.eformsignService.deleteDocuments(
                accessToken,
                body.document_ids,
                permanent
            );
            return result;
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
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

    /**
     * Download document PDF for preview/download.
     */
    @Get("documents/:documentId/download_files")
    async downloadDocumentFile(
        @Param("documentId") documentId: string,
        @Query("accessToken") accessToken: string,
        @Query("fileType") fileType: string | undefined,
        @Res() res: Response,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            const parsedFileType = parseDownloadFileType(fileType);
            const file = await this.eformsignService.downloadDocumentFile(accessToken, documentId, parsedFileType);

            res.status(file.status);
            res.set({
                "Content-Type": file.contentType,
                ...(file.contentDisposition ? { "Content-Disposition": file.contentDisposition } : {}),
                "Content-Length": String(file.body.length),
            });
            res.send(file.body);
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * Re-request an outsider document to the current recipient.
     */
    @Post("documents/:documentId/re_request_outsider")
    async reRequestOutsiderDocument(
        @Param("documentId") documentId: string,
        @Body() body: ReRequestOutsiderDocumentRequestDto
    ) {
        try {
            if (!body.accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            if (!body.stepType || !body.stepSeq) {
                throw new HttpException(
                    { error: "stepType and stepSeq are required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            if (
                body.recipientPhone &&
                (!body.recipientPhone.countryCode || !body.recipientPhone.phoneNumber)
            ) {
                throw new HttpException(
                    { error: "recipientPhone countryCode and phoneNumber are required" },
                    HttpStatus.BAD_REQUEST
                );
            }

            return await this.eformsignService.reRequestOutsiderDocument(
                body.accessToken,
                documentId,
                body.stepType,
                body.stepSeq,
                body.comment,
                body.recipientPhone
            );
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }

            const message = error instanceof Error ? error.message : "Unknown error";
            throw new HttpException(
                { error: message },
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }
}
