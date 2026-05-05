import axios from "axios";
import { api } from "@/lib/api/client";
import { ContractDataDto } from '@/backend/application/dto/contract.dto';
import { EformsignDeleteDocumentsResponse, EformsignDocumentsResponse } from '@/lib/eformsign/types';

// Auth API response types
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

export interface PendingStaffCompletionItem {
    documentId: string;
    clientId: number;
    clientName: string;
    signedAt: string;
    statusDetail: string;
}

// Auth API
export const authApi = {
    kakaoLogin: () => {
        window.location.href = "/api/auth/kakao";
    },

    // Email authentication
    register: async (params: {
        email: string;
        password: string;
        name?: string;
        phone: string;
        birthDate: string;
        branchId: string;
        role: string;
    }): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/register', params);
        return data;
    },

    getBranches: async (): Promise<{ id: string; name: string }[]> => {
        const { data } = await api.get('/auth/branches/all');
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
    getDocument: async (documentId: string) => {
        const { data } = await api.get(`/eformsign/documents/${documentId}`);
        return data;
    },
    getLocalDocumentRecord: async (documentId: string) => {
        const { data } = await api.get(`/eformsign-docs/document-id`, {
            params: { documentId },
        });
        return data as { clientId?: number | null } | null;
    },
    generateDocument: async (contractData: ContractDataDto, clientId?: number) => {
        const { data } = await api.post('/generate-document', { contractData, clientId });
        return data;
    },
    generateStaffDocument: async (
        documentId: string,
        accessToken?: string,
        refreshToken?: string
    ) => {
        const { data } = await api.post('/generate-staff-document', {
            documentId,
            accessToken,
            refreshToken,
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
    // Documents APIs - token is read from httpOnly cookie on server
    // Note: eformsign routes use /eformsign prefix to avoid conflict with file storage /documents
    // Unified endpoint - fetches all documents in single request (more efficient)
    getAllDocuments: async (params?: { limit?: number; skip?: number; type?: string | null }): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents', { params });
        return data;
    },
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
    getPendingStaffCompletionDocs: async (): Promise<PendingStaffCompletionItem[]> => {
        const { data } = await api.get('/eformsign-docs/pending-staff-completion');
        return data;
    },
    getDocumentClientNames: async (): Promise<Array<{ documentId: string; clientName: string }>> => {
        const { data } = await api.get('/eformsign-docs/client-names');
        return data;
    },
}

export type AlimtalkProvider = 'aligo' | 'channeltalk' | 'none';

export interface AlimtalkProviderResponse {
    provider: AlimtalkProvider;
    enabled: boolean;
    updatedAt?: string;
}

export interface NotificationPreferencesResponse {
    emailNotificationsEnabled: boolean;
    updatedAt?: string;
}

export type MessageDeliverySmsType = "AUTO" | "SMS" | "LMS";
export type MessageDeliveryTriggerType = "immediate" | "scheduled";

export interface SendMessageDeliverySmsRequest {
    receiver: string;
    message: string;
    recipientName?: string;
    title?: string;
    msgType?: MessageDeliverySmsType;
    triggerType?: MessageDeliveryTriggerType;
    scheduledDate?: string;
    scheduledTime?: string;
    testMode?: boolean;
}

export interface SendMessageDeliverySmsResponse {
    provider: "aligo";
    triggerType: Exclude<MessageDeliveryTriggerType, undefined>;
    request: {
        receiver: string;
        msgType: "SMS" | "LMS";
        scheduledAt?: string;
        testMode: boolean;
    };
    result: {
        resultCode: number;
        message: string;
        msgId?: number;
        successCount?: number;
        errorCount?: number;
        msgType?: string;
    };
}

export interface RibbonConfig {
    enabled: boolean;
    message: string;
    backgroundColor: string;
    textColor: string;
    linkText: string;
    linkHref: string;
    linkColor: string;
}

export interface RibbonConfigResponse extends RibbonConfig {
    updatedAt?: string;
}

export interface ConsultationInquiry {
    id: string;
    branchId: string;
    publicBranchSlug: string;
    motherName: string;
    phone: string;
    address: string;
    dueDate: string;
    birthExperience: string;
    voucherType: string | null;
    preferredCaregiverName: string | null;
    referralSource: string;
    privacyAcceptedAt: string;
    selectedServices: ConsultationSelectedServices | null;
    source: string;
    status: string;
    readAt: string | null;
    createdAt: string;
    updatedAt: string;
    branchName?: string;
}

export interface ConsultationSelectedServices {
    plan: {
        id: string;
        name: string;
        priceLabel: string;
        durationDays: number | null;
    } | null;
    addons: Array<{
        id: string;
        name: string;
        priceLabel: string;
        quantity: number;
        group: string | null;
    }>;
}

export interface ConsultationInquiryListResponse {
    data: ConsultationInquiry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface ConsultationInquiryListParams {
    page?: number;
    limit?: number;
    search?: string;
    phone?: string;
    status?: string;
    readState?: string;
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
    getNotificationPreferences: async (): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.get('/settings/notification-preferences');
        return data;
    },
    updateNotificationPreferences: async (emailNotificationsEnabled: boolean): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.put('/settings/notification-preferences', { emailNotificationsEnabled });
        return data;
    },
    getRibbonConfig: async (): Promise<RibbonConfigResponse> => {
        const { data } = await api.get('/settings/ribbon-config');
        return data;
    },
    updateRibbonConfig: async (config: RibbonConfig): Promise<RibbonConfigResponse> => {
        const { data } = await api.put('/settings/ribbon-config', config);
        return data;
    },
}

export const consultationInquiriesApi = {
    list: async (params: ConsultationInquiryListParams = {}): Promise<ConsultationInquiryListResponse> => {
        const { data } = await api.get("/consultation-inquiries", { params });
        return data;
    },
    markRead: async (id: string): Promise<ConsultationInquiry> => {
        const { data } = await api.patch(`/consultation-inquiries/${id}/read`);
        return data;
    },
};

export const messageDeliveryApi = {
    sendSms: async (
        payload: SendMessageDeliverySmsRequest
    ): Promise<SendMessageDeliverySmsResponse> => {
        try {
            const { data } = await api.post("/message-deliveries/sms", payload);
            return data;
        } catch (error) {
            if (axios.isAxiosError<{ error?: string; message?: string }>(error)) {
                const message =
                    error.response?.data?.error
                    || error.response?.data?.message
                    || error.message;
                throw new Error(message);
            }

            throw error;
        }
    },
};
