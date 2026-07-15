import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api/client";
import { useClientPhoneDuplicateCheck } from "../useClientPhoneDuplicateCheck";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

describe("useClientPhoneDuplicateCheck", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
  });

  it("checks a complete phone number and marks a duplicate as unavailable", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: true } });

    const { result } = renderHook(() =>
      useClientPhoneDuplicateCheck({ phone: "010-6621-1878" }),
    );

    await waitFor(() => {
      expect(result.current.lastCheckedPhoneDigits).toBe("01066211878");
    });

    expect(mockApiGet).toHaveBeenCalledWith("/clients/check-phone", {
      params: { phone: "01066211878" },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.isPhoneDuplicate).toBe(true);
    expect(result.current.isPhoneCheckReady).toBe(false);
  });

  it("marks a checked non-duplicate phone number as ready", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: false } });

    const { result } = renderHook(() =>
      useClientPhoneDuplicateCheck({ phone: "010-1234-5678" }),
    );

    await waitFor(() => {
      expect(result.current.isPhoneCheckReady).toBe(true);
    });

    expect(result.current.isPhoneDuplicate).toBe(false);
    expect(result.current.hasPhoneDuplicateCheckFailed).toBe(false);
  });

  it("does not check an incomplete phone number", () => {
    const { result } = renderHook(() =>
      useClientPhoneDuplicateCheck({ phone: "010-1234" }),
    );

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(result.current.isPhoneCheckReady).toBe(false);
  });

  it("accepts an unchanged phone number while editing without checking itself", () => {
    const { result } = renderHook(() =>
      useClientPhoneDuplicateCheck({
        phone: "010-6621-1878",
        originalPhone: "01066211878",
      }),
    );

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(result.current.isUsingOriginalPhone).toBe(true);
    expect(result.current.isPhoneCheckReady).toBe(true);
  });
});
