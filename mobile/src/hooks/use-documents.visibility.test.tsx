import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/lib/api/client";
import { useDocumentUploadCapabilities, useUploadDocument } from "./use-documents";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Provider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("document upload scope transport", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["branch", "all_branches", undefined] as const)("sends explicit scope without defaulting (%s)", async (visibilityScope) => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: "doc-1" } });
    const { result } = renderHook(() => useUploadDocument(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ file: new File(["pdf"], "contract.pdf"), categoryId: "contract", visibilityScope });
    });
    const formData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(formData.get("visibilityScope")).toBe(visibilityScope ?? null);
  });

  it("never substitutes default permissions during loading or failure, and refetch recovers", async () => {
    (api.get as jest.Mock).mockRejectedValueOnce(new Error("capabilities unavailable"));
    const { result } = renderHook(() => useDocumentUploadCapabilities(), { wrapper: wrapper() });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    (api.get as jest.Mock).mockResolvedValue({ data: { canChooseVisibilityScope: true } });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.data?.canChooseVisibilityScope).toBe(true));
  });
});
