import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
    IEformsignClientRepository,
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
    CreateDocumentPayload,
    CreateDocumentResponse,
} from "domain/repositories/eformsign.client.interface";

/**
 * Infrastructure repository that calls eformsign external API.
 * Uses EFORMSIGN_DOC_API_URL for document-related calls (not token endpoints).
 */
@Injectable()
export class EformsignApiClient implements IEformsignClientRepository {
    private readonly logger = new Logger(EformsignApiClient.name);
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string; // base for token endpoints
    private readonly EFORMSIGN_DOC_API_URL: string; // for document endpoints (kr-api)
    private readonly EFORMSIGN_SERVICE_URL: string; // for member document actions (kr-service)
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;
    private readonly EFORMSIGN_COMPANY_ID: string;
    private readonly isConfigured: boolean;

    constructor(private configService: ConfigService) {
        this.USER_EMAIL = this.configService.get<string>("EFORMSIGN_USER_EMAIL") || "";
        this.EFORMSIGN_API_URL = this.configService.get<string>("EFORMSIGN_API_URL") || "";
        this.EFORMSIGN_DOC_API_URL = this.configService.get<string>("EFORMSIGN_DOC_API_URL") || "";
        this.EFORMSIGN_SERVICE_URL = this.deriveServiceUrl(this.EFORMSIGN_DOC_API_URL);
        this.EFORMSIGN_API_KEY = this.configService.get<string>("EFORMSIGN_API_KEY") || "";
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get<string>("EFORMSIGN_PRIVATE_KEY") || "";
        this.EFORMSIGN_COMPANY_ID = this.configService.get<string>("EFORMSIGN_COMPANY_ID") || "";
        this.isConfigured = Boolean(
            this.USER_EMAIL &&
            this.EFORMSIGN_API_URL &&
            this.EFORMSIGN_DOC_API_URL &&
            this.EFORMSIGN_SERVICE_URL &&
            this.EFORMSIGN_API_KEY &&
            this.EFORMSIGN_PRIVATE_KEY &&
            this.EFORMSIGN_COMPANY_ID,
        );

        if (!this.isConfigured) {
            this.logger.warn("Eformsign API env vars are not fully configured. Eformsign API client will be disabled.");
        }
    }

    /**
     * Generate eformsign signature using SHA256withECDSA
     */
    private generateSignature(executionTime: number): string {
        this.assertConfigured();
        const message = String(executionTime);
        const privateKeyDer = Buffer.from(this.EFORMSIGN_PRIVATE_KEY, "hex");

        const privateKey = crypto.createPrivateKey({
            key: privateKeyDer,
            format: "der",
            type: "pkcs8",
        });

        const signature = crypto.sign(
            "sha256",
            Buffer.from(message, "utf-8"),
            privateKey
        );

        return signature.toString("hex");
    }

    /**
     * Get access token from eformsign API (uses base API URL)
     * POST /v2.0/api_auth/access_token
     */
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

    /**
     * Refresh access token from eformsign API (uses base API URL)
     * POST /v2.0/api_auth/refresh_token
     */
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

    /**
     * Get in-progress documents from eformsign API (uses DOC API URL)
     * POST /v2.0/api/list_document with type: "01"
     */
    async getInProgressDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
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
                limit: "100",
                skip: "0",
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get in-progress documents: ${response.status} - ${errorData}`);
        }

        const data: EformsignApiListResponse = await response.json();
        return data.documents || [];
    }

    /**
     * Get completed documents from eformsign API (uses DOC API URL)
     * POST /v2.0/api/list_document with type: "03"
     */
    async getCompletedDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
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
                limit: "100",
                skip: "0",
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get completed documents: ${response.status} - ${errorData}`);
        }

        const data: EformsignApiListResponse = await response.json();
        return data.documents || [];
    }

    /**
     * Get all documents (both in-progress and completed)
     */
    async getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        this.assertConfigured();
        const [inProgress, completed] = await Promise.all([
            this.getInProgressDocuments(accessToken),
            this.getCompletedDocuments(accessToken),
        ]);
        return [...inProgress, ...completed];
    }

    /**
     * Get single document info from eformsign API (uses DOC API URL)
     * GET /v2.0/api/documents/{DOCUMENT_ID}
     */
    async getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
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

    async approveDocument(accessToken: string, documentId: string, comment: string = ""): Promise<void> {
        this.assertConfigured();

        const document = await this.getDocument(accessToken, documentId);
        const currentStepType = document.current_status?.step_type;
        const currentDocumentStep = document.current_status?.step_index;

        if (!currentStepType || !currentDocumentStep) {
            throw new Error(`Document ${documentId} is missing current status information`);
        }

        const approvalType =
            currentStepType === "06"
                ? "reviewers"
                : currentStepType === "05"
                    ? "participants"
                    : null;

        if (!approvalType) {
            throw new Error(`Document ${documentId} is not in a participant/reviewer step`);
        }

        const nextSteps =
            document.next_status?.map((step) => ({
                step_type: step.step_type,
                ...(step.step_seq || step.step_index
                    ? { step_id: step.step_seq ?? step.step_index }
                    : {}),
                comment,
            })) ?? [];

        const requestBody = {
            input: {
                title: document.document_name,
                title_changed_by_user: false,
                current_document_step: currentDocumentStep,
                next_steps: nextSteps.length ? nextSteps : [{ step_type: "01", comment }],
            },
        };

        const response = await fetch(
            this.buildServiceDocumentUrl(documentId, `/${approvalType}/${encodeURIComponent(this.USER_EMAIL)}/send`),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            this.logger.error(`Failed to approve document ${documentId}: ${response.status} - ${errorData}`);
            throw new Error(`Failed to approve document: ${response.status} - ${errorData}`);
        }
    }

    async createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse> {
        this.assertConfigured();
        const requestBody = {
            template_id: payload.templateId,
            document: {
                document_name: payload.documentName,
                fields: payload.prefillFields.map(f => ({
                    id: f.id,
                    value: f.value,
                })),
                recipients: [
                    {
                        step_idx: "2",
                        step_type: "05",
                        name: payload.recipient.name,
                        id: "",
                        sms: payload.recipient.sms,
                        use_sms: true,
                    },
                ],
            },
        };

        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/documents`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to create document: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        return {
            documentId: data.document_id || data.id,
            status: data.status || "created",
        };
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Eformsign integration is not configured.");
        }
    }

    private deriveServiceUrl(docApiUrl: string): string {
        if (!docApiUrl) {
            return "";
        }

        try {
            const url = new URL(docApiUrl);
            const serviceHost = url.hostname.replace("-api.", "-service.");
            if (serviceHost === url.hostname) {
                return "";
            }

            url.hostname = serviceHost;
            return url.origin;
        } catch {
            return "";
        }
    }

    private buildServiceDocumentUrl(documentId: string, suffix: string = ""): string {
        return `${this.EFORMSIGN_SERVICE_URL}/v1/companies/${this.EFORMSIGN_COMPANY_ID}/documents/${documentId}${suffix}`;
    }
}
