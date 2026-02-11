import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/axios/client";
import { usePathname } from "next/navigation";
import { isPublicAuthPath } from "@/app/lib/auth/routes";

// User 타입 정의 (백엔드 응답 기반)
export interface AuthUser {
    id: string;
    name: string;
    email?: string;
    profileImage?: string;
    role?: string;
    organizationName?: string | null;
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

const E2E_USER: AuthUser = {
    id: 'e2e-user',
    name: 'E2E Tester',
    email: 'e2e@example.com',
    profileImage: '',
    role: 'admin',
};

export const useGetAuthUser = (options?: UseGetAuthUserOptions) => {
    const pathname = usePathname();
    // Disable auth query on public auth pages (login, register, forgot-password, etc.)
    const isAuthPage = isPublicAuthPath(pathname);
    const isE2E = process.env.NEXT_PUBLIC_E2E_TEST === 'true'
        || (typeof window !== 'undefined' && (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__);

    return useQuery({
        queryKey: AUTH_USER_QUERY_KEY,
        queryFn: isE2E ? async () => E2E_USER : fetchAuthUser,
        retry: false,
        staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
        gcTime: 1000 * 60 * 60, // 1시간
        enabled: isE2E ? true : !isAuthPage,
        // initialData가 있으면 바로 사용 (duplicate fetch 방지)
        initialData: options?.initialData ?? (isE2E ? E2E_USER : undefined),
        // initialData가 있으면 stale로 간주하지 않음
        initialDataUpdatedAt: options?.initialData || isE2E ? Date.now() : undefined,
    });
}
