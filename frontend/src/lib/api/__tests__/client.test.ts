import axios from "axios";
import type { AxiosError, AxiosRequestConfig } from "axios";

type AxiosMockInternals = {
    requestInterceptorUse: jest.Mock;
    responseInterceptorUse: jest.Mock;
    apiPost: jest.Mock;
};
type AxiosFunctionMock = jest.Mock & {
    create: jest.Mock;
    __mockApi: AxiosMockInternals;
};

jest.mock("axios", () => {
    const requestInterceptorUse = jest.fn();
    const responseInterceptorUse = jest.fn();
    const apiPost = jest.fn();
    const mockAxios = jest.fn() as AxiosFunctionMock;
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
    };

    return {
        __esModule: true,
        default: mockAxios,
    };
});

import "../client";

type RetryableRequestConfig = AxiosRequestConfig & { _retry?: boolean };
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

describe("api client network retry", () => {
    beforeEach(() => {
        mockAxios.mockClear();
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
