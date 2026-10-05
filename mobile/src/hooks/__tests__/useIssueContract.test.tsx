import { act, renderHook } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { todayIsoDate } from "@/lib/contracts/date-input";
import { useFormStore } from "@/stores/form-store";

import { useIssueContract } from "../useIssueContract";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [] }),
}));

const client = { id: 7, name: "테스트 고객" } as Client;

describe("useIssueContract payment date", () => {
  beforeEach(() => {
    mockPush.mockClear();
    useFormStore.getState().resetAll();
  });

  it.each([undefined, ""])("leaves an unknown reissue date (%s) blank, even without a cancellation target", (paymentDate) => {
    const { result } = renderHook(() => useIssueContract());

    // A failed document fetch or missing field yields this reissue payload.
    act(() => result.current(client, { paymentDate }));

    expect(useFormStore.getState().paymentDate).toBe("");
    expect(useFormStore.getState().supersede).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/contracts/new");
  });

  it("prefills the known prior date rather than today's date", () => {
    const { result } = renderHook(() => useIssueContract());
    act(() => result.current(client, { paymentDate: "2026-09-15", supersedeDocumentId: "doc-old" }));
    expect(useFormStore.getState().paymentDate).toBe("2026-09-15");
    expect(useFormStore.getState().supersede).toEqual({ clientId: 7, documentId: "doc-old" });
  });

  it("still defaults a new contract to today after a reissue", () => {
    const { result } = renderHook(() => useIssueContract());
    act(() => result.current(client, {}));
    act(() => result.current(client));
    expect(useFormStore.getState().paymentDate).toBe(todayIsoDate());
  });
});
