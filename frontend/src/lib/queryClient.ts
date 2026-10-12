import { QueryClient, isServer } from "@tanstack/react-query";

// 조회 실패는 최대 3번 자동 재시도한다(총 4회 시도). 그래도 실패하면 화면이
// "불러오지 못했습니다" + [다시 시도] 상태로 넘어간다.
const MAX_QUERY_RETRIES = 3;

function getResponseStatus(error: unknown): number | undefined {
    const status = (error as { response?: { status?: unknown } } | null | undefined)
        ?.response?.status;
    return typeof status === "number" ? status : undefined;
}

// 재시도는 "다시 해보면 성공할 수 있는" 오류에만 한다:
// 응답이 없는 네트워크 단절, 408(요청 시간 초과), 5xx.
// 그 외 4xx(401/403/404/409/422/429 등)는 재시도해도 같은 결과이거나
// (429는 오히려 제한을 깊게 하고) 오류 표시만 늦출 뿐이므로 재시도하지 않는다.
function isRetryableStatus(status: number | undefined): boolean {
    return status === undefined || status === 408 || status >= 500;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (!isRetryableStatus(getResponseStatus(error))) {
        return false;
    }
    return failureCount < MAX_QUERY_RETRIES;
}

// 1초 → 2초 → 4초(상한). 3번 재시도해도 약 7초 안에 오류 상태가 나타난다.
export function getQueryRetryDelay(failureCount: number): number {
    return Math.min(1000 * 2 ** failureCount, 4000);
}

// SSR-safe QueryClient factory
// - Server: Creates new instance per request (prevents state leakage)
// - Client: Uses singleton for consistent cache
function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 1000 * 60 * 30, // 30분 (성능 최적화)
                gcTime: 1000 * 60 * 60, // 1시간 garbage collection
                retry: shouldRetryQuery,
                retryDelay: getQueryRetryDelay,
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
