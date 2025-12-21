import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
    IEformsignClientRepository,
    EformsignTokenResponse,
    EformsignApiDocumentResponse,
    EformsignApiListResponse,
} from "domain/repositories/eformsign.client.interface";

/**
 * Infrastructure repository that calls eformsign external API.
 * Uses EFORMSIGN_DOC_API_URL for document-related calls (not token endpoints).
 */
@Injectable()
export class EformsignApiClient implements IEformsignClientRepository {
    private readonly USER_EMAIL: string;
    private readonly EFORMSIGN_API_URL: string; // base for token endpoints
    private readonly EFORMSIGN_DOC_API_URL: string; // for document endpoints (kr-api)
    private readonly EFORMSIGN_API_KEY: string;
    private readonly EFORMSIGN_PRIVATE_KEY: string;

    constructor(private configService: ConfigService) {
        this.USER_EMAIL = this.configService.get<string>("EFORMSIGN_USER_EMAIL");
        this.EFORMSIGN_API_URL = this.configService.get<string>("EFORMSIGN_API_URL");
        this.EFORMSIGN_DOC_API_URL = this.configService.get<string>("EFORMSIGN_DOC_API_URL");
        this.EFORMSIGN_API_KEY = this.configService.get<string>("EFORMSIGN_API_KEY");
        this.EFORMSIGN_PRIVATE_KEY = this.configService.get<string>("EFORMSIGN_PRIVATE_KEY");
    }

    /**
     * Generate eformsign signature using SHA256withECDSA
     */
    private generateSignature(executionTime: number): string {
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
     * Get all documents from eformsign API (uses DOC API URL)
     * POST /v2.0/api/list_documents
     */
    async getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        const response = await fetch(`${this.EFORMSIGN_DOC_API_URL}/v2.0/api/list_documents`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
                type: "all", // get all document types
                limit: 100,
                skip: 0,
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Failed to get documents list: ${response.status} - ${errorData}`);
        }

        const data: EformsignApiListResponse = await response.json();
        return data.documents || [];
    }

    /**
     * Get single document info from eformsign API (uses DOC API URL)
     * GET /v2.0/api/documents/{DOCUMENT_ID}
     */
    async getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
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
}

