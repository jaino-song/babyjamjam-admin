import { render as renderElement } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, type ReactElement, type ReactNode } from "react";
import { getActiveBranchId } from "@/features/system-templates/branch-context";
import { AUTH_USER_QUERY_KEY } from "@/lib/auth/query-keys";

export function render(ui: ReactElement) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const previousBranch = getActiveBranchId();
    const branchId = previousBranch ?? "11111111-1111-4111-8111-111111111111";
    document.cookie = `selected_branch_id=${encodeURIComponent(branchId)}; path=/`;
    queryClient.setQueryDefaults(AUTH_USER_QUERY_KEY, { gcTime: Infinity });
    queryClient.setQueryData(AUTH_USER_QUERY_KEY, { id: "qa-user", name: "QA", branchId, branchRole: "manager" });

    function Wrapper({ children }: { children: ReactNode }) {
        useLayoutEffect(() => () => {
            document.cookie = previousBranch === null ? "selected_branch_id=; max-age=0; path=/"
                : `selected_branch_id=${encodeURIComponent(previousBranch)}; path=/`;
        }, []);
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    return renderElement(ui, { wrapper: Wrapper });
}
