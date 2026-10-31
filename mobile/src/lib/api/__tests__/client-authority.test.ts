import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

import { invalidateAuthUser } from "@/lib/auth/invalidate-auth-user";
import { refreshApplicationSession } from "@/lib/auth/session-refresh";

import { api } from "../client";

jest.mock("@/lib/auth/invalidate-auth-user", () => ({
    invalidateAuthUser: jest.fn(),
}));
jest.mock("@/lib/auth/session-refresh", () => ({
    refreshApplicationSession: jest.fn(),
}));
jest.mock("@/lib/observability/capture-service-record-error", () => ({
    captureServiceRecordError: jest.fn(),
}));

const mockInvalidateAuthUser = jest.mocked(invalidateAuthUser);
const mockRefreshApplicationSession = jest.mocked(refreshApplicationSession);

function requestError(config: InternalAxiosRequestConfig, status: number): AxiosError {
    return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE", config, undefined, {
        status,
        statusText: status === 403 ? "Forbidden" : "Unauthorized",
        headers: {},
        config,
        data: { code: status === 403 ? "ACCESS_DENIED" : "AUTH_REQUIRED" },
    });
}

describe("Axios authority invalidation", () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        mockInvalidateAuthUser.mockReset().mockResolvedValue(undefined);
        mockRefreshApplicationSession.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it.each(["/clients", "/employees"])("invalidates auth on %s 403 without retrying or replacing the error", async (url) => {
        let error: AxiosError | undefined;
        const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
            error = requestError(config, 403);
            throw error;
        });
        api.defaults.adapter = adapter;

        const outcome = await api.get(url).catch((caught: unknown) => caught);

        expect(outcome).toBeInstanceOf(AxiosError);
        expect(outcome).toBe(error);
        expect(mockInvalidateAuthUser).toHaveBeenCalledTimes(1);
        expect(mockInvalidateAuthUser).toHaveBeenCalledWith();
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(mockRefreshApplicationSession).not.toHaveBeenCalled();
    });

    it("preserves the original 403 even if invalidation fails", async () => {
        mockInvalidateAuthUser.mockRejectedValue(new Error("invalidation unavailable"));
        const error = requestError({ headers: new AxiosHeaders(), url: "/clients" }, 403);
        const adapter = jest.fn(async () => { throw error; });
        api.defaults.adapter = adapter;

        await expect(api.get("/clients")).rejects.toBe(error);

        expect(mockInvalidateAuthUser).toHaveBeenCalledTimes(1);
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(mockRefreshApplicationSession).not.toHaveBeenCalled();
    });

    it.each(["/auth/me", "/auth/me?fresh=1", "/auth/me/", "https://example.test/api/auth/me"])("skips %s 403 to avoid an auth refetch loop", async (url) => {
        const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
            throw requestError(config, 403);
        });
        api.defaults.adapter = adapter;

        await expect(api.get(url)).rejects.toMatchObject({ response: { status: 403 } });

        expect(mockInvalidateAuthUser).not.toHaveBeenCalled();
        expect(mockRefreshApplicationSession).not.toHaveBeenCalled();
        expect(adapter).toHaveBeenCalledTimes(1);
    });

    it("keeps the single session refresh and retry for 401 without invalidating auth", async () => {
        const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
            throw requestError(config, 401);
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/clients")).rejects.toMatchObject({ response: { status: 401 } });

        expect(mockRefreshApplicationSession).toHaveBeenCalledTimes(1);
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(mockInvalidateAuthUser).not.toHaveBeenCalled();
    });
});
