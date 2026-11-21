/** @jest-environment node */
import Page from "./page";
import { AccountCompletionForm } from "@/components/auth/account-completion-form";
import { getOptionalCurrentUser } from "@/lib/auth/cookies";
import { serverAPIClient } from "@/lib/api/server";

const store = { get: jest.fn() };
jest.mock("next/headers", () => ({ cookies: async () => store }));
jest.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
jest.mock("@/lib/auth/cookies", () => ({ getOptionalCurrentUser: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
jest.mock("@/components/auth/account-completion-form", () => ({ AccountCompletionForm: () => null }));

beforeEach(() => {
  jest.resetAllMocks();
  store.get.mockReturnValue({ value: "pending" });
  jest.mocked(getOptionalCurrentUser).mockResolvedValue(null);
});

it("redirects signed-in people to the dashboard", async () => {
  jest.mocked(getOptionalCurrentUser).mockResolvedValue({ id: "user" } as never);
  await expect(Page()).rejects.toThrow(/^REDIRECT:\/dashboard$/);
  expect(store.get).not.toHaveBeenCalled();
  expect(serverAPIClient.get).not.toHaveBeenCalled();
});

it("redirects to login without the account onboarding cookie", async () => {
  store.get.mockReturnValue(undefined);
  await expect(Page()).rejects.toThrow(/^REDIRECT:\/login$/);
  expect(store.get).toHaveBeenCalledWith("pending_account_onboarding");
  expect(serverAPIClient.get).not.toHaveBeenCalled();
});

it("redirects a failed pending lookup to the expired-session notice", async () => {
  jest.mocked(serverAPIClient.get).mockRejectedValue(new Error("expired"));
  await expect(Page()).rejects.toThrow(/^REDIRECT:\/login\?authError=ONBOARDING_SESSION_EXPIRED$/);
});

it("redirects complete profiles to login", async () => {
  jest.mocked(serverAPIClient.get).mockResolvedValue({ status: 200, data: { phone: "01012345678", birthDate: "1990-01-01" } });
  await expect(Page()).rejects.toThrow(/^REDIRECT:\/login$/);
});

it.each([
  { email: "a@example.test", name: "테스트", phone: "01012345678" },
  { email: "a@example.test", name: "테스트", birthDate: "1990-01-01" },
])("renders the incomplete profile in the account completion form: %j", async profile => {
  jest.mocked(serverAPIClient.get).mockResolvedValue({ status: 200, data: profile });
  const result = await Page();
  expect(result.type).toBe(AccountCompletionForm);
  expect(result.props).toEqual(profile);
  expect(serverAPIClient.get).toHaveBeenCalledWith("/auth/onboarding/pending", { headers: { "x-pending-onboarding-token": "pending" } });
});
