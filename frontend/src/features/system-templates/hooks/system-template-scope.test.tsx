import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { systemTemplateService } from "@/services/system-template.service";
import {
  systemTemplateKeys,
  useSystemTemplates,
} from "./useSystemTemplates";
import { useUpdateSystemTemplate } from "./use-update-system-template";

jest.mock("@/services/system-template.service", () => ({
  systemTemplateService: {
    getAll: jest.fn(),
    getAllForBranch: jest.fn(),
    getByKey: jest.fn(),
    getBranchByKey: jest.fn(),
    update: jest.fn(),
    updateBranch: jest.fn(),
  },
}));

const mockGetAllForBranch = jest.mocked(systemTemplateService.getAllForBranch);
const mockUpdateBranch = jest.mocked(systemTemplateService.updateBranch);
const mockUpdate = jest.mocked(systemTemplateService.update);

function buildTemplate(content: string) {
  return {
    id: "template-1",
    templateKey: "GREETING",
    name: "인사",
    description: "소개",
    content,
    customVariables: [],
    requiredVariables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("system-template scope and cache identity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.cookie = "selected_branch_id=branch-a; path=/";
    mockGetAllForBranch.mockResolvedValue({ data: [buildTemplate("branch content")] } as never);
    mockUpdateBranch.mockResolvedValue({ data: buildTemplate("saved") } as never);
    mockUpdate.mockResolvedValue({ data: buildTemplate("global saved") } as never);
  });

  it("keeps branch list caches separate by captured branch identity", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = createWrapper(queryClient);

    const first = renderHook(
      () => useSystemTemplates({ scope: "branch", branchId: "branch-a" }),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    document.cookie = "selected_branch_id=branch-b; path=/";
    const second = renderHook(
      () => useSystemTemplates({ scope: "branch", branchId: "branch-b" }),
      { wrapper },
    );
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(mockGetAllForBranch).toHaveBeenCalledWith("branch-a");
    expect(mockGetAllForBranch).toHaveBeenCalledWith("branch-b");
    expect(queryClient.getQueryData(systemTemplateKeys.branchList("branch-a"))).toEqual([
      buildTemplate("branch content"),
    ]);
    expect(queryClient.getQueryData(systemTemplateKeys.branchList("branch-b"))).toEqual([
      buildTemplate("branch content"),
    ]);
  });

  it("invalidates the captured branch collection and detail after a branch save", async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useUpdateSystemTemplate(), { wrapper });

    await result.current.mutateAsync({
      key: "GREETING",
      content: "saved",
      scope: "branch",
      branchId: "branch-a",
    });

    expect(mockUpdateBranch).toHaveBeenCalledWith("GREETING", "saved", undefined, "branch-a");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: systemTemplateKeys.branch("branch-a") });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: systemTemplateKeys.branchDetail("branch-a", "GREETING"),
    });
  });

  it("invalidates branch-effective caches after a global default save", async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidateQueries = jest.spyOn(queryClient, "invalidateQueries");
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useUpdateSystemTemplate(), { wrapper });

    await result.current.mutateAsync({ key: "GREETING", content: "global saved" });

    expect(mockUpdate).toHaveBeenCalledWith("GREETING", "global saved", undefined);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: systemTemplateKeys.global.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: systemTemplateKeys.branchAll });
  });

  it("rejects a branch save when the active cookie changed before the request", async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useUpdateSystemTemplate(), { wrapper });

    document.cookie = "selected_branch_id=branch-b; path=/";

    await expect(
      result.current.mutateAsync({
        key: "GREETING",
        content: "stale branch write",
        scope: "branch",
        branchId: "branch-a",
      }),
    ).rejects.toThrow("지점을 선택한 뒤 템플릿을 저장해 주세요.");
    expect(mockUpdateBranch).not.toHaveBeenCalled();
  });

  it("hides a cached branch result while its captured identity is no longer active", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const branchAKey = systemTemplateKeys.branchList("branch-a");
    queryClient.setQueryData(branchAKey, [buildTemplate("branch-a cached")]);
    document.cookie = "selected_branch_id=branch-b; path=/";

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(
      () => useSystemTemplates({ scope: "branch", branchId: "branch-a" }),
      { wrapper },
    );

    expect(result.current.data).toBeUndefined();
    expect(mockGetAllForBranch).not.toHaveBeenCalled();
  });
});
