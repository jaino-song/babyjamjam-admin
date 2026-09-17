import { api } from "@/lib/api/client";

import type { RegisterRequest } from "@babyjamjam/shared";

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
        window.location.href = "/api/auth/kakao";
    },

    // Email authentication
    register: async (params: RegisterRequest): Promise<AuthResponse> => {
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
