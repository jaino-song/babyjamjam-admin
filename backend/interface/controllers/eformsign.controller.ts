import { BadRequestException, Controller, Post, Get, Delete, Body, Query, Param, HttpException, HttpStatus, UseGuards, Res, Logger } from "@nestjs/common";
import { EformsignService, getDocumentCreatedTimestamp } from "../../application/services/eformsign.service";
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

type EformsignListDoc = { id: string; created_date?: unknown; createdDate?: unknown };

// StatsBar 카운터 계산에 필요한 최소 신호만 추린 형태. 버킷 분류(매핑)는
// 프론트의 status-codes.ts(foldContractStats) 한 곳에서만 수행한다.
type EformsignStatusSignal = { status_type: string | null; step_recipient_types: Array<string | null> };

function toStatusSignal(doc: unknown): EformsignStatusSignal {
    const currentStatus = (doc as {
        current_status?: { status_type?: unknown; step_recipients?: Array<{ recipient_type?: unknown }> };
    }).current_status;
    const stepRecipients = Array.isArray(currentStatus?.step_recipients) ? currentStatus.step_recipients : [];
    return {
        status_type: typeof currentStatus?.status_type === "string" ? currentStatus.status_type : null,
        step_recipient_types: stepRecipients.map((r) => (typeof r?.recipient_type === "string" ? r.recipient_type : null)),
    };
}

@Controller("api")
@UseGuards(JwtGuard, TenantGuard)
export class EformsignController {
    private readonly logger = new Logger(EformsignController.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly areaTemplateService: AreaTemplateService,
        private readonly eformsignDocService: EformsignDocService,
        private readonly prisma: PrismaService,
    ) { }

    /**
     * 인천점(staff slug=incheon)은 본사 성격이라 전자서명 문서를 지점 구분 없이
     * 전부 열람한다. 그 외 지점은 자기 지점이 만든(=로컬에 적재된) 문서만 본다.
     */
    private async isHeadquartersBranch(branchId: string): Promise<boolean> {
        if (!branchId) {
            return false;
        }
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: { slug: true },
        });
        return branch?.slug === INCHEON_STAFF_BRANCH_SLUG;
    }

    /**
     * (단일 페이지 후처리 필터) 외부 목록 한 페이지를 현재 지점이 로컬에 보유한
     * documentId 집합으로 거른다. 인천점은 우회. per-type 목록 엔드포인트에서 사용.
     */
    private async filterDocumentsByBranch<T extends { id: string }>(
        branchId: string,
        documents: T[],
    ): Promise<T[]> {
        if (!branchId) {
            return [];
        }
        if (await this.isHeadquartersBranch(branchId)) {
            return documents;
        }
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        return documents.filter((doc) => allowedIds.has(doc.id));
    }

    /**
     * 현재 지점이 보유한 전자서명 문서 "전체"를 외부 목록에서 모아 최신순으로 돌려준다.
     * 외부 eformsign 목록을 회사 단위로 페이지네이션하면 지점 문서가 뒤 페이지에 있을 때
     * 빈 페이지에서 무한스크롤이 멈춰 누락되므로, 서버에서 회사 페이지를 훑어 지점 문서를
     * 모은다. 지점 문서를 다 찾으면 조기 종료하고, 안전 상한(MAX_PAGES)을 둔다.
     * 호출부에서 limit/skip으로 잘라 페이지네이션한다.
     */
    private async collectBranchDocuments(accessToken: string, branchId: string): Promise<EformsignListDoc[]> {
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        if (allowedIds.size === 0) {
            return [];
        }

        const PAGE_SIZE = 100;
        const MAX_PAGES = 10;
        const collected = new Map<string, EformsignListDoc>();
        let exhausted = false;

        for (let page = 0; page < MAX_PAGES; page++) {
            const result = await this.eformsignService.getAllDocuments(
                accessToken,
                PAGE_SIZE,
                page * PAGE_SIZE,
            );
            const pageDocs: EformsignListDoc[] = result.documents ?? [];
            if (pageDocs.length === 0) {
                exhausted = true;
                break;
            }
            for (const doc of pageDocs) {
                if (allowedIds.has(doc.id) && !collected.has(doc.id)) {
                    collected.set(doc.id, doc);
                }
            }
            if (collected.size >= allowedIds.size) {
                exhausted = true;
                break;
            }
        }

        if (!exhausted && collected.size < allowedIds.size) {
            this.logger.warn(
                `collectBranchDocuments hit MAX_PAGES (${MAX_PAGES}) for branch ${branchId}; ` +
                `matched ${collected.size}/${allowedIds.size}. Older contracts beyond the page cap may be omitted.`,
            );
        }

        return Array.from(collected.values()).sort((a, b) => {
            const byCreated = getDocumentCreatedTimestamp(b) - getDocumentCreatedTimestamp(a);
            if (byCreated !== 0) {
                return byCreated;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
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
            const parsedLimit = parseInteger(limit, "limit", { defaultValue: 100, min: 1, max: 100 });
            const parsedSkip = parseInteger(skip, "skip", { defaultValue: 0, min: 0 });
            const branchId = tenant.branchId ?? "";

            // 인천점(본사)은 회사 전체를 외부 페이지네이션 그대로 반환.
            if (await this.isHeadquartersBranch(branchId)) {
                return await this.eformsignService.getAllDocuments(accessToken, parsedLimit, parsedSkip);
            }

            // 일반 지점: 지점 보유 문서 전체를 모은 뒤 요청 구간만 잘라 반환한다.
            // (회사 페이지를 그대로 필터하면 지점 문서가 뒤 페이지에 있을 때 무한스크롤이
            //  빈 페이지에서 멈춰 누락되므로, 지점 단위로 페이지네이션한다.)
            const branchDocuments = await this.collectBranchDocuments(accessToken, branchId);
            return {
                documents: branchDocuments.slice(parsedSkip, parsedSkip + parsedLimit),
                total_rows: branchDocuments.length,
                limit: parsedLimit,
                skip: parsedSkip,
            };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * 전체 탭 StatsBar 카운터용: 현재 지점(인천=회사 전체)의 문서를 한 번 모아
     * 버킷 계산에 필요한 원시 신호(status_type + 현재 단계 수신자 타입)만 내려준다.
     * 분류는 프론트(foldContractStats). status-counts는 documents/:documentId보다
     * 먼저 선언되어야 정적 경로로 매칭된다.
     */
    @Get("documents/status-counts")
    async getStatusCounts(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("accessToken") accessToken: string,
    ) {
        try {
            if (!accessToken) {
                throw new HttpException(
                    { error: "Access token is required" },
                    HttpStatus.BAD_REQUEST
                );
            }
            const branchId = tenant.branchId ?? "";
            // 인천점(본사)은 회사 전체 한 페이지, 그 외 지점은 보유 문서 전체를 모은다.
            const documents = (await this.isHeadquartersBranch(branchId))
                ? (await this.eformsignService.getAllDocuments(accessToken, 100, 0)).documents ?? []
                : await this.collectBranchDocuments(accessToken, branchId);
            return { documents: documents.map((doc) => toStatusSignal(doc)) };
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
