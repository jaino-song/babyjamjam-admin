/** @jest-environment node */
import { inspect } from "node:util";
import { AxiosError, AxiosHeaders } from "axios";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { loginWithEmail } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));

afterEach(() => jest.restoreAllMocks());

it("logs a login request failure without its password or authorization header", async () => {
  const password = "P@ss-login-secret";
  const authorization = "Bearer login-header-secret";
  const error = new AxiosError("Request failed", "ERR_BAD_REQUEST", {
    data: JSON.stringify({ email: "qa@example.test", password }),
    headers: new AxiosHeaders({ Authorization: authorization }),
  });
  jest.mocked(cookies).mockResolvedValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn() } as never);
  jest.mocked(serverAPIClient.post).mockRejectedValueOnce(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(loginWithEmail("qa@example.test", password)).resolves.toMatchObject({ success: false });

  expect(log).toHaveBeenCalledWith("[Server Action] Email Login Error:", expect.any(Object));
  for (const args of log.mock.calls) {
    for (const arg of args) {
      const printed = inspect(arg, { depth: null });
      expect(printed).not.toContain(password);
      expect(printed).not.toContain(authorization);
    }
  }
});
