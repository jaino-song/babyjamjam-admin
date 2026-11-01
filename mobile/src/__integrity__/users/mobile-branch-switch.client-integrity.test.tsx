/**
 * @jest-environment jsdom
 */
/**
 * SI-USER-08 behavioural branch-switch coverage for MOBILE (the former
 * read-only contracts covered desktop only; the mobile
 * `app/(shell)/select-branch` page is now rendered for real): the real page
 * clears the shared authority cache BEFORE `setCurrentBranch` runs, keeps it
 * cleared after a failed switch, and reloads to the shell after success.
 *
 * The HTTP layer, navigation and the two context providers are mocked or
 * wrapped; the page component, the authority reset, the real shared QueryClient
 * and react-query run for real.
 */
import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserProvider } from "@/providers/UserProvider";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { getQueryClient } from "@/lib/queryClient";
import { AUTH_USER_QUERY_KEY, useGetAuthUser } from "@/hooks/useGetAuthUser";
import MobileSelectBranchPage from "@/app/(shell)/select-branch/page";
import { invariant } from "./client-known-defect";

import type { ReactNode } from "react";

const state = {
    routerPush: jest.fn(),
    getUserBranches: jest.fn(),
    setCurrentBranch: jest.fn(),
    logout: jest.fn(),
    locationReplace: jest.fn(),
};

jest.mock("next/navigation", () => ({
    useRouter: () => ({
        replace: () => undefined,
        push: (...args: unknown[]) => state.routerPush(...(args as [])),
        back: () => undefined,
    }),
    usePathname: () => "/dashboard",
}));

jest.mock("@/app/(shell)/select-branch/actions", () => ({
    getUserBranches: (...args: unknown[]) => state.getUserBranches(...(args as [])),
    setCurrentBranch: (...args: unknown[]) => state.setCurrentBranch(...(args as [])),
}));

jest.mock("@/app/(shell)/logout/actions", () => ({
    logout: (...args: unknown[]) => state.logout(...(args as [])),
}));

jest.mock("@/lib/notifications/push-endpoint", () => ({
    getCurrentPushEndpoint: async () => null,
}));

jest.mock("axios", () => {
    const axiosGet = jest.fn();
    const mockAxios = jest.fn(() => ({ get: axiosGet })) as unknown as jest.Mock & { create: jest.Mock };
    mockAxios.create = jest.fn(() => ({
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
    branchId: "branch-1",
};

const BRANCHES = [
    { id: "branch-a", name: "강남 지점", slug: "gangnam", description: null, role: "admin" },
    { id: "branch-b", name: "판교 지점", slug: "pangyo", description: null, role: "user" },
];

function withStubbedLocation<T>(run: () => Promise<T>): Promise<T> {
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", {
        configurable: true,
        value: {
            pathname: "/dashboard",
            href: "http://localhost/dashboard",
            replace: (...args: unknown[]) => state.locationReplace(...(args as [])),
        },
    });
    return run().finally(() => {
        if (originalLocation) {
            Object.defineProperty(window, "location", originalLocation);
        }
    });
}

async function renderPage(): Promise<void> {
    await act(async () => {
        render(
            <UserProvider user={ADMIN_USER as never}>
                <LocaleProvider locale="ko">
                    <MobileSelectBranchPage />
                </LocaleProvider>
            </UserProvider>,
        );
    });
}

describe("SI-USER-08 mobile branch-switch authority isolation (real page + real QueryClient)", () => {
    let client: ReturnType<typeof getQueryClient>;

    beforeEach(() => {
        state.routerPush.mockClear();
        state.getUserBranches.mockReset();
        state.setCurrentBranch.mockReset();
        state.locationReplace.mockClear();
        client = getQueryClient();
        client.clear();
        window.history.replaceState({}, "", "/dashboard");
    });

    afterEach(() => {
        client.clear();
    });

    invariant(
        "SI-USER-08",
        "the real mobile select-branch page clears the shared authority cache BEFORE a successful branch switch runs",
        async () => {
            client.setQueryData(AUTH_USER_QUERY_KEY, ADMIN_USER);
            state.getUserBranches.mockResolvedValue({ success: true, branches: BRANCHES });
            let authorityInCacheAtServerAction: unknown = "server action never ran";
            state.setCurrentBranch.mockImplementation(async () => {
                // The cache must already be cleared when the server action sees it.
                authorityInCacheAtServerAction = client.getQueryData(AUTH_USER_QUERY_KEY);
                return { success: true };
            });

            await withStubbedLocation(async () => {
                await renderPage();
                // The branches effect resolves through the mocked server action;
                // waitFor is act-compat and tolerates the page's own state writes.
                fireEvent.click(await screen.findByText("강남 지점"));
                fireEvent.click(await screen.findByText("강남 지점으로 이동"));

                await waitFor(() => expect(state.locationReplace).toHaveBeenCalledWith("/dashboard"));
                expect(authorityInCacheAtServerAction).toBeUndefined();
                expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
            });
        },
    );

    invariant(
        "SI-USER-08",
        "the real mobile select-branch page clears the shared authority cache even when the branch switch fails (reset runs before the server action)",
        async () => {
            client.setQueryData(AUTH_USER_QUERY_KEY, ADMIN_USER);
            state.getUserBranches.mockResolvedValue({ success: true, branches: BRANCHES });
            let authorityInCacheAtServerAction: unknown = "server action never ran";
            state.setCurrentBranch.mockImplementation(async () => {
                authorityInCacheAtServerAction = client.getQueryData(AUTH_USER_QUERY_KEY);
                return { success: false, error: "지점 선택에 실패했어요." };
            });

            await withStubbedLocation(async () => {
                await renderPage();
                // The branches effect resolves through the mocked server action;
                // waitFor is act-compat and tolerates the page's own state writes.
                fireEvent.click(await screen.findByText("강남 지점"));
                fireEvent.click(await screen.findByText("강남 지점으로 이동"));

                await waitFor(() => expect(screen.getByText("지점 선택에 실패했어요.")).toBeInTheDocument());
                expect(state.locationReplace).not.toHaveBeenCalled();
                // The reset already happened despite the failure: the old branch's
                // cached authority cannot survive a failed switch either.
                expect(authorityInCacheAtServerAction).toBeUndefined();
                expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
            });
        },
    );
});

describe("SI-USER-08 mobile auth-user query staleTime (real useGetAuthUser)", () => {
    invariant(
        "SI-USER-08",
        "the auth user query serves from a real 30-minute staleTime (no refetch on remount within the window, refetch past it)",
        async () => {
            AXIOS_GET.default.create().get.mockReset();
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

                // Past the 30-minute window: a remount must refetch — the severity
                // enabler of the 403-keeps-serving-stale-identity defect.
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
