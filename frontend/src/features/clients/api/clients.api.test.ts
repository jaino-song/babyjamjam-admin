import { api } from "@/lib/api/client";
import { clientsApi } from "./clients.api";

jest.mock("@/lib/api/client", () => ({ api: { patch: jest.fn() } }));

describe("clientsApi.confirmBooking", () => {
  it("patches the confirmation endpoint without booking data and returns the response", async () => {
    const response = { data: { id: 75, bookingConfirmedAt: "2026-10-13T00:00:00.000Z", serviceStatus: "waiting" } };
    jest.mocked(api.patch).mockResolvedValue(response);
    await expect(clientsApi.confirmBooking(75)).resolves.toBe(response);
    expect(api.patch).toHaveBeenCalledWith("/clients/75/confirm-booking", {});
  });

  it("propagates failures to the caller", async () => {
    const failure = new Error("refused");
    jest.mocked(api.patch).mockRejectedValue(failure);
    await expect(clientsApi.confirmBooking(75)).rejects.toBe(failure);
  });
});
