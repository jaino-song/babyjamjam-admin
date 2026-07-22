import axios from "axios";
import type { AxiosError, AxiosRequestConfig } from "axios";

type AxiosMockInternals = {
    requestInterceptorUse: jest.Mock;
    responseInterceptorUse: jest.Mock;
    apiPost: jest.Mock;
    barePost: jest.Mock;
};
type AxiosFunctionMock = jest.Mock & {
    create: jest.Mock;
    post: jest.Mock;
    __mockApi: AxiosMockInternals;
};

jest.mock("axios", () => {
    const requestInterceptorUse = jest.fn();
    const responseInterceptorUse = jest.fn();
    const apiPost = jest.fn();
    const barePost = jest.fn();
    const mockAxios = jest.fn() as AxiosFunctionMock;
    mockAxios.post = barePost;
    mockAxios.create = jest.fn(() => ({
        interceptors: {
            request: { use: requestInterceptorUse },
            response: { use: responseInterceptorUse },
        },
        post: apiPost,
    }));
    mockAxios.__mockApi = {
        requestInterceptorUse,
        responseInterceptorUse,
        apiPost,
        barePost,
    };

    return {
        __esModule: true,
        default: mockAxios,
    };
});

import "../client";

type RetryableRequestConfig = AxiosRequestConfig & {
    _retry?: boolean;
    _appAuthRetry?: boolean;
};
const mockAxios = axios as unknown as AxiosFunctionMock;

function getResponseRejectedHandler(): (err: AxiosError) => Promise<unknown> {
    const rejectedHandler = mockAxios.__mockApi.responseInterceptorUse.mock.calls[0]?.[1];
    if (!rejectedHandler) {
        throw new Error("Response interceptor was not registered");
    }
    return rejectedHandler as (err: AxiosError) => Promise<unknown>;
}

function createNetworkError(config: RetryableRequestConfig): AxiosError {
    return {
        name: "AxiosError",
        message: "Network Error",
        config,
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

function createUnauthorizedError(config: RetryableRequestConfig): AxiosError {
    return {
        name: "AxiosError",
        message: "Request failed with status code 401",
        config,
        response: {
            status: 401,
            data: { error: "Unauthorized" },
        },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

describe("api client network retry", () => {
    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset();
        window.history.replaceState({}, "", "/login");
    });

    it("should retry GET network errors exactly once", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/clients",
        };

        await getResponseRejectedHandler()(createNetworkError(originalRequest));

        expect(originalRequest._retry).toBe(true);
        expect(mockAxios).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("should not retry POST network errors", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "POST",
            url: "/message-trigger-rules",
        };
        const error = createNetworkError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(originalRequest._retry).toBeUndefined();
        expect(mockAxios).not.toHaveBeenCalled();
    });

    it("should not retry PATCH network errors", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "PATCH",
            url: "/message-trigger-rules/rule-1",
        };
        const error = createNetworkError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(originalRequest._retry).toBeUndefined();
        expect(mockAxios).not.toHaveBeenCalled();
    });
});

describe("api client app-session refresh", () => {
    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset();
        window.history.replaceState({}, "", "/login");
    });

    it("refreshes once and retries the original non-eformsign request", async () => {
        mockAxios.__mockApi.barePost.mockResolvedValue({ data: { success: true } });
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/message-logs",
        };

        await getResponseRejectedHandler()(createUnauthorizedError(originalRequest));

        expect(originalRequest._appAuthRetry).toBe(true);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledWith(
            "/api/auth/refresh",
            undefined,
            { withCredentials: true },
        );
        expect(mockAxios).toHaveBeenCalledWith(originalRequest);
    });

    it("shares one refresh across concurrent 401 responses and retries both originals", async () => {
        let resolveRefresh: (() => void) | undefined;
        mockAxios.__mockApi.barePost.mockImplementation(
            () => new Promise((resolve) => {
                resolveRefresh = () => resolve({ data: { success: true } });
            }),
        );
        const firstRequest: RetryableRequestConfig = { method: "GET", url: "/clients" };
        const secondRequest: RetryableRequestConfig = { method: "GET", url: "/message-logs" };

        const first = getResponseRejectedHandler()(createUnauthorizedError(firstRequest));
        const second = getResponseRejectedHandler()(createUnauthorizedError(secondRequest));
        resolveRefresh?.();
        await Promise.all([first, second]);

        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledTimes(2);
        expect(mockAxios).toHaveBeenCalledWith(firstRequest);
        expect(mockAxios).toHaveBeenCalledWith(secondRequest);
    });

    it("does not start another refresh after the retried request returns 401", async () => {
        const originalRequest: RetryableRequestConfig = {
            method: "GET",
            url: "/message-logs",
            _appAuthRetry: true,
        };
        const error = createUnauthorizedError(originalRequest);

        await expect(getResponseRejectedHandler()(error)).rejects.toBe(error);

        expect(mockAxios.__mockApi.barePost).not.toHaveBeenCalled();
        expect(mockAxios).not.toHaveBeenCalled();
    });
});
