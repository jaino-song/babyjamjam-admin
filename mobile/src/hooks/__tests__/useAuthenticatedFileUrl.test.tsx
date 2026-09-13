import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { fetchAuthenticatedFileBlob } from "@/lib/files/authenticated-file";

import { useAuthenticatedFileUrl } from "../useAuthenticatedFileUrl";

jest.mock("@/lib/files/authenticated-file", () => ({
  fetchAuthenticatedFileBlob: jest.fn(),
}));

const mockFetchAuthenticatedFileBlob = jest.mocked(fetchAuthenticatedFileBlob);

describe("useAuthenticatedFileUrl", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn().mockReturnValue("blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    mockFetchAuthenticatedFileBlob.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it("creates and revokes a managed preview URL", async () => {
    mockFetchAuthenticatedFileBlob.mockResolvedValue(new Blob(["file"]));

    const { result, unmount } = renderHook(() =>
      useAuthenticatedFileUrl("/api/file-storage/files/42/download", true),
    );

    await waitFor(() => expect(result.current.url).toBe("blob:preview"));
    expect(mockFetchAuthenticatedFileBlob).toHaveBeenCalledWith(
      "/api/file-storage/files/42/download",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    act(() => unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("never re-exposes a revoked URL when reopening the same source", async () => {
    let resolveReopen: ((blob: Blob) => void) | undefined;
    mockFetchAuthenticatedFileBlob
      .mockResolvedValueOnce(new Blob(["first"]))
      .mockImplementationOnce(() => new Promise<Blob>((resolve) => {
        resolveReopen = resolve;
      }));
    jest.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");

    const { result, rerender } = renderHook(
      ({ enabled }) => useAuthenticatedFileUrl("/api/file-storage/files/42/download", enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.url).toBe("blob:first"));

    rerender({ enabled: false });
    expect(result.current).toEqual({ url: null, loading: false, error: false });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");

    rerender({ enabled: true });
    expect(result.current).toEqual({ url: null, loading: true, error: false });
    expect(result.current.url).not.toBe("blob:first");

    await act(async () => {
      resolveReopen?.(new Blob(["second"]));
    });
    await waitFor(() => expect(result.current.url).toBe("blob:second"));
  });
});
