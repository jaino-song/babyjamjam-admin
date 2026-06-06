import { api } from "@/lib/api/client";
import { PUBLIC_BACKEND_BASE_URL } from "@/lib/env";
import { EformsignDeleteDocumentsResponse, EformsignDocumentsResponse } from "@/lib/eformsign/types";
import { safeStorageSetItem } from "@/lib/safe-storage";
import { isAxiosError } from "axios";

export interface ContractDataDto {
  customerName: string;
  customerContact: string;
  customerDOB: string;
  customerAddress: string;
  caretaker1Name: string;
  caretaker1Contact: string;
  type: string;
  days: string;
  area: string;
  contractDuration: string;
  startYear: string;
  startMonth: string;
  startDay: string;
  startDate: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  endDate: string;
  paymentYear: string;
  paymentMonth: string;
  paymentDay: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
}

const HEADLESS_DISPATCH_TIMEOUT_MS = 180_000;
const HEADLESS_FINALIZE_TIMEOUT_MS = 60_000;

// Auth API response types
export interface HeadlessDispatchResponse {
    ok: boolean;
    documentId?: string;
    durationMs: number;
    reason?: string;
    failedStep?: string;
    fallbackHint?: "iframe";
}

export interface FinalizeHeadlessResponse {
    ok: boolean;
    durationMs: number;
    reason?: string;
    failedStep?: string;
    fallbackHint?: "iframe";
}

export interface AuthResponse {
    success: boolean;
    message?: string;
    code?: string;
    hasKakaoAccount?: boolean;
    errors?: string[];
}

export interface LoginResponse extends AuthResponse {
    accessToken?: string;
    refreshToken?: string;
    user?: string;
}

export interface EformsignAuthStatusResponse {
    hasAppAuthToken: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
}

export interface EformsignDocClientSummary {
    documentId: string;
    clientId: number;
    clientName: string;
    clientPhone: string | null;
    providerName: string | null;
}

export interface SyncedEformsignDocResponse {
    id?: number;
    documentId: string;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepIndex: string;
    stepName: string;
    expired?: boolean;
}

// Auth API
export const authApi = {
    kakaoLogin: () => {
        window.location.href = `${PUBLIC_BACKEND_BASE_URL}/auth/kakao`;
    },

    // Email authentication
    register: async (email: string, password: string, name?: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/register', { email, password, name });
        return data;
    },

    checkEmailExists: async (email: string): Promise<{ exists: boolean; linkable: boolean }> => {
        const { data } = await api.get('/auth/check-email', {
            params: { email },
        });
        return {
            exists: data?.exists === true,
            linkable: data?.linkable === true,
        };
    },

    login: async (email: string, password: string): Promise<LoginResponse> => {
        const { data } = await api.post('/auth/login', { email, password });
        return data;
    },

    verifyEmail: async (token: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/verify-email', { token });
        return data;
    },

    forgotPassword: async (email: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/forgot-password', { email });
        return data;
    },

    resetPassword: async (token: string, newPassword: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/reset-password', { token, newPassword });
        return data;
    },

    resendVerification: async (email: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/resend-verification', { email });
        return data;
    },

    linkPassword: async (password: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/link-password', { password });
        return data;
    },
};

// eformsign APIs
// Note: axios client baseURL is '/api', so paths here should NOT include '/api/' prefix
export const eformsignApi = {
    generateSignature: async (executionTime: number) => {
        const { data } = await api.post('/generate-signature', { executionTime });
        return data;
    },
    // Authenticates and stores token in httpOnly cookie (returns { success: true })
    authenticate: async (executionTime: number, memberEmail?: string): Promise<{ success: boolean }> => {
        const { data } = await api.post('/access-token', { executionTime, memberEmail });
        return data;
    },
    getAuthStatus: async (): Promise<EformsignAuthStatusResponse> => {
        const { data } = await api.get('/eformsign/auth-status');
        return data;
    },
    refreshAccessToken: async (executionTime: number) => {
        const { data } = await api.post('/refresh-access-token', { executionTime });
        return data;
    },
    reRequestDocument: async (
        documentId: string,
        params: {
            stepType: string;
            stepSeq: string;
            comment?: string;
            recipientPhone?: {
                countryCode: string;
                phoneNumber: string;
            };
        }
    ): Promise<{ status?: string; code?: string; message?: string }> => {
        const { data } = await api.post(`/eformsign/documents/${documentId}/re-request`, params);
        return data;
    },
    generateDocument: async (contractData: ContractDataDto, clientId?: number) => {
        const { data } = await api.post('/generate-document', { contractData, clientId });
        return data;
    },
    // BJJ-90: backend-driven creation dispatch. Drives the eformsign iframe gate sequence
    // (mode:"01") via headless Chromium so staff don't see the iframe. Returns ok:false
    // with reason on any failure so the caller can fall back to the legacy iframe modal.
    dispatchHeadless: async (
        contractData: ContractDataDto,
        clientId?: number,
        progressId?: string,
    ): Promise<HeadlessDispatchResponse> => {
        const { data } = await api.post('/eformsign-docs/dispatch-headless', {
            contractData,
            clientId,
            progressId,
        }, {
            timeout: HEADLESS_DISPATCH_TIMEOUT_MS,
        });
        return data;
    },
    // Staff completion (mode:"02") — builds iframe options for the staff finalize step.
    generateStaffDocument: async (
        documentId: string,
        accessToken?: string,
        refreshToken?: string,
        prefillEndDate?: string,
    ) => {
        const { data } = await api.post('/generate-staff-document', {
            documentId,
            accessToken,
            refreshToken,
            prefillEndDate,
        });
        return data;
    },
    // BJJ-90: backend-driven finalize. Drives the mode:"02" iframe gate sequence
    // via headless Chromium. Falls back to iframe (generateStaffDocument) on ok:false.
    finalizeHeadless: async (
        documentId: string,
        prefillEndDate?: string,
        progressId?: string,
    ): Promise<FinalizeHeadlessResponse> => {
        const { data } = await api.post('/eformsign-docs/finalize-headless', {
            documentId,
            prefillEndDate,
            progressId,
        }, {
            timeout: HEADLESS_FINALIZE_TIMEOUT_MS,
        });
        return data;
    },
    // Create eformsign doc record to track document in local DB
    createDocRecord: async (params: {
        documentId: string;
        clientId: number;
        statusType: string;
        statusDetail: string;
        stepType: string;
        stepIndex: string;
        stepName: string;
        stepRecipientType: string;
        stepRecipientName: string;
        stepRecipientSms: string;
        expiredDate: string;
        linkToClient?: boolean; // If true, also update client.e_doc_id
    }) => {
        const { data } = await api.post('/eformsign-docs', params);
        return data;
    },
    getDocumentClientNames: async (): Promise<EformsignDocClientSummary[]> => {
        const { data } = await api.get('/eformsign-docs/client-names');
        return data;
    },
    syncDocumentStatus: async (documentId: string): Promise<SyncedEformsignDocResponse> => {
        const { data } = await api.post('/eformsign-docs/sync-status', { documentId });
        return data;
    },
    // Documents APIs - token is read from httpOnly cookie on server
    // Note: eformsign routes use /eformsign prefix to avoid conflict with file storage /documents
    // Unified endpoint - fetches all documents in single request (more efficient)
    getAllDocuments: async (params?: { limit?: number; skip?: number }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents', { params });
        return data;
    },
    getDocument: async (documentId: string): Promise<EformsignDocumentsResponse["documents"][number]> => {
        const { data } = await api.get(`/eformsign/documents/${documentId}`);
        return data;
    },
    getDocumentDownloadUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document`,
    getDocumentReceiptDownloadUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document&page=7`,
    getDocumentPreviewUrl: (documentId: string): string =>
        `/api/eformsign/documents/${encodeURIComponent(documentId)}/download_files?fileType=document#toolbar=0`,
    getInProgressDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents/in-progress');
        return data;
    },
    getCompletedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents/completed');
        return data;
    },
    getRejectedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents/rejected');
        return data;
    },
    deleteDocuments: async (
        documentIds: string[],
        isPermanent: boolean = false
    ): Promise<EformsignDeleteDocumentsResponse> => {
        const { data } = await api.delete('/eformsign/documents', {
            params: { is_permanent: isPermanent },
            data: { document_ids: documentIds },
        });
        return data;
    },
    deleteDocument: async (
        documentId: string,
        isPermanent: boolean = false
    ): Promise<EformsignDeleteDocumentsResponse> => {
        return eformsignApi.deleteDocuments([documentId], isPermanent);
    },
    // Legacy alias
    getDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents');
        return data;
    },
}

/**
 * Wraps an eformsign API call with automatic re-authentication on 401/403.
 * 
 * Flow:
 * 1. Execute the API call
 * 2. If it fails with 401/403 (after axios interceptor's token refresh also failed),
 *    attempt a full re-authentication from scratch
 * 3. Retry the original call once with the fresh token
 * 4. If re-auth or retry fails, throw the original error
 */
export async function withEformsignReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (!isAxiosError(error)) throw error;

        const status = error.response?.status;
        if (status === 401 || status === 403) {
            try {
                const executionTime = Date.now();
                await eformsignApi.authenticate(executionTime);
                safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
                return await fn();
            } catch {
                throw error;
            }
        }
        throw error;
    }
}

export type AlimtalkProvider = 'aligo' | 'channeltalk' | 'none';

export type MessageSenderApprovalStatus = "not_requested" | "pending" | "approved";

export interface AlimtalkProviderResponse {
    provider: AlimtalkProvider;
    enabled: boolean;
    updatedAt?: string;
}

export interface MessageSenderApprovalResponse {
    senderPhone: string | null;
    senderPhoneFormatted: string | null;
    approvalStatus: MessageSenderApprovalStatus;
    isApproved: boolean;
    canRequest: boolean;
    requestedAt: string | null;
    approvedAt: string | null;
}

export const settingsApi = {
    getAlimtalkProvider: async (): Promise<AlimtalkProviderResponse> => {
        const { data } = await api.get('/settings/alimtalk-provider');
        return data;
    },
    updateAlimtalkProvider: async (provider: AlimtalkProvider): Promise<AlimtalkProviderResponse> => {
        const { data } = await api.put('/settings/alimtalk-provider', { provider });
        return data;
    },
    getMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.get("/settings/message-sender-approval");
        return data;
    },
    requestMessageSenderApproval: async (senderPhone: string): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.post("/settings/message-sender-approval", { senderPhone });
        return data;
    },
}
