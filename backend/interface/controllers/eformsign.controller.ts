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
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";

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

type EformsignListDoc = {
    id: string;
    created_date?: unknown;
    createdDate?: unknown;
    fields?: unknown;
    detail_template_info?: unknown;
} & Record<string, unknown>;

const CUSTOMER_NAME_FIELD_IDS = [
    "이용자 성명",
    "이용자성명",
    "고객 성명",
    "고객성명",
    "고객명",
    "산모 성명",
    "산모성명",
    "산모명",
    "성명",
    "customerName",
    "clientName",
    "userName",
] as const;

const DETAIL_ENRICHMENT_CONCURRENCY = 4;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function collectRecords(value: unknown, depth = 0): UnknownRecord[] {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
    if (!isRecord(value)) return [];
    return [value, ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1))];
}

function stringFromUnknown(value: unknown): string | null {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function normalizeFieldId(value: string): string {
    return value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
}

function canUseReverseContains(value: string): boolean {
    return /^[a-z0-9]+$/.test(value) && value.length >= 5;
}

function isCustomerNameKey(key: string): boolean {
    const normalizedKey = normalizeFieldId(key);
    return CUSTOMER_NAME_FIELD_IDS.map(normalizeFieldId).some(
        (id) =>
            normalizedKey === id ||
            normalizedKey.includes(id) ||
            (canUseReverseContains(normalizedKey) && id.includes(normalizedKey)),
    );
}

function valueFromFieldRecord(record: UnknownRecord): string | null {
    const valueKeys = ["value", "field_value", "fieldValue", "input_value", "inputValue", "data", "text"] as const;
    for (const key of valueKeys) {
        const value = stringFromUnknown(record[key]);
        if (value) return value;
    }
    for (const nested of collectRecords(record).slice(1)) {
        for (const key of valueKeys) {
            const value = stringFromUnknown(nested[key]);
            if (value) return value;
        }
    }
    return null;
}

function documentHasCustomerNameField(doc: EformsignListDoc): boolean {
    for (const source of [doc.fields, doc.detail_template_info]) {
        for (const record of collectRecords(source)) {
            for (const [key, rawValue] of Object.entries(record)) {
                if (!isCustomerNameKey(key)) continue;
                if (stringFromUnknown(rawValue) || valueFromFieldRecord({ value: rawValue })) {
                    return true;
                }
            }
        }
    }

    for (const record of collectRecords(doc.fields)) {
        const idTokens = [
            stringFromUnknown(record["id"]),
            stringFromUnknown(record["field_id"]),
            stringFromUnknown(record["fieldId"]),
            stringFromUnknown(record["name"]),
            stringFromUnknown(record["label"]),
            stringFromUnknown(record["field_name"]),
            stringFromUnknown(record["fieldName"]),
            stringFromUnknown(record["display_name"]),
            stringFromUnknown(record["displayName"]),
            stringFromUnknown(record["input_id"]),
            stringFromUnknown(record["inputId"]),
        ].filter((value): value is string => Boolean(value));

        if (idTokens.some(isCustomerNameKey) && valueFromFieldRecord(record)) {
            return true;
        }
    }

    return false;
}

function hasCollectionValues(value: unknown): boolean {
    return Array.isArray(value) ? value.length > 0 : value != null;
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(items[currentIndex] as T);
            }
        }),
    );

    return results;
}

// StatsBar 카운터 계산에 필요한 최소 신호만 추린 형태. 버킷 분류(매핑)는
// 프론트의 status-codes.ts(foldContractStats) 한 곳에서만 수행한다.
type EformsignStatusSignal = {
    status_type: string | null;
    step_type: string | null;
    step_name: string | null;
    step_recipient_types: Array<string | null>;
};

function toStatusSignal(doc: unknown): EformsignStatusSignal {
    const currentStatus = (doc as {
        current_status?: {
            status_type?: unknown;
            step_type?: unknown;
            step_name?: unknown;
            step_recipients?: Array<{ recipient_type?: unknown }>;
        };
    }).current_status;
    const stepRecipients = Array.isArray(currentStatus?.step_recipients) ? currentStatus.step_recipients : [];
    return {
        status_type: typeof currentStatus?.status_type === "string" ? currentStatus.status_type : null,
        step_type: typeof currentStatus?.step_type === "string" ? currentStatus.step_type : null,
        step_name: typeof currentStatus?.step_name === "string" ? currentStatus.step_name : null,
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
        private readonly assignmentGuard: ContractClientAssignmentGuardService,
    ) { }

    /**
     * 인천점(staff slug=incheon)은 본사 성격이라 지점에 매여 있지 않은 문서까지 본다:
     * 자기가 만든 문서 + 지점 매핑이 없는(branchId 미지정) 문서. 단, 다른 지점이
     * 소유한 문서는 제외한다. 그 외 지점은 자기 지점이 만든(=로컬에 적재된) 문서만 본다.
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
     * (단일 페이지 후처리 필터) 외부 목록 한 페이지를 현재 지점 기준으로 거른다.
     * 인천점(본사)은 "다른 지점이 소유한" 문서만 제외하고(자기 문서 + 미지정 문서는
     * 통과) 그 외 지점은 자기 지점이 로컬에 보유한 documentId만 통과시킨다.
     * per-type 목록 엔드포인트에서 사용.
     */
    private async filterDocumentsByBranch<T extends { id: string }>(
        branchId: string,
        documents: T[],
    ): Promise<T[]> {
        if (!branchId) {
            return [];
        }
        if (await this.isHeadquartersBranch(branchId)) {
            const otherBranchIds = new Set(
                await this.eformsignDocService.findDocumentIdsForOtherBranches(branchId),
            );
            return documents.filter((doc) => !otherBranchIds.has(doc.id));
        }
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        return documents.filter((doc) => allowedIds.has(doc.id));
    }

    /**
     * 외부 회사 목록을 페이지 단위로 훑어 keep 조건을 만족하는 문서를 모아 최신순으로
     * 돌려준다. 호출부에서 limit/skip으로 잘라 페이지네이션한다.
     * - targetCount(기대 개수)를 주면 그만큼 모은 시점에 조기 종료한다(지점 보유분).
     * - null이면 페이지 상한(MAX_PAGES)까지 전수 스캔한다(인천 본사: "타 지점 제외 전부").
     */
    private async scanCompanyDocuments(
        accessToken: string,
        keep: (doc: EformsignListDoc) => boolean,
        targetCount: number | null,
        branchId: string,
    ): Promise<EformsignListDoc[]> {
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
                if (keep(doc) && !collected.has(doc.id)) {
                    collected.set(doc.id, doc);
                }
            }
            if (targetCount !== null && collected.size >= targetCount) {
                exhausted = true;
                break;
            }
        }

        if (!exhausted && targetCount !== null && collected.size < targetCount) {
            this.logger.warn(
                `scanCompanyDocuments hit MAX_PAGES (${MAX_PAGES}) for branch ${branchId}; ` +
                `matched ${collected.size}/${targetCount}. Older contracts beyond the page cap may be omitted.`,
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

    /**
     * 현재 지점이 보유한 전자서명 문서 "전체"를 외부 목록에서 모아 최신순으로 돌려준다.
     * 외부 eformsign 목록을 회사 단위로 페이지네이션하면 지점 문서가 뒤 페이지에 있을 때
     * 빈 페이지에서 무한스크롤이 멈춰 누락되므로, 회사 페이지를 훑어 지점 문서를 모은다.
     * 지점 보유 documentId 집합 크기를 기대 개수로 삼아 다 찾으면 조기 종료한다.
     */
    private async collectBranchDocuments(accessToken: string, branchId: string): Promise<EformsignListDoc[]> {
        const localDocs = await this.eformsignDocService.findAll(branchId);
        const allowedIds = new Set(localDocs.map((doc) => doc.documentId));
        if (allowedIds.size === 0) {
            return [];
        }
        return this.scanCompanyDocuments(
            accessToken,
            (doc) => allowedIds.has(doc.id),
            allowedIds.size,
            branchId,
        );
    }

    /**
     * 인천점(본사) 전용: 회사 전체 문서 중 "다른 지점이 소유한" 문서만 제외하고 모은다.
     * 즉 인천이 만든 문서 + 지점 매핑이 없는(branchId null/미적재) 문서를 본다. 제외할
     * 집합만 알 뿐 기대 개수를 알 수 없어, 페이지 상한까지 전수 스캔(targetCount=null)한다.
     */
    private async collectHeadquartersDocuments(accessToken: string, incheonBranchId: string): Promise<EformsignListDoc[]> {
        const otherBranchIds = new Set(
            await this.eformsignDocService.findDocumentIdsForOtherBranches(incheonBranchId),
        );
        return this.scanCompanyDocuments(
            accessToken,
            (doc) => !otherBranchIds.has(doc.id),
            null,
            incheonBranchId,
        );
    }

    private async enrichDocumentsWithDisplayFields(
        accessToken: string,
        documents: EformsignListDoc[],
    ): Promise<EformsignListDoc[]> {
        return mapWithConcurrency(documents, DETAIL_ENRICHMENT_CONCURRENCY, async (doc) => {
            if (documentHasCustomerNameField(doc)) {
                return doc;
            }

            try {
                const detail = await this.eformsignService.getDocumentById(accessToken, doc.id);
                return {
                    ...doc,
                    fields: hasCollectionValues(detail?.fields) ? detail.fields : doc.fields,
                    detail_template_info: hasCollectionValues(detail?.detail_template_info)
                        ? detail.detail_template_info
                        : doc.detail_template_info,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                this.logger.warn(`Failed to enrich eformsign document ${doc.id}: ${message}`);
                return doc;
            }
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
            await this.assignmentGuard.assertAssignedProvider(
                tenant.branchId ?? "",
                body.clientId,
                body.contractData.caretaker1Contact,
            );
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
            throwHttpOrInternalError(error);
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

            // 인천점(본사): 회사 전체에서 다른 지점 소유분만 빼고 모은 뒤 요청 구간만 잘라 반환.
            // (필터링 때문에 외부 페이지네이션을 그대로 흘리면 페이지 경계에 빈틈이 생긴다.)
            if (await this.isHeadquartersBranch(branchId)) {
                const hqDocuments = await this.collectHeadquartersDocuments(accessToken, branchId);
                const pageDocuments = hqDocuments.slice(parsedSkip, parsedSkip + parsedLimit);
                return {
                    documents: await this.enrichDocumentsWithDisplayFields(accessToken, pageDocuments),
                    total_rows: hqDocuments.length,
                    limit: parsedLimit,
                    skip: parsedSkip,
                };
            }

            // 일반 지점: 지점 보유 문서 전체를 모은 뒤 요청 구간만 잘라 반환한다.
            // (회사 페이지를 그대로 필터하면 지점 문서가 뒤 페이지에 있을 때 무한스크롤이
            //  빈 페이지에서 멈춰 누락되므로, 지점 단위로 페이지네이션한다.)
            const branchDocuments = await this.collectBranchDocuments(accessToken, branchId);
            const pageDocuments = branchDocuments.slice(parsedSkip, parsedSkip + parsedLimit);
            return {
                documents: await this.enrichDocumentsWithDisplayFields(accessToken, pageDocuments),
                total_rows: branchDocuments.length,
                limit: parsedLimit,
                skip: parsedSkip,
            };
        } catch (error) {
            throwHttpOrInternalError(error);
        }
    }

    /**
     * 전체 탭 StatsBar 카운터용: 현재 지점(인천=다른 지점 제외 전체)의 문서를 한 번
     * 모아 버킷 계산에 필요한 원시 신호(status_type + 현재 단계 정보)만 내려준다.
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
            // 인천점(본사)은 다른 지점 소유분 제외 전체, 그 외 지점은 보유 문서 전체를 모은다.
            const documents = (await this.isHeadquartersBranch(branchId))
                ? await this.collectHeadquartersDocuments(accessToken, branchId)
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
            return { ...result, documents: await this.enrichDocumentsWithDisplayFields(accessToken, documents) };
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
            return { ...result, documents: await this.enrichDocumentsWithDisplayFields(accessToken, documents) };
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
            return { ...result, documents: await this.enrichDocumentsWithDisplayFields(accessToken, documents) };
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
