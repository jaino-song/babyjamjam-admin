import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "infrastructure/database/prisma.service";
import * as crypto from "crypto";
import * as https from "https";
import { extractEformsignContractEndDate } from "../utils/eformsign-contract-end-date";
import { getStatusCategory, isDeletedEformsignStatusCode, isProviderReviewWorkflowStep } from "../utils/eformsign-status-codes";
import { ContractDataDto } from "../dto/contract.dto";

export const CONTRACT_END_DATE_ENRICHMENT_BUDGET_MS = 8000;

export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
}

@Injectable()
export class EformsignService {
    private readonly logger = new Logger(EformsignService.name);
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string;
    private readonly EFORMSIGN_DOC_API_URL: string;
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly EFORMSIGN_TEMPLATE_ID: string;

    constructor(
        private configService: ConfigService,
        private readonly prisma: PrismaService,
    ) {
        this.USER_EMAIL = this.configService.getOrThrow<string>("EFORMSIGN_USER_EMAIL");
        this.EFORMSIGN_API_URL = this.configService.getOrThrow<string>("EFORMSIGN_API_URL");
        this.EFORMSIGN_DOC_API_URL = this.configService.getOrThrow<string>("EFORMSIGN_DOC_API_URL");
        this.EFORMSIGN_API_KEY = this.configService.getOrThrow<string>("EFORMSIGN_API_KEY");
        this.EFORMSIGN_PRIVATE_KEY = this.configService.getOrThrow<string>("EFORMSIGN_PRIVATE_KEY");
        this.EFORMSIGN_COMPANY_ID = this.configService.getOrThrow<string>("EFORMSIGN_COMPANY_ID");
        this.EFORMSIGN_TEMPLATE_ID = this.configService.getOrThrow<string>("EFORMSIGN_TEMPLATE_ID");
    }

    /**
     * Generate eformsign signature using SHA256withECDSA
     * According to eformsign API docs:
     * - Uses asymmetric key with Elliptic Curve Cryptography
     * - Algorithm: SHA256withECDSA
     * - Message: execution_time as string (UTF-8)
     * - Output: hex string
     */
    generateSignature(executionTime: number): string {
        const message = String(executionTime);

        // Convert hex private key to DER format for crypto.sign
        const privateKeyHex = this.EFORMSIGN_PRIVATE_KEY;
        const privateKeyDer = Buffer.from(privateKeyHex, "hex");

        // Create private key object from DER format
        const privateKey = crypto.createPrivateKey({
            key: privateKeyDer,
            format: "der",
            type: "pkcs8",
        });

        // Sign with SHA256 and ECDSA
        const signature = crypto.sign(
            "sha256",
            Buffer.from(message, "utf-8"),
            privateKey
        );

        // Return as hex string
        return signature.toString("hex");
    }

    async getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse> {
        const signature = this.generateSignature(executionTime);
        const email = memberEmail || this.USER_EMAIL;

        // API key must be Base64 encoded according to eformsign docs
        const encodedApiKey = Buffer.from(this.EFORMSIGN_API_KEY).toString("base64");

        const response = await fetch(`${this.EFORMSIGN_API_URL}/v2.0/api_auth/access_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "eformsign_signature": signature,
                "Authorization": `Bearer ${encodedApiKey}`,
            },
            body: JSON.stringify({
                execution_time: executionTime,
                member_id: email,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get access token: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    async refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        const signature = this.generateSignature(executionTime);

        const response = await fetch(`${this.EFORMSIGN_API_URL}/v2.0/api_auth/refresh_token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "eformsign_signature": signature,
                "api_key": this.EFORMSIGN_API_KEY,
            },
            body: JSON.stringify({
                execution_time: executionTime,
                refresh_token: refreshToken,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to refresh token: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    generateDocumentOptions(contractData: ContractDataDto, accessToken: string, refreshToken: string, templateId?: string) {
        return {
            company: {
                id: this.EFORMSIGN_COMPANY_ID,
                country_code: "kr",
                user_key: this.USER_EMAIL,
            },
            layout: {
                "lang_code": "ko",
                "zoom": "0.75",
                "viewer_toolbar": {
                    "toolbar.save": "false",
                    "toolbar.print": "false",
                },
            },
            user: {
                type: "01",
                id: this.USER_EMAIL,
                access_token: accessToken,
                refresh_token: refreshToken,
            },
            mode: {
                type: "01",
                template_id: templateId || this.EFORMSIGN_TEMPLATE_ID,
            },
            prefill: {
                document_name: "산모신생아건강관리서비스 계약서",
                fields: [
                    { id: "이용자 성명", value: contractData.customerName },
                    { id: "이용자 생년월일", value: contractData.customerDOB },
                    { id: "이용자 주소", value: contractData.customerAddress },
                    { id: "계약 시작 년도", value: contractData.startYear },
                    { id: "계약 시작 월", value: contractData.startMonth },
                    { id: "계약 시작 일", value: contractData.startDay },
                    { id: "계약 종료 년도", value: contractData.endYear },
                    { id: "계약 종료 월", value: contractData.endMonth },
                    { id: "계약 종료 일", value: contractData.endDay },
                    { id: "서비스 비용", value: contractData.fullPrice },
                    { id: "정부지원금", value: contractData.grant },
                    { id: "본인부담금", value: contractData.actualPrice },
                    { id: "서비스 기간", value: contractData.days },
                    { id: "제공인력 1 성명", value: contractData.caretaker1Name },
                    { id: "제공인력 1 연락처", value: contractData.caretaker1Contact },
                    { id: "서비스 가격", value: contractData.fullPrice },
                    { id: "본인부담금 수령 년도", value: contractData.paymentYear },
                    { id: "본인부담금 수령 월", value: contractData.paymentMonth },
                    { id: "본인부담금 수령 일", value: contractData.paymentDay },
                    { id: "영수증 년도", value: contractData.receiptYear },
                    { id: "영수증 월", value: contractData.receiptMonth },
                    { id: "영수증 일", value: contractData.receiptDay },
                    { id: "서비스 기간", value: contractData.contractDuration },
                ],
                recipients: [
                    {
                        step_idx: "2",
                        step_type: "05",
                        name: contractData.customerName,
                        id: "",
                        sms: contractData.customerContact,
                        use_sms: true,
                    },
                ],
            },
            return_fields: [contractData.customerName],
        };
    }

    /**
     * Get in-progress documents (진행 중)
     * type: "01"
     */
    async getInProgressDocuments(accessToken: string): Promise<any> {
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "01",
                title_and_content: "",
                title: "",
                content: "",
                limit: "100",
                skip: "0"
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get in-progress documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get completed documents (완료)
     * type: "03"
     */
    async getCompletedDocuments(accessToken: string): Promise<any> {
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "03",
                title_and_content: "",
                title: "",
                content: "",
                limit: "100",
                skip: "0"
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get completed documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get rejected documents (반려/거부)
     * type: "04"
     */
    async getRejectedDocuments(accessToken: string): Promise<any> {
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "04",
                title_and_content: "",
                title: "",
                content: "",
                limit: "100",
                skip: "0"
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get rejected documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get single document by ID
     * GET /v2.0/api/documents/{documentId}
     */
    async getDocumentById(accessToken: string, documentId: string, signal?: AbortSignal): Promise<any> {
        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}?include_fields=true`,
            {
                method: "GET",
                signal,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get document: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Get all documents (combines in-progress, completed, and rejected)
     * Makes parallel requests for performance
     */
    async getAllDocuments(accessToken: string): Promise<{
        documents: any[];
        total_rows: number;
        limit: number;
        skip: number;
    }> {
        const [inProgress, completed, rejected] = await Promise.all([
            this.getInProgressDocuments(accessToken),
            this.getCompletedDocuments(accessToken),
            this.getRejectedDocuments(accessToken),
        ]);

        // Combine all documents
        const allDocuments = [
            ...(inProgress.documents || []),
            ...(completed.documents || []),
            ...(rejected.documents || []),
        ];

        // Remove duplicates by document id
        const seenIds = new Set<string>();
        let uniqueDocuments: any[] = [];
        for (const doc of allDocuments) {
            if (!seenIds.has(doc.id)) {
                seenIds.add(doc.id);
                uniqueDocuments.push(doc);
            }
        }

        try {
            // Select only visibility fields: mirror rows may have a null client_id.
            const mirrorDocuments = await this.prisma.eformsign_doc.findMany({
                where: { document_id: { in: [...seenIds] } },
                select: { document_id: true, status_type: true },
            });
            const deletedIds = new Set(mirrorDocuments
                .filter((doc) => isDeletedEformsignStatusCode(doc.status_type))
                .map((doc) => doc.document_id));
            uniqueDocuments = uniqueDocuments.filter((doc) => !deletedIds.has(doc.id));
        } catch {
            this.logger.warn("mirror deleted-filter skipped");
        }

        // Only provider review steps need the contract end date. Share a bounded
        // queue across five workers so large inboxes do not fan out detail calls.
        const reviewDocuments = uniqueDocuments.filter((doc) =>
            getStatusCategory(doc.current_status?.status_type) === "in-progress"
            && isProviderReviewWorkflowStep(doc.current_status),
        );
        const DETAIL_CONCURRENCY = 5;
        if (reviewDocuments.length > 0) {
            // Initialize queued documents too: the deadline may leave them unstarted.
            for (const doc of reviewDocuments) doc.contract_end_date = null;
            const controller = new AbortController();
            const deadline = Date.now() + CONTRACT_END_DATE_ENRICHMENT_BUDGET_MS;
            let nextDocument = 0;
            let settledDocuments = 0;
            let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
            const deadlineReached = new Promise<void>((resolve) => {
                deadlineTimer = setTimeout(() => {
                    controller.abort();
                    console.warn('Contract end-date enrichment timed out', {
                        unresolved: reviewDocuments.length - settledDocuments,
                        inFlight: nextDocument - settledDocuments,
                    });
                    resolve();
                }, CONTRACT_END_DATE_ENRICHMENT_BUDGET_MS);
            });
            const workers = Array.from(
                { length: Math.min(DETAIL_CONCURRENCY, reviewDocuments.length) },
                async () => {
                    while (!controller.signal.aborted && Date.now() < deadline
                        && nextDocument < reviewDocuments.length) {
                        const doc = reviewDocuments[nextDocument++];
                        try {
                            const detail = await this.getDocumentById(accessToken, doc.id, controller.signal);
                            // A late response must not mutate an already returned list.
                            if (controller.signal.aborted || Date.now() >= deadline) return;
                            const endDate = extractEformsignContractEndDate(detail);
                            doc.contract_end_date = endDate?.toISOString().slice(0, 10) ?? null;
                        } catch {
                            // Provider errors include response bodies; log only the id.
                            // Deadline aborts are covered by one summary above.
                            if (!controller.signal.aborted && Date.now() < deadline) console.warn(doc.id);
                        } finally {
                            settledDocuments++;
                        }
                    }
                },
            );
            try {
                // Do not wait for a provider/adapter that ignores cancellation.
                await Promise.race([Promise.all(workers), deadlineReached]);
            } finally {
                clearTimeout(deadlineTimer);
            }
        }

        // Sort by created_date descending (newest first)
        uniqueDocuments.sort((a, b) => b.created_date - a.created_date);

        return {
            documents: uniqueDocuments,
            total_rows: uniqueDocuments.length,
            limit: 100,
            skip: 0,
        };
    }
}
