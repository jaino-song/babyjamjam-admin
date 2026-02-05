import { api } from "../app/lib/axios/client";
import { ContractDataDto } from '@/backend/application/dto/contract.dto';
import { EformsignDocumentsResponse } from '@/app/lib/eformsign/types';

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

// Auth API
export const authApi = {
    kakaoLogin: () => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
        window.location.href = `${API_BASE_URL}/auth/kakao`;
    },

    // Email authentication
    register: async (email: string, password: string, name?: string): Promise<AuthResponse> => {
        const { data } = await api.post('/auth/register', { email, password, name });
        return data;
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
    refreshAccessToken: async (executionTime: number) => {
        const { data } = await api.post('/refresh-access-token', { executionTime });
        return data;
    },
    generateDocument: async (contractData: ContractDataDto, clientId?: number) => {
        const { data } = await api.post('/generate-document', { contractData, clientId });
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
    getAllDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents');
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
    // Legacy alias
    getDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/eformsign/documents');
        return data;
    },
}

export type AlimtalkProvider = 'aligo' | 'channeltalk' | 'none';

export interface AlimtalkProviderResponse {
    provider: AlimtalkProvider;
    enabled: boolean;
    updatedAt?: string;
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
}