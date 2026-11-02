/**
 * @jest-environment node
 */
import { cookies } from "next/headers";

import {
  AuthServiceUnavailableError,
  getCurrentUser,
  getOptionalCurrentUser,
} from "./cookies";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/api/server-base-url", () => ({
  createServerApiUrl: (path: string) => `https://api.test${path}`,
}));

const mockCookies = cookies as jest.Mock;

function mockCookieStore(values: Record<string, string>) {
  mockCookies.mockResolvedValue({
    get: jest.fn((name: string) =>
      name in values ? { value: values[name] } : undefined,
    ),
  });
}

describe("getCurrentUser", () => {
  let fetchMock: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCookieStore({ auth_token: "access-token" });
    fetchMock = jest.spyOn(global, "fetch");
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns null without calling the backend when there is no auth_token cookie", async () => {
    mockCookieStore({});

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("returns null when /auth/me answers %i (not authenticated)", async (status) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it.each([500, 502, 503, 504])(
    "throws AuthServiceUnavailableError when /auth/me answers %i",
    async (status) => {
      fetchMock.mockResolvedValue(new Response("{}", { status }));

      await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    },
  );

  it("throws AuthServiceUnavailableError when the request times out", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError when the network request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it("throws AuthServiceUnavailableError when a 200 response body cannot be parsed", async () => {
    fetchMock.mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));

    await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  });

  it.each([
    ["null", "null"],
    ["a string", JSON.stringify("signed-in")],
    ["a number", "42"],
  ])(
    "throws AuthServiceUnavailableError when a 200 response body is %s (not a user object)",
    async (_label, body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

      await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    },
  );

  it.each([201, 202, 206])(
    "throws AuthServiceUnavailableError when /auth/me answers %i with a user-shaped body",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: "user-1", name: "Kim" }), { status }),
      );

      await expect(getCurrentUser()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    },
  );

  it("propagates an unexpected error thrown by cookies() instead of returning null", async () => {
    const failure = new Error("cookies exploded");
    mockCookies.mockRejectedValue(failure);

    await expect(getCurrentUser()).rejects.toBe(failure);
  });

  it("returns the user when /auth/me answers 200", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: "user-1", name: "Kim", organizationName: "Seoul" }),
        { status: 200 },
      ),
    );

    await expect(getCurrentUser()).resolves.toEqual(
      expect.objectContaining({
        id: "user-1",
        name: "Kim",
        branchName: "Seoul",
        branchSlug: null,
      }),
    );
  });
});

describe("getOptionalCurrentUser", () => {
  let fetchMock: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCookieStore({ auth_token: "access-token" });
    fetchMock = jest.spyOn(global, "fetch");
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("behaves like signed out when the backend is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(getOptionalCurrentUser()).resolves.toBeNull();
  });

  it("returns the user when the backend answers", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "user-1" }), { status: 200 }));

    await expect(getOptionalCurrentUser()).resolves.toEqual(
      expect.objectContaining({ id: "user-1" }),
    );
  });
});
