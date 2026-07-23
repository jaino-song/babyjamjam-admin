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

import { captureServiceRecordError } from "./capture-service-record-error";

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
      operation: "api",
      method: "POST",
      path: "/service-record/[Filtered]/sessions/1/submit",
      status: 503,
      code: null,
      runtime: "browser",
    });
  });
});
