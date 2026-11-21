import type { AxiosAdapter } from "axios";

import { api } from "@/lib/api/client";
import { authApi } from "./auth";

const originalAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = originalAdapter; });

function stubTransport(body: unknown) {
  const requests: Array<{ method: string | undefined; uri: string; data: unknown }> = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push({ method: config.method, uri: api.getUri(config), data: config.data });
    return { status: 200, statusText: "OK", data: body, headers: {}, config };
  };
  api.defaults.adapter = adapter;
  return requests;
}

it("posts register-link verification to the browser API URL with its JSON body", async () => {
  const body = { success: true, code: "ACCOUNTS_LINKED", emailVerificationRequired: false };
  const requests = stubTransport(body);
  await expect(authApi.verifyRegisterLink("challenge-token", "123456")).resolves.toEqual(body);
  expect(requests).toEqual([{
    method: "post",
    uri: "/api/auth/register/link/verify",
    data: JSON.stringify({ challengeToken: "challenge-token", code: "123456" }),
  }]);
});

it.each([
  { body: { exists: true }, exists: true },
  { body: {}, exists: false },
  { body: { exists: "true" }, exists: false },
  { body: { exists: 1 }, exists: false },
  { body: { exists: false }, exists: false },
])("queries the email URL and accepts only literal true ($body)", async ({ body, exists }) => {
  const requests = stubTransport(body);
  await expect(authApi.checkEmailExists("qa@example.test")).resolves.toEqual({ exists });
  expect(requests).toEqual([{
    method: "get",
    uri: "/api/auth/check-email?email=qa%40example.test",
    data: undefined,
  }]);
});
