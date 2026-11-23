/** @jest-environment node */
import { AxiosError, AxiosHeaders } from "axios";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { loginWithEmail } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/env", () => ({
  getServerRuntimeConfig: () => ({ isSecureCookieEnv: true }),
}));

afterEach(() => jest.restoreAllMocks());

const sentinel = "LOGIN_PRIVATE_SENTINEL";
const requestData = { email: "qa@example.test", password: sentinel };

beforeEach(() => {
  jest.mocked(cookies).mockResolvedValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn() } as never);
});

it.each([
  [new Error(sentinel), { name: "Error" }],
  [Object.assign(new Error(sentinel), { name: sentinel, code: sentinel, problemCode: sentinel }), { name: "Error" }],
  [Object.defineProperty(new Error(sentinel), "name", { get() { throw new Error(sentinel); } }), { name: "NonError" }],
  [Object.assign(new AxiosError(sentinel, sentinel, undefined, { private: sentinel }, {
    status: 403, data: { code: sentinel, message: sentinel },
  } as never), { name: sentinel }), { name: "AxiosError", status: 403 }],
  [new AxiosError(sentinel, "ERR_BAD_REQUEST", {
    data: JSON.stringify(requestData),
    headers: new AxiosHeaders({ Authorization: sentinel }),
  }, { private: sentinel }, {
    status: 403, data: { code: "ACCESS_DENIED", detail: sentinel },
  } as never), { name: "AxiosError", code: "ERR_BAD_REQUEST", status: 403, problemCode: "ACCESS_DENIED" }],
] as const)("logs only allowed metadata for login failure %#", async (error, summary) => {
  jest.mocked(serverAPIClient.post).mockRejectedValueOnce(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(loginWithEmail(requestData.email, requestData.password)).resolves.toMatchObject({ success: false });

  expect(log.mock.calls).toEqual([["[Server Action] Email Login Error:", summary]]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(sentinel);
});
