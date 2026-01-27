import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import * as https from "https";
import { ContractDataDto } from "../dto/contract.dto";

export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
}

@Injectable()
export class EformsignService {
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string;
    private readonly EFORMSIGN_DOC_API_URL: string;
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly EFORMSIGN_TEMPLATE_ID: string;

    constructor(private configService: ConfigService) {
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
                    { id: "이용자 성명", value: contractData.customerName, enabled: true },
                    { id: "이용자 생년월일", value: '', enabled: true },
                    { id: "이용자 주소", value: '', enabled: true },
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
    async getDocumentById(accessToken: string, documentId: string): Promise<any> {
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
        });

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
        const uniqueDocuments: any[] = [];
        for (const doc of allDocuments) {
            if (!seenIds.has(doc.id)) {
                seenIds.add(doc.id);
                uniqueDocuments.push(doc);
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