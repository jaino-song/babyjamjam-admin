import { QueryClient, isServer } from "@tanstack/react-query";

// SSR-safe QueryClient factory
// - Server: Creates new instance per request (prevents state leakage)
// - Client: Uses singleton for consistent cache
function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
                gcTime: 1000 * 60 * 60, // 1시간 garbage collection
                retry: 1,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
    if (isServer) {
        // Server: 매 요청마다 새 인스턴스 생성
        return makeQueryClient();
    }
    // Client: 싱글톤 사용
    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
    }
    return browserQueryClient;
}

// 하위 호환성을 위한 기존 export 유지
export const queryClient = getQueryClient();