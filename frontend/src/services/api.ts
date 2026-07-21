import { api } from "../app/lib/axios/client";
import { ContractDataDto } from '@/backend/application/dto/contract.dto';
import { EformsignDocument, EformsignDocumentsResponse } from '@/app/lib/eformsign/types';

// Auth API
export const authApi = {
    kakaoLogin: () => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
        window.location.href = `${API_BASE_URL}/auth/kakao`;
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
    generateDocument: async (contractData: ContractDataDto) => {
        const { data } = await api.post('/generate-document', { contractData });
        return data;
    },
    // Documents APIs - token is read from httpOnly cookie on server
    // Unified endpoint - fetches all documents in single request (more efficient)
    getAllDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/documents');
        return data;
    },
    getInProgressDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/documents/in-progress');
        return data;
    },
    getCompletedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/documents/completed');
        return data;
    },
    getRejectedDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/documents/rejected');
        return data;
    },
    getDocument: async (documentId: string): Promise<EformsignDocument> => {
        const { data } = await api.get(`/documents/${documentId}`);
        return data;
    },
    // Legacy alias
    getDocuments: async (): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('/documents');
        return data;
    },
}
