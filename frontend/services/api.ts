import { api } from "../app/lib/axios/client";
import { ContractDataDto } from '@/backend/application/dto/contract.dto';
import { EformsignDocumentsResponse } from '@/app/lib/eformsign/types';

// Auth API
export const authApi = {
    kakaoLogin: () => {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
        window.location.href = `${API_BASE_URL}/auth/kakao`;
    },
};

// eformsign APIs
export const eformsignApi = {
    generateSignature: async (executionTime: number) => {
        const { data } = await api.post('api/generate-signature', { executionTime });
        return data;
    },
    getAccessToken: async (executionTime: number, memberEmail?: string) => {
        const { data } = await api.post('api/access-token', { executionTime, memberEmail });
        return data;
    },
    refreshAccessToken: async (executionTime: number, refreshToken: string) => {
        const { data } = await api.post('api/refresh-access-token', { executionTime, refreshToken });
        return data;
    },
    generateDocument: async (contractData: ContractDataDto, accessToken: string, refreshToken: string) => {
        const { data } = await api.post('api/generate-document', { contractData, accessToken, refreshToken });
        return data;
    },
    getDocuments: async (accessToken: string): Promise<EformsignDocumentsResponse> => {
        const { data } = await api.get('api/documents', { params: { accessToken } });
        return data;
    },
}