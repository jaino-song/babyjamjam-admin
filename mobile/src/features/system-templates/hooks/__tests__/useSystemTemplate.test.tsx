import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSystemTemplate } from "../useSystemTemplate";
import { systemTemplateKeys, useSystemTemplates } from "../useSystemTemplates";
import { systemTemplateService } from "@/services/system-template.service";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: jest.fn(),
}));

jest.mock("@/services/system-template.service", () => ({
    systemTemplateService: {
        getAll: jest.fn(),
        getAllForBranch: jest.fn(),
        getByKey: jest.fn(),
        getBranchByKey: jest.fn(),
    },
}));

const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);
const mockedGetBranchByKey = jest.mocked(systemTemplateService.getBranchByKey);
const mockedGetByKey = jest.mocked(systemTemplateService.getByKey);
const mockedGetAllForBranch = jest.mocked(systemTemplateService.getAllForBranch);
const mockedGetAll = jest.mocked(systemTemplateService.getAll);

const branchTemplate = {
    id: "tpl-greeting-branch-a",
    templateKey: "GREETING",
    name: "인사(소개)",
    content: "안녕하세요, {{name}}님",
    requiredVariables: [{ key: "name", label: "이름", type: "string", required: true }],
    updatedAt: "2026-09-10T00:00:00.000Z",
};

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    });
}

function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseGetAuthUser.mockReturnValue({
        data: { id: "user-1", name: "테스트", branchId: "branch-a" },
        isLoading: false,
    } as never);
});

describe("useSystemTemplate (branch scope)", () => {
    it("resolves the template through the authenticated session's branch", async () => {
        mockedGetBranchByKey.mockResolvedValue({ data: branchTemplate } as never);
        const queryClient = createQueryClient();

        const { result } = renderHook(() => useSystemTemplate("GREETING"), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.data).toEqual(branchTemplate));
        expect(mockedGetBranchByKey).toHaveBeenCalledWith("GREETING", "branch-a");
        expect(mockedGetByKey).not.toHaveBeenCalled();
    });

    it("keeps the query loading while the auth session has not resolved", async () => {
        mockedUseGetAuthUser.mockReturnValue({
            data: undefined,
            isLoading: true,
        } as never);
        const queryClient = createQueryClient();

        const { result } = renderHook(() => useSystemTemplate("GREETING"), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(true));
        expect(mockedGetBranchByKey).not.toHaveBeenCalled();
        expect(mockedGetByKey).not.toHaveBeenCalled();
    });

    it("stays idle without fetching when the session has no branch", async () => {
        mockedUseGetAuthUser.mockReturnValue({
            data: { id: "user-1", name: "테스트", branchId: null },
            isLoading: false,
        } as never);
        const queryClient = createQueryClient();

        const { result } = renderHook(() => useSystemTemplate("GREETING"), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toBeUndefined();
        expect(mockedGetBranchByKey).not.toHaveBeenCalled();
        expect(mockedGetByKey).not.toHaveBeenCalled();
    });

    it("partitions cached templates by branch identity", async () => {
        mockedGetBranchByKey
            .mockResolvedValueOnce({ data: branchTemplate } as never)
            .mockResolvedValueOnce({
                data: { ...branchTemplate, id: "tpl-greeting-branch-b", content: "B지점 인사" },
            } as never);
        const queryClient = createQueryClient();

        const first = renderHook(() => useSystemTemplate("GREETING"), {
            wrapper: createWrapper(queryClient),
        });
        await waitFor(() => expect(first.result.current.data).toEqual(branchTemplate));

        const second = renderHook(() => useSystemTemplate("GREETING", { branchId: "branch-b" }), {
            wrapper: createWrapper(queryClient),
        });
        await waitFor(() => expect(second.result.current.data?.content).toBe("B지점 인사"));

        expect(mockedGetBranchByKey).toHaveBeenNthCalledWith(1, "GREETING", "branch-a");
        expect(mockedGetBranchByKey).toHaveBeenNthCalledWith(2, "GREETING", "branch-b");
        expect(queryClient.getQueryData(systemTemplateKeys.branchDetail("branch-a", "GREETING")))
            .toEqual(branchTemplate);
        expect(queryClient.getQueryData(systemTemplateKeys.branchDetail("branch-b", "GREETING")))
            ?.toHaveProperty("content", "B지점 인사");
    });
});

describe("useSystemTemplates (branch scope)", () => {
    it("resolves the catalog through the authenticated session's branch", async () => {
        mockedGetAllForBranch.mockResolvedValue({ data: [branchTemplate] } as never);
        const queryClient = createQueryClient();

        const { result } = renderHook(() => useSystemTemplates(), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.data).toEqual([branchTemplate]));
        expect(mockedGetAllForBranch).toHaveBeenCalledWith("branch-a");
        expect(mockedGetAll).not.toHaveBeenCalled();
    });

    it("stays idle without fetching when the session has no branch", async () => {
        mockedUseGetAuthUser.mockReturnValue({
            data: { id: "user-1", name: "테스트", branchId: null },
            isLoading: false,
        } as never);
        const queryClient = createQueryClient();

        const { result } = renderHook(() => useSystemTemplates(), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.data).toBeUndefined();
        expect(mockedGetAllForBranch).not.toHaveBeenCalled();
        expect(mockedGetAll).not.toHaveBeenCalled();
    });
});
