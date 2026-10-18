import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";

import { clientsApi } from "../api/clients.api";
import { clientKeys } from "../hooks/keys";
import { useConfirmBooking } from "../hooks/use-clients";

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockPatch = api.patch as jest.Mock;

describe("clientsApi.confirmBooking", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("PATCHes the confirm-booking proxy route of that client", async () => {
    mockPatch.mockResolvedValue({ data: { id: 12 } });

    await clientsApi.confirmBooking(12);

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith("/clients/12/confirm-booking", {});
  });
});

describe("useConfirmBooking", () => {
  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { invalidate, wrapper };
  }

  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("returns the confirmed client and invalidates the client list and that client's detail", async () => {
    const confirmed = { id: 12, serviceStatus: "waiting", bookingConfirmedAt: "2026-10-13T00:00:00.000Z" };
    mockPatch.mockResolvedValue({ data: confirmed });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useConfirmBooking(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync(12);
    });

    expect(returned).toEqual(confirmed);
    expect(mockPatch).toHaveBeenCalledWith("/clients/12/confirm-booking", {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.detail(12) });
  });

  it("invalidates nothing when the backend refuses", async () => {
    mockPatch.mockRejectedValue(new Error("refused"));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useConfirmBooking(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(12)).rejects.toThrow("refused");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
