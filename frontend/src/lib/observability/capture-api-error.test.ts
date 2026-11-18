const mockScope = {
  setLevel: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);

jest.mock("@sentry/nextjs", () => ({
  withScope: (callback: (scope: typeof mockScope) => void) => callback(mockScope),
  captureException: (error: unknown) => mockCaptureException(error),
  flush: (timeout: number) => mockFlush(timeout),
}));

import {
  captureAndFlushApiError,
  captureApiError,
} from "./capture-api-error";

function createAxiosError(options: {
  status?: number;
  code?: string;
  method?: string;
  url?: string;
  data?: unknown;
}): Error {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    code: options.code,
    config: {
      method: options.method ?? "get",
      url: options.url ?? "/clients?phone=01012345678",
      data: options.data,
    },
    response: options.status ? { status: options.status } : undefined,
    toJSON: () => ({}),
  });
}

describe("captureApiError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(true);
  });

  it("ignores expected client errors and cancelled requests", () => {
    captureApiError(createAxiosError({ status: 409 }));
    captureApiError(createAxiosError({ status: 404 }));
    captureApiError(createAxiosError({ code: "ERR_CANCELED" }));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("reports server errors outside the service-record feature", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/messages/send?phone=01012345678",
    });

    expect(captureApiError(error)).toBe(true);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "api");
  });

  it("reports failures from removed schedule-change routes as API errors", () => {
    captureApiError(createAxiosError({
      status: 503,
      method: "post",
      url: "/schedule-change-requests/schedules/431/apply",
    }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "api");
  });

  it("reports a service-record server error once with sanitized endpoint context", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/admin/service-records/schedules/51/send-link?phone=01012345678",
    });

    captureApiError(error);
    captureApiError(error);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ServiceRecordApiRequestError",
      message: "Service-record API request failed: POST /admin/service-records/schedules/[Filtered]/send-link (503)",
    }));
    expect(mockScope.setLevel).toHaveBeenCalledWith("error");
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "POST",
      path: "/admin/service-records/schedules/[Filtered]/send-link",
      operation: "public-link",
      status: 503,
      code: null,
      runtime: "browser",
    });
    expect(mockScope.setTag).toHaveBeenCalledWith("app", "frontend");
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "public-link");
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
    expect(mockScope.setFingerprint).toHaveBeenCalledWith([
      "api-error",
      "POST",
      "/admin/service-records/schedules/[Filtered]/send-link",
      "503",
    ]);
  });

  it("reports a network failure as a warning", () => {
    captureApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
  });

  it("reports and deduplicates a client API 502 with a templated fingerprint and context", () => {
    const error = createAxiosError({
      status: 502,
      url: "/api/clients/123?email=user@example.com&phone=01012345678#private",
      data: { name: "Private client", token: "private-body" },
    });
    expect(captureApiError(error)).toBe(true);
    expect(captureApiError(error)).toBe(false);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ApiRequestError", message: "API request failed: GET /api/clients/123 (502)",
    }));
    expect(mockScope.setLevel).toHaveBeenCalledWith("error");
    for (const [key, value] of Object.entries({ feature: "api", app: "frontend", runtime: "browser", handled: "true", status_code: "502" })) {
      expect(mockScope.setTag).toHaveBeenCalledWith(key, value);
    }
    expect(mockScope.setTag).not.toHaveBeenCalledWith("operation", expect.anything());
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "GET", path: "/api/clients/:id", status: 502, code: null, runtime: "browser",
    });
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", "/api/clients/:id", "502"]);
    captureApiError(createAxiosError({ status: 502, url: "/api/clients/456" }));
    expect(mockScope.setFingerprint).toHaveBeenLastCalledWith(["api-error", "GET", "/api/clients/:id", "502"]);
    expect(JSON.stringify(mockScope.setContext.mock.calls)).not.toMatch(/user@example|01012345678|private|Private client/);
    expect(mockCaptureException.mock.calls[0][0].config).toBeUndefined();
  });

  it.each([
    ["a1b2c3d4e5f6a7b8c9d0", ":id"],
    ["1234567890abcdef", ":id"],
    ["short123", ":id"],
    ["longalphabeticsegment", ":id"],
  ])("templates opaque document id %s as %s", (id, template) => {
    captureApiError(createAxiosError({
      status: 500, url: `https://admin.example.com/api/eformsign/documents/${id}/supersede?token=private`,
    }));
    const path = `/api/eformsign/documents/${template}/supersede`;
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", path, "500"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path }));
  });

  it("reports non-service-record network failures as warnings", () => {
    captureApiError(createAxiosError({ code: "ERR_NETWORK", url: "/api/contracts/123" }));
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ApiRequestError", message: "API request failed: GET /api/contracts/123 (network)",
    }));
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "GET", path: "/api/contracts/:id", status: null, code: "ERR_NETWORK", runtime: "browser",
    });
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", "/api/contracts/:id", "network"]);
  });

  it("flushes captured proxy failures before the serverless response finishes", async () => {
    await captureAndFlushApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }));
    await captureAndFlushApiError(createAxiosError({
      status: 401,
      url: "/admin/service-records/client/7",
    }));

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledWith(2_000);
  });

  it("does not replace the proxy failure when Sentry flush fails", async () => {
    mockFlush.mockRejectedValueOnce(new Error("Sentry unavailable"));

    await expect(captureAndFlushApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }))).resolves.toBeUndefined();
  });

  it("does not pass a prepared feedback bearer token to Sentry", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/admin/service-records/schedules/51/send-link",
      data: JSON.stringify({ preparedLinkToken: "efl_sensitive_value" }),
    });

    captureApiError(error);

    const capturedError = mockCaptureException.mock.calls[0]?.[0] as Error & {
      config?: unknown;
    };
    expect(capturedError).not.toBe(error);
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.config).toBeUndefined();
    expect(capturedError.message).not.toContain("efl_sensitive_value");
  });
});


describe("API document path templates and opaque id bounds", () => {
  beforeEach(() => jest.clearAllMocks());

  it("preserves the real service-record capture output", () => {
    const path = "/api/service-record/[Filtered]/header";
    captureApiError(createAxiosError({
      status: 502, method: "post", url: "/api/service-record/qa-access-token/header",
    }));

    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "save-header");
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "POST", path, operation: "save-header", status: 502, code: null, runtime: "browser",
    });
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "POST", path, "502"]);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ServiceRecordApiRequestError", message: `Service-record API request failed: POST ${path} (502)`,
    }));
  });

  it.each(["completed", "status-counts"])("preserves the complete %s collection endpoint", (collection) => {
    const path = `/api/documents/${collection}`;
    captureApiError(createAxiosError({ status: 502, url: path }));
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path }));
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", path, "502"]);
  });

  it.each(["opaque-service-record-secret", "opaque-service_records-secret"])("templates document id %s before feature classification", (id) => {
    const subroute = "void";
    const path = `/api/documents/:id/${subroute}`;
    const error = createAxiosError({ status: 502, url: `/api/documents/${id}/${subroute}` });
    error.stack = "Error: Request failed\n    at request (api-client.ts:1:1)";
    captureApiError(error);

    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", path, "502"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path }));
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "api");
    const captured = mockCaptureException.mock.calls[0][0] as Error;
    expect(JSON.stringify([
      mockScope.setContext.mock.calls, mockScope.setTag.mock.calls,
      mockScope.setFingerprint.mock.calls, captured.message, captured.stack,
    ])).not.toContain(id);
  });

  it.each([
    ["/api/documents/abcdefghijklmnop/void", "/api/documents/:id/void"],
    ["/api/documents/completed/supersede", "/api/documents/:id/supersede"],
    ["/api/documents/status-counts/void", "/api/documents/:id/void"],
    ["/eformsign/documents/completed", "/eformsign/documents/completed"],
    ["/api/eformsign/documents/status-counts", "/api/eformsign/documents/status-counts"],
    ["/documents/upload", "/documents/upload"],
    ["/documents/capabilities", "/documents/capabilities"],
    ["/other/documents/completed", "/other/documents/:id"],
    ["/eformsign/documents/letters/download_files", "/eformsign/documents/:id/download_files"],
    ["/documents/file/download", "/documents/:id/download"],
    ...["completed", "in-progress", "status-counts", "rejected", "expired", "upload", "capabilities"].map((route) => [`/api/documents/${route}`, `/api/documents/${route}`]),
    ["/api/clients/123", "/api/clients/:id"],
    ["/api/eformsign/documents/a1b2c3d4e5f6a7b8c9d0/supersede", "/api/eformsign/documents/:id/supersede"],
    ["/api/clients/abcdefghijklmn1", "/api/clients/abcdefghijklmn1"],
    ["/api/clients/abcdefghijklmno1", "/api/clients/:id"],
  ])("templates %s as %s", (url, path) => {
    captureApiError(createAxiosError({ status: 500, url }));
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", path, "500"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path }));
  });
});
