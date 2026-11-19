import { AxiosError } from "axios";

import { api } from "../client";

const mockScope = {
  setLevel: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  withScope: (callback: (scope: typeof mockScope) => void) => callback(mockScope),
  captureException: (error: unknown) => mockCaptureException(error),
}));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn() }));

describe("session refresh network failure reporting", () => {
  const originalAdapter = api.defaults.adapter;
  const originalFetch = global.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

  beforeEach(() => {
    jest.clearAllMocks();
    mockCaptureException.mockReset();
    // Public routes avoid navigation in jsdom; the real refresh fetch still runs.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/service-record/fixture", href: "http://localhost/service-record/fixture" },
    });
    api.defaults.adapter = async (config) => {
      throw new AxiosError("Unauthorized", "ERR_BAD_RESPONSE", config, undefined, {
        status: 401, statusText: "Unauthorized", headers: {}, config, data: {},
      });
    };
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    global.fetch = originalFetch;
    if (originalLocation) Object.defineProperty(window, "location", originalLocation);
  });

  it("captures a failed refresh fetch exactly once and rejects with the original TypeError", async () => {
    const failure = new TypeError("private refresh URL?token=private-fixture");
    global.fetch = jest.fn().mockRejectedValue(failure);

    await expect(api.get("/clients")).rejects.toBe(failure);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("/api/auth/refresh", expect.objectContaining({ method: "POST" }));
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ApiRequestError",
      message: "API request failed: POST /api/auth/refresh (network)",
    }));
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
    for (const [key, value] of Object.entries({ feature: "api", app: "mobile", runtime: "browser", handled: "true", status_code: "network" })) {
      expect(mockScope.setTag).toHaveBeenCalledWith(key, value);
    }
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "POST", "/api/auth/refresh", "network"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "POST", path: "/api/auth/refresh", status: null, code: "ERR_NETWORK", runtime: "browser",
    });
    expect(JSON.stringify([mockScope.setContext.mock.calls, mockScope.setTag.mock.calls, mockScope.setFingerprint.mock.calls, mockCaptureException.mock.calls])).not.toContain("private-fixture");
  });

  it("does not capture an HTTP 401 ApplicationSessionRefreshError", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ code: "AUTH_REQUIRED" }),
    });
    await expect(api.get("/clients")).rejects.toMatchObject({
      name: "ApplicationSessionRefreshError", status: 401,
    });
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("preserves the network rejection when reporting itself throws", async () => {
    const failure = new TypeError("Network unavailable");
    global.fetch = jest.fn().mockRejectedValue(failure);
    mockCaptureException.mockImplementationOnce(() => { throw new Error("Sentry unavailable"); });
    await expect(api.get("/clients")).rejects.toBe(failure);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});
