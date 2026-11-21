/** @jest-environment node */
import Page from "./page";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";
const store = { get: jest.fn() };
jest.mock("next/headers", () => ({ cookies: async () => store }));
jest.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
jest.mock("@/lib/auth/cookies", () => ({ getOptionalCurrentUser: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
jest.mock("./AccountCompletionForm", () => ({ AccountCompletionForm: () => null }));
const params = { searchParams: Promise.resolve({ returnTo: "/service-record-admin/client-1" }) };
beforeEach(() => { jest.clearAllMocks(); store.get.mockReturnValue({ value: "pending" }); jest.mocked(getOptionalCurrentUser).mockResolvedValue(null); });
it("preserves the safe return path without a pending cookie", async () => {
  store.get.mockReturnValue(undefined);
  await expect(Page(params)).rejects.toThrow("REDIRECT:/login?returnTo=%2Fservice-record-admin%2Fclient-1");
});
it("redirects signed-in people", async () => {
  jest.mocked(getOptionalCurrentUser).mockResolvedValue({ id: "user" } as never);
  await expect(Page(params)).rejects.toThrow("REDIRECT:/service-record-admin/client-1");
});
it("redirects failed pending lookups to the expired-session notice", async () => {
  jest.mocked(serverAPIClient.get).mockRejectedValue(new Error("expired"));
  await expect(Page(params)).rejects.toThrow("REDIRECT:/login?authError=ONBOARDING_SESSION_EXPIRED&returnTo=");
});
it("redirects complete profiles", async () => {
  jest.mocked(serverAPIClient.get).mockResolvedValue({ status: 200, data: { phone: "01012345678", birthDate: "1990-01-01" } });
  await expect(Page(params)).rejects.toThrow("REDIRECT:/login?returnTo=");
});
it("passes only profile data and the safe return path to the form", async () => {
  jest.mocked(serverAPIClient.get).mockResolvedValue({ status: 200, data: { email: "a@example.com", name: "홍길동", phone: "01012345678" } });
  const result = await Page(params);
  expect(result.props).toEqual({ email: "a@example.com", name: "홍길동", phone: "01012345678", birthDate: undefined, returnPath: "/service-record-admin/client-1" });
  expect(serverAPIClient.get).toHaveBeenCalledWith("/auth/onboarding/pending", { headers: { "x-pending-onboarding-token": "pending" } });
});
