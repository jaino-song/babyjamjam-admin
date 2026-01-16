import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/axios/client";
import { usePathname } from "next/navigation";

// User 타입 정의 (백엔드 응답 기반)
export interface AuthUser {
    id: string;
    name: string;
    email?: string;
    profile_image?: string;
    role?: string;
}

interface UseGetAuthUserOptions {
    // 서버에서 prefetch된 초기 데이터
    initialData?: AuthUser | null;
}

export const AUTH_USER_QUERY_KEY = ['authUser'] as const;

// 외부에서 사용할 수 있도록 queryFn export
export const fetchAuthUser = async (): Promise<AuthUser | null> => {
    const { data } = await api.get('/auth/me');
    return data || null;
};

export const useGetAuthUser = (options?: UseGetAuthUserOptions) => {
    const pathname = usePathname();
    const isLoginPage = pathname?.includes('/login');

    return useQuery({
        queryKey: AUTH_USER_QUERY_KEY,
        queryFn: fetchAuthUser,
        retry: false,
        staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
        gcTime: 1000 * 60 * 60, // 1시간
        enabled: !isLoginPage,
        // initialData가 있으면 바로 사용 (duplicate fetch 방지)
        initialData: options?.initialData ?? undefined,
        // initialData가 있으면 stale로 간주하지 않음
        initialDataUpdatedAt: options?.initialData ? Date.now() : undefined,
    });
}