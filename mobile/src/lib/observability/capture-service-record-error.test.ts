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
  captureSessionRefreshNetworkError,
  captureAndFlushServiceRecordError,
  captureServiceRecordError,
  captureServiceRecordResponseError,
  getServiceRecordOperation,
} from "./capture-service-record-error";

function createAxiosError(options: {
  status?: number;
  code?: string;
  method?: string;
  url?: string;
}): Error {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    code: options.code,
    config: {
      method: options.method ?? "get",
      url: options.url ?? "/dashboard",
    },
    response: options.status ? { status: options.status } : undefined,
    toJSON: () => ({}),
  });
}

describe("captureServiceRecordError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(true);
  });

  it("ignores expected client errors and unrelated API paths", () => {
    captureServiceRecordError(createAxiosError({
      status: 409,
      url: "/service-record/context",
    }));
    captureServiceRecordError(createAxiosError({
      status: 503,
      url: "/dashboard",
    }));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("captures unexpected service-record API failures without the access token", () => {
    captureServiceRecordError(createAxiosError({
      status: 503,
      method: "post",
      url: "/service-record/efl_secret/sessions/1/submit",
    }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setContext).toHaveBeenCalledWith("serviceRecord", {
      operation: "submit-session",
      method: "POST",
      path: "/service-record/[Filtered]/sessions/[Filtered]/submit",
      status: 503,
      code: null,
      runtime: "browser",
    });
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "submit-session");
  });

  it("labels an Axios DELETE failure as delete-session and redacts identifiers", () => {
    captureServiceRecordError(createAxiosError({
      status: 503,
      method: "delete",
      url: "/service-record/efl_secret/sessions/1",
    }));

    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "delete-session");
    expect(mockScope.setContext).toHaveBeenCalledWith("serviceRecord", expect.objectContaining({
      operation: "delete-session",
      method: "DELETE",
      path: "/service-record/[Filtered]/sessions/[Filtered]",
    }));
  });

  it("captures resolved 5xx responses but ignores resolved 4xx responses", () => {
    captureServiceRecordResponseError(
      { status: 503 },
      {
        operation: "context",
        method: "GET",
        path: "/api/service-record/[Filtered]/context",
      },
    );
    captureServiceRecordResponseError(
      { status: 401 },
      {
        operation: "verify",
        method: "POST",
        path: "/api/service-record/[Filtered]/verify",
      },
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "context");
  });

  it("flushes captured proxy failures before the serverless response finishes", async () => {
    await captureAndFlushServiceRecordError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/service-record/context",
    }));
    await captureAndFlushServiceRecordError(createAxiosError({
      status: 401,
      url: "/service-record/context",
    }));

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledWith(2_000);
  });

  it("does not replace the proxy failure when Sentry flush fails", async () => {
    mockFlush.mockRejectedValueOnce(new Error("Sentry unavailable"));

    await expect(captureAndFlushServiceRecordError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/service-record/context",
    }))).resolves.toBeUndefined();
  });
});

describe("getServiceRecordOperation", () => {
  it.each([
    ["DELETE", "delete-session"],
    ["delete", "delete-session"],
    ["PUT", "save-session"],
    [undefined, "save-session"],
  ])("labels a session request with method %s as %s", (method, operation) => {
    expect(getServiceRecordOperation("/service-record/efl_secret/sessions/1", method)).toBe(operation);
  });

  it("keeps session submission labelled separately", () => {
    expect(getServiceRecordOperation("/service-record/efl_secret/sessions/1/submit", "POST")).toBe("submit-session");
  });

  it("labels token-page holiday calendar requests as holidays", () => {
    expect(getServiceRecordOperation("/holidays?year=2026")).toBe("holidays");
    expect(getServiceRecordOperation("/context")).toBe("context");
  });
});


describe("captureApiError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(true);
  });

  it("captures and deduplicates a 502 with a private-data-free path template", () => {
    const error = createAxiosError({ status: 502, url: "/api/clients/123?token=private" });
    expect(captureApiError(error)).toBe(true);
    expect(captureApiError(error)).toBe(false);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ApiRequestError", message: "API request failed: GET /api/clients/:id (502)",
    }));
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "api");
    expect(mockScope.setTag).toHaveBeenCalledWith("app", "mobile");
    expect(mockScope.setTag).toHaveBeenCalledWith("runtime", "browser");
    expect(mockScope.setTag).toHaveBeenCalledWith("handled", "true");
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "502");
    expect(mockScope.setLevel).toHaveBeenCalledWith("error");
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", "/api/clients/:id", "502"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "GET", path: "/api/clients/:id", status: 502, code: null, runtime: "browser",
    });
  });

  it("templates opaque document identifiers in both fingerprint and context", () => {
    captureApiError(createAxiosError({ status: 500, url: "/api/eformsign/documents/a1b2c3d4e5f6a7b8c9d0/supersede" }));
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["api-error", "GET", "/api/eformsign/documents/:id/supersede", "500"]);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path: "/api/eformsign/documents/:id/supersede" }));
  });

  it("captures network failures as warnings", () => {
    expect(captureApiError(createAxiosError({ code: "ERR_NETWORK" }))).toBe(true);
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "network");
  });

  it("skips expected responses, cancellation, and non-Axios errors", () => {
    for (const error of [createAxiosError({ status: 404 }), createAxiosError({ code: "ERR_CANCELED" }), new Error("render failed"), null]) {
      expect(captureApiError(error)).toBe(false);
    }
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("delegates service-record capture before marking the error as reported", () => {
    const error = createAxiosError({ status: 503, method: "post", url: "/service-record/efl_secret/sessions/1/submit" });
    expect(captureApiError(error)).toBe(true);
    expect(captureServiceRecordError(error)).toBe(false);
    expect(captureApiError(error)).toBe(false);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({
      name: "ServiceRecordError",
      message: "Service-record submit-session failed: POST /service-record/[Filtered]/sessions/[Filtered]/submit (503)",
    }));
    expect(mockScope.setFingerprint).toHaveBeenCalledWith(["service-record", "submit-session", "POST", "/service-record/[Filtered]/sessions/[Filtered]/submit", "503"]);
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setContext).toHaveBeenCalledWith("serviceRecord", {
      operation: "submit-session", method: "POST", path: "/service-record/[Filtered]/sessions/[Filtered]/submit", status: 503, code: null, runtime: "browser",
    });
  });

  it("uses the URL sanitizer before templating and never includes request or response bodies", () => {
    const error = Object.assign(createAxiosError({ status: 500, url: "https://api.example.com/api/receipt/efr_SECRET/image?token=hidden" }), {
      request: { data: "private body" }, response: { status: 500, data: { name: "private name" } },
    });
    captureApiError(error);
    expect(mockScope.setContext).toHaveBeenCalledWith("api", expect.objectContaining({ path: "/api/receipt/[Filtered]/image" }));
    const captured = JSON.stringify([mockScope.setContext.mock.calls, mockScope.setTag.mock.calls, mockScope.setFingerprint.mock.calls, mockCaptureException.mock.calls[0][0].message]);
    expect(captured).not.toMatch(/efr_SECRET|hidden|private body|private name/);
  });

  it("flushes only captured errors and tolerates flush failures", async () => {
    mockFlush.mockRejectedValueOnce(new Error("Sentry unavailable"));
    const error = createAxiosError({ status: 502 });
    await expect(captureAndFlushApiError(error)).resolves.toBeUndefined();
    await captureAndFlushApiError(error);
    await captureAndFlushApiError(createAxiosError({ status: 404 }));
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledWith(2_000);
  });
});


describe("API document path templates and opaque id bounds", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["/api/documents/abcdefghijklmnop/void", "/api/documents/:id/void"],
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


describe("captureSessionRefreshNetworkError", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deduplicates a shared refresh network failure without forwarding its raw details", () => {
    const failure = new TypeError("https://private.example/refresh?token=private-fixture");
    expect(captureSessionRefreshNetworkError(failure)).toBe(true);
    expect(captureSessionRefreshNetworkError(failure)).toBe(false);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const captured = mockCaptureException.mock.calls[0][0] as Error;
    expect(captured).not.toBe(failure);
    expect(captured.name).toBe("ApiRequestError");
    expect(captured.message).toBe("API request failed: POST /api/auth/refresh (network)");
    expect(captured.stack).not.toContain("private-fixture");
  });

  it("ignores non-network refresh outcomes", () => {
    const httpFailure = Object.assign(new Error("Application session refresh failed"), {
      name: "ApplicationSessionRefreshError", status: 401,
    });
    for (const failure of [httpFailure, new Error("Unexpected failure"), null]) {
      expect(captureSessionRefreshNetworkError(failure)).toBe(false);
    }
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
