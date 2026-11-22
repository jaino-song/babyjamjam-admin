/**
 * @jest-environment node
 */
import { inspect } from "node:util";
import { AxiosError, AxiosHeaders } from "axios";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";

import { getUserBranches, setCurrentBranch } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/lib/env", () => ({
  getServerRuntimeConfig: () => ({ isSecureCookieEnv: true }),
}));

const mockCookies = jest.mocked(cookies);
const mockGet = jest.mocked(serverAPIClient.get);

describe("mobile getUserBranches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the most recently selected branch first", async () => {
    mockCookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === "auth_token") return { value: "auth-token" };
        if (name === "selected_branch_id") return { value: "branch-c" };
        return undefined;
      }),
    } as never);
    mockGet.mockResolvedValue({
      data: {
        branches: [
          { id: "branch-a", name: "가 지점" },
          { id: "branch-b", name: "나 지점" },
          { id: "branch-c", name: "다 지점" },
        ],
      },
    });

    await expect(getUserBranches()).resolves.toEqual({
      success: true,
      branches: [
        { id: "branch-c", name: "다 지점" },
        { id: "branch-a", name: "가 지점" },
        { id: "branch-b", name: "나 지점" },
      ],
    });
    expect(mockGet).toHaveBeenCalledWith("/auth/branches", {
      headers: { Authorization: "Bearer auth-token" },
    });
  });

  it.each([
    ["fetch", "[Server Action] Error fetching branches:"],
    ["select", "[Server Action] Error setting current branch:"],
  ])("logs a %s failure without the bearer token", async (operation, label) => {
    const token = "branch-token-secret";
    const authorization = `Bearer ${token}`;
    const error = new AxiosError("Request failed", "ERR_BAD_REQUEST", {
      headers: new AxiosHeaders({ Authorization: authorization }),
    });
    jest.mocked(cookies).mockResolvedValue({
      get: jest.fn((name: string) => name === "auth_token" ? { value: token } : undefined),
    } as never);
    const request = operation === "fetch" ? serverAPIClient.get : serverAPIClient.post;
    jest.mocked(request).mockRejectedValueOnce(error);
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = operation === "fetch" ? await getUserBranches() : await setCurrentBranch("branch-a");
      expect(result.success).toBe(false);
      expect(log).toHaveBeenCalledWith(label, expect.any(Object));
      for (const args of log.mock.calls) {
        for (const arg of args) {
          const printed = inspect(arg, { depth: null });
          expect(printed).not.toContain(token);
          expect(printed).not.toContain(authorization);
        }
      }
    } finally {
      log.mockRestore();
    }
  });
});
