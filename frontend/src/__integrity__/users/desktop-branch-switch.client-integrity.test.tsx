import { fireEvent, render, renderHook, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "@/lib/queryClient";
import { AUTH_USER_QUERY_KEY, useGetAuthUser } from "@/hooks/useGetAuthUser";
import SelectBranchPage from "@/app/(protected)/select-branch/page";
import { invariant } from "./client-known-defect";

import type { ReactNode } from "react";

/**
 * SI-USER-08 behavioural replacements for the former source-grep contracts:
 * the real select-branch page must clear the SHARED authority cache
 * (1) BEFORE the branch-switch server action runs and (2) even when the switch
 * FAILS, and the auth-user query must serve from a real 30-minute staleTime
 * (no refetch within the window on remount, refetch past it).
 *
 * The HTTP layer and Next navigation are mocked; the page component, the
 * authority reset, the QueryClient and react-query run for real.
 */

type AxiosGetMock = jest.Mock;
const state = {
    routerReplace: jest.fn(),
    getUserBranches: jest.fn(),
    setCurrentBranch: jest.fn(),
    logout: jest.fn(),
    axiosGet: jest.fn() as AxiosGetMock,
};

jest.mock("next/navigation", () => ({
    useRouter: () => ({
        replace: (...args: unknown[]) => state.routerReplace(...(args as [])),
        push: () => undefined,
        back: () => undefined,
    }),
    usePathname: () => "/dashboard",
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/app/(protected)/select-branch/actions", () => ({
    getUserBranches: (...args: unknown[]) => state.getUserBranches(...(args as [])),
    setCurrentBranch: (...args: unknown[]) => state.setCurrentBranch(...(args as [])),
}));

jest.mock("@/app/logout/actions", () => ({
    logout: (...args: unknown[]) => state.logout(...(args as [])),
}));

jest.mock("@/lib/notifications/push-endpoint", () => ({
    getCurrentPushEndpoint: async () => null,
}));

jest.mock("axios", () => {
    const axiosGet = jest.fn();
    const mockAxios = jest.fn(() => ({ get: axiosGet }));
    type MockAxios = ReturnType<typeof jest.fn> & {
        create: jest.Mock;
        get: AxiosGetMock;
    };
    (mockAxios as unknown as MockAxios).create = jest.fn(() => ({
        interceptors: {
            request: { use: jest.fn() },
            response: { use: jest.fn() },
        },
        get: axiosGet,
    }));
    return {
        __esModule: true,
        default: mockAxios,
    };
});

const AXIOS_GET = jest.requireMock("axios") as { default: { create: jest.Mock } };
const ADMIN_USER = {
    id: "user-1",
    name: "홍관리",
    role: "admin",
    branchRole: "admin",
    branchId: "branch-1",
};

const BRANCHES = [
    { id: "branch-a", name: "강남 지점", slug: "gangnam", description: null, role: "admin" },
    { id: "branch-b", name: "판교 지점", slug: "pangyo", description: null, role: "user" },
];

describe("SI-USER-08 desktop branch-switch authority isolation (real page + real QueryClient)", () => {
    let client: ReturnType<typeof getQueryClient>;

    beforeEach(() => {
        jest.restoreAllMocks();
        state.routerReplace.mockClear();
        state.getUserBranches.mockReset();
        state.setCurrentBranch.mockReset();
        state.logout.mockReset();
        jest.requireMock("axios").default.create().get.mockReset();
        client = getQueryClient();
        client.clear();
    });

    afterEach(() => {
        client.clear();
    });

    invariant(
        "SI-USER-08",
        "the real select-branch page clears the shared authority cache BEFORE a successful branch switch runs",
        async () => {
            client.setQueryData(AUTH_USER_QUERY_KEY, ADMIN_USER);
            state.getUserBranches.mockResolvedValue({ success: true, branches: BRANCHES });
            let authorityInCacheAtServerAction: unknown = "server action never ran";
            state.setCurrentBranch.mockImplementation(async () => {
                // The cache must already be cleared when the server action sees it:
                // old-branch requests/drafts cannot survive into the switch.
                authorityInCacheAtServerAction = client.getQueryData(AUTH_USER_QUERY_KEY);
                return { success: true };
            });

            render(
                <QueryClientProvider client={client}>
                    <SelectBranchPage />
                </QueryClientProvider>,
            );

            fireEvent.click(await screen.findByRole("button", { name: "강남 지점 지점 선택" }));

            await waitFor(() => expect(state.routerReplace).toHaveBeenCalledWith("/dashboard"));
            expect(authorityInCacheAtServerAction).toBeUndefined();
            expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
        },
    );

    invariant(
        "SI-USER-08",
        "the real select-branch page clears the shared authority cache even when the branch switch fails (reset runs before the server action)",
        async () => {
            client.setQueryData(AUTH_USER_QUERY_KEY, ADMIN_USER);
            state.getUserBranches.mockResolvedValue({ success: true, branches: BRANCHES });
            let authorityInCacheAtServerAction: unknown = "server action never ran";
            state.setCurrentBranch.mockImplementation(async () => {
                authorityInCacheAtServerAction = client.getQueryData(AUTH_USER_QUERY_KEY);
                return { success: false, error: "지점 선택에 실패했어요." };
            });

            render(
                <QueryClientProvider client={client}>
                    <SelectBranchPage />
                </QueryClientProvider>,
            );

            fireEvent.click(await screen.findByRole("button", { name: "강남 지점 지점 선택" }));

            await waitFor(() => expect(screen.getByText("지점 선택에 실패했어요.")).toBeInTheDocument());
            expect(state.routerReplace).not.toHaveBeenCalled();
            // The reset already happened: a failed switch still cannot serve the
            // old branch's cached authority.
            expect(authorityInCacheAtServerAction).toBeUndefined();
            expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
        },
    );
});

describe("SI-USER-08 desktop auth-user query staleTime (real useGetAuthUser)", () => {
    beforeEach(() => {
        AXIOS_GET.default.create().get.mockReset();
    });

    invariant(
        "SI-USER-08",
        "the auth user query serves from a real 30-minute staleTime (no refetch on remount within the window, refetch past it)",
        async () => {
            AXIOS_GET.default.create().get.mockResolvedValue({ data: ADMIN_USER });
            const freshClient = new QueryClient();
            const wrapper = ({ children }: { children: ReactNode }) => (
                <QueryClientProvider client={freshClient}>{children}</QueryClientProvider>
            );

            const first = renderHook(() => useGetAuthUser(), { wrapper });
            await act(async () => {
                await Promise.resolve();
            });
            expect(AXIOS_GET.default.create().get).toHaveBeenCalledTimes(1);

            // Within the window: a remount must not refetch.
            jest.useFakeTimers();
            try {
                const startAt = freshClient.getQueryState(AUTH_USER_QUERY_KEY)?.dataUpdatedAt;
                if (startAt === undefined) {
                    throw new Error("auth user query has no dataUpdatedAt after the initial fetch");
                }
                first.unmount();
                jest.setSystemTime(startAt + 1000 * 60 * 29);
                const second = renderHook(() => useGetAuthUser(), { wrapper });
                await act(async () => {
                    await Promise.resolve();
                });
                expect(AXIOS_GET.default.create().get).toHaveBeenCalledTimes(1);
                second.unmount();

                // Past the 30-minute window: a remount must refetch.
                jest.setSystemTime(startAt + 1000 * 60 * 31);
                const third = renderHook(() => useGetAuthUser(), { wrapper });
                await act(async () => {
                    await Promise.resolve();
                });
                expect(AXIOS_GET.default.create().get).toHaveBeenCalledTimes(2);
                third.unmount();
            } finally {
                jest.useRealTimers();
                freshClient.clear();
            }
        },
    );
});
