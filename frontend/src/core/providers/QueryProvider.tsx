"use client";

import { getQueryClient } from "@/core/config/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";

export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
    // NOTE: getQueryClient()는 브라우저에서 싱글톤 반환
    // 이렇게 하면 React 상태 밖에서도 안정적인 참조 유지
    const queryClient = getQueryClient();

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}