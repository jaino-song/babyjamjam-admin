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

import { captureApiError } from "./capture-api-error";

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
  });

  it("ignores expected client errors and cancelled requests", () => {
    captureApiError(createAxiosError({ status: 409 }));
    captureApiError(createAxiosError({ code: "ERR_CANCELED" }));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("reports a server error once with sanitized endpoint context", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/messages/send?phone=01012345678",
    });

    captureApiError(error);
    captureApiError(error);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setLevel).toHaveBeenCalledWith("error");
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "POST",
      path: "/messages/send",
      status: 503,
      code: null,
      runtime: "browser",
    });
    expect(mockScope.setFingerprint).toHaveBeenCalledWith([
      "api-error",
      "POST",
      "/messages/send",
      "503",
    ]);
  });

  it("reports a network failure as a warning", () => {
    captureApiError(createAxiosError({ code: "ERR_NETWORK" }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
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
