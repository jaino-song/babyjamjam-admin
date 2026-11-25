import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { inspect } from "node:util";
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

  it("logs an upload failure without the request body or authorization header", async () => {
    const bodyMarker = "PRIVATE_UPLOAD_BODY_MARKER";
    const authorizationMarker = "Bearer PRIVATE_UPLOAD_AUTH_MARKER";
    const error = new AxiosError("upload failed", "ERR_BAD_REQUEST", {
      data: bodyMarker,
      headers: new AxiosHeaders({ Authorization: authorizationMarker }),
    });
    (api.post as jest.Mock).mockRejectedValueOnce(error);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useUploadDocument(), { wrapper: wrapper() });
      await act(async () => {
        await expect(result.current.mutateAsync({
          file: new File(["pdf"], "contract.pdf"), categoryId: "contract",
        })).rejects.toBe(error);
      });
      expect(log).toHaveBeenCalled();
      for (const args of log.mock.calls) {
        for (const argument of args) {
          const serialized = inspect(argument, { depth: null });
          expect(serialized).not.toContain(bodyMarker);
          expect(serialized).not.toContain(authorizationMarker);
        }
      }
      expect(log).toHaveBeenCalledWith("[useUploadDocument] onError called:", {
        name: "AxiosError", code: "ERR_BAD_REQUEST",
      });
    } finally {
      log.mockRestore();
    }
  });

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
