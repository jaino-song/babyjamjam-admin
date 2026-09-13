import { act, renderHook, waitFor } from "@testing-library/react";

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
});
