import { Injectable, Logger } from "@nestjs/common";
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
    private readonly logger = new Logger(EformsignService.name);
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string;
    private readonly EFORMSIGN_DOC_API_URL: string;
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly EFORMSIGN_TEMPLATE_ID: string;
    private readonly isConfigured: boolean;

    constructor(private configService: ConfigService) {
        this.USER_EMAIL = this.configService.get<string>("EFORMSIGN_USER_EMAIL") || "";
        this.EFORMSIGN_API_URL = this.configService.get<string>("EFORMSIGN_API_URL") || "";
        this.EFORMSIGN_DOC_API_URL = this.configService.get<string>("EFORMSIGN_DOC_API_URL") || "";
        this.EFORMSIGN_API_KEY = this.configService.get<string>("EFORMSIGN_API_KEY") || "";
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get<string>("EFORMSIGN_PRIVATE_KEY") || "";
        this.EFORMSIGN_COMPANY_ID = this.configService.get<string>("EFORMSIGN_COMPANY_ID") || "";
        this.EFORMSIGN_TEMPLATE_ID = this.configService.get<string>("EFORMSIGN_TEMPLATE_ID") || "";
        this.isConfigured = Boolean(
            this.USER_EMAIL &&
            this.EFORMSIGN_API_URL &&
            this.EFORMSIGN_DOC_API_URL &&
            this.EFORMSIGN_API_KEY &&
            this.EFORMSIGN_PRIVATE_KEY &&
            this.EFORMSIGN_COMPANY_ID &&
            this.EFORMSIGN_TEMPLATE_ID,
        );

        if (!this.isConfigured) {
            this.logger.warn("Eformsign environment variables are not fully configured. Eformsign features will be disabled.");
        }
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
        this.assertConfigured();
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
        this.assertConfigured();
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
        this.assertConfigured();
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
        this.assertConfigured();
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
                    { id: "이용자 주소", value: contractData.customerAddress, enabled: true },
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
                    {
                        step_idx: "3",
                        step_type: "01",
                        name: "제공기관 확인",
                        id: this.USER_EMAIL,
                        use_mail: false,
                        use_sms: false,
                    },
                ],
            },
            return_fields: [contractData.customerName],
        };
    }

    generateStaffCompletionOptions(documentId: string, accessToken: string, refreshToken: string) {
        this.assertConfigured();
        return {
            company: {
                id: this.EFORMSIGN_COMPANY_ID,
                country_code: "kr",
                user_key: this.USER_EMAIL,
            },
            layout: {
                lang_code: "ko",
                zoom: "0.75",
                viewer_toolbar: {
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
                type: "02",
                document_id: documentId,
            },
        };
    }

    /**
     * Get in-progress documents (진행 중)
     * type: "01"
     */
    async getInProgressDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        this.assertConfigured();
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
                limit: String(limit),
                skip: String(skip)
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
    async getCompletedDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        this.assertConfigured();
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
                limit: String(limit),
                skip: String(skip)
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
    async getRejectedDocuments(accessToken: string, limit = 100, skip = 0): Promise<any> {
        this.assertConfigured();
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
                limit: String(limit),
                skip: String(skip)
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
        this.assertConfigured();
        const includeParams = new URLSearchParams({
            include_fields: "true",
            include_histories: "true",
            include_previous_status: "true",
            include_next_status: "true",
            include_external_token: "true",
            include_detail_template_info: "true",
        });

        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}?${includeParams.toString()}`,
            {
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
     * Download document PDF or audit trail PDF
     * GET /v2.0/api/documents/{documentId}/download_files?file_type=document|audit_trail
     */
    async downloadDocumentFile(
        accessToken: string,
        documentId: string,
        fileType: "document" | "audit_trail" = "document"
    ): Promise<{
        status: number;
        contentType: string;
        contentDisposition: string | null;
        body: Buffer;
    }> {
        this.assertConfigured();
        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}/download_files?file_type=${fileType}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                },
            }
        );

        const body = Buffer.from(await response.arrayBuffer());

        return {
            status: response.status,
            contentType: response.headers.get("content-type") || "application/octet-stream",
            contentDisposition: response.headers.get("content-disposition"),
            body,
        };
    }

    /**
     * Get all documents (combines in-progress, completed, and rejected)
     * Makes parallel requests for performance
     */
    async getAllDocuments(accessToken: string, limit = 100, skip = 0): Promise<{
        documents: any[];
        total_rows: number;
        limit: number;
        skip: number;
    }> {
        this.assertConfigured();
        const [inProgress, completed, rejected] = await Promise.all([
            this.getInProgressDocuments(accessToken, limit, skip),
            this.getCompletedDocuments(accessToken, limit, skip),
            this.getRejectedDocuments(accessToken, limit, skip),
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

        // Sort by createdDate descending (newest first)
        uniqueDocuments.sort((a, b) => b.createdDate - a.createdDate);

        return {
            documents: uniqueDocuments,
            total_rows: uniqueDocuments.length,
            limit,
            skip,
        };
    }

    /**
     * Delete one or more documents
     * DELETE /v2.0/api/documents
     * @param accessToken - eformsign access token
     * @param documentIds - array of document IDs to delete
     * @param isPermanent - whether to permanently delete (default: false)
     */
    async deleteDocuments(
        accessToken: string,
        documentIds: string[],
        isPermanent: boolean = false
    ): Promise<any> {
        this.assertConfigured();
        const url = new URL(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents`);
        if (isPermanent) {
            url.searchParams.set("is_permanent", "true");
        }

        const response = await fetch(url.toString(), {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                document_ids: documentIds,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to delete documents: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    /**
     * Re-request a document for the current outsider recipient.
     * Reuses the existing recipient settings by omitting recipients from next_steps.
     */
    async reRequestOutsiderDocument(
        accessToken: string,
        documentId: string,
        stepType: string,
        stepSeq: string,
        comment: string = "재요청입니다.",
        recipientPhone?: {
            countryCode?: string;
            phoneNumber?: string;
        }
    ): Promise<any> {
        this.assertConfigured();
        const nextStep: {
            step_type: string;
            step_seq: string;
            comment: string;
            recipients?: Array<{
                member?: {
                    name?: string;
                    id?: string;
                    sms?: {
                        country_code: string;
                        phone_number: string;
                    };
                };
                use_mail: boolean;
                use_sms: boolean;
            }>;
        } = {
            step_type: stepType,
            step_seq: stepSeq,
            comment,
        };

        if (recipientPhone) {
            const document = await this.getDocumentById(accessToken, documentId);
            const currentRecipient = document?.current_status?.step_recipients?.[0];

            if (!currentRecipient) {
                throw new Error("Failed to determine the current recipient for phone override");
            }

            const member: {
                name?: string;
                id?: string;
                sms?: {
                    country_code: string;
                    phone_number: string;
                };
            } = {};

            if (currentRecipient?.name) {
                member.name = currentRecipient.name;
            }

            if (currentRecipient?.id) {
                member.id = currentRecipient.id;
            }

            member.sms = {
                country_code: recipientPhone.countryCode ?? "+82",
                phone_number: recipientPhone.phoneNumber ?? "",
            };

            const recipientConfig: {
                member?: typeof member;
                use_mail: boolean;
                use_sms: boolean;
            } = {
                use_mail: Boolean(currentRecipient?.id),
                use_sms: true,
            };

            if (member.name || member.id || member.sms) {
                recipientConfig.member = member;
            }

            nextStep.recipients = [recipientConfig];
        }

        const response = await fetch(
            `${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents/${documentId}/re_request_outsider`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                    input: {
                        next_steps: [nextStep],
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to re-request document: ${response.status} - ${errorData}`);
        }

        return await response.json();
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Eformsign integration is not configured.");
        }
    }
}
