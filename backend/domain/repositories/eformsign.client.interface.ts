/**
 * Raw API response types from eformsign API
 */
export interface EformsignApiDocumentResponse {
    id: string;
    document_number: string;
    template: {
        id: string;
        name: string;
    };
    document_name: string;
    creator: {
        recipient_type: string;
        id: string;
        name: string;
    };
    created_date: number; // epoch ms
    updated_date: number; // epoch ms
    current_status: {
        status_type: string;
        status_doc_type: string;
        status_doc_detail: string;
        step_type: string;
        step_index: string;
        step_name: string;
        step_recipients: Array<{
            recipient_type: string;
            id: string;
            name: string;
        }>;
        step_group: number;
        expired_date: number; // epoch ms
        _expired: boolean;
    };
    fields?: Array<{
        id: string;
        value: string;
        type: string;
    }>;
}

export interface EformsignApiListResponse {
    documents: EformsignApiDocumentResponse[];
    total_count: number;
}

export interface EformsignTokenResponse {
    oauth_token: {
        access_token: string;
        refresh_token: string;
    };
    api_key?: {
        company: {
            api_url: string;
        };
    };
}

export interface CreateDocumentPayload {
    templateId: string;
    documentName: string;
    prefillFields: Array<{ id: string; value: string }>;
    recipient: {
        name: string;
        sms: string;
    };
}

export interface CreateDocumentResponse {
    documentId: string;
    status: string;
}

/**
 * Repository interface for calling eformsign external API
 * (NOT for local DB persistence — use IEformsignDocRepository for that)
 */
export interface IEformsignClientRepository {
    getAccessToken(executionTime: number, memberEmail?: string): Promise<EformsignTokenResponse>;
    refreshAccessToken(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse>;
    getAllDocuments(accessToken: string): Promise<EformsignApiDocumentResponse[]>;
    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse>;
    createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse>;
}

export const EFORMSIGN_CLIENT_REPOSITORY = "EFORMSIGN_CLIENT_REPOSITORY";