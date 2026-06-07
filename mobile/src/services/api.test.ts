import { AxiosError } from "axios";

type ApiModule = typeof import("./api");

function createAxiosServerError(status: number): AxiosError {
    return new AxiosError(
        `Request failed with status code ${status}`,
        undefined,
        undefined,
        undefined,
        {
            config: {
                headers: {},
            } as never,
            data: {
                error: "stubbed upstream failure",
            },
            headers: {},
            status,
            statusText: "Server Error",
        },
    );
}

async function loadApiModule(): Promise<{
    apiModule: ApiModule;
    mockPost: jest.Mock;
}> {
    jest.resetModules();

    const mockPost = jest.fn();

    jest.doMock("@/lib/api/client", () => ({
        api: {
            delete: jest.fn(),
            get: jest.fn(),
            post: mockPost,
        },
    }));
    jest.doMock("@/lib/env", () => ({
        PUBLIC_BACKEND_BASE_URL: "http://localhost:3001",
    }));
    jest.doMock("@/lib/safe-storage", () => ({
        safeStorageSetItem: jest.fn(),
    }));

    return {
        apiModule: await import("./api"),
        mockPost,
    };
}

describe("eformsignApi.authenticate", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("stops automatic retries after three upstream 5xx failures", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost.mockRejectedValue(createAxiosServerError(503));

        await expect(apiModule.eformsignApi.authenticate(1)).rejects.toBeInstanceOf(AxiosError);
        await expect(apiModule.eformsignApi.authenticate(2)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );

        jest.setSystemTime(new Date("2026-06-07T00:00:30.001Z"));
        await expect(apiModule.eformsignApi.authenticate(3)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:01:00.002Z"));
        await expect(apiModule.eformsignApi.authenticate(4)).rejects.toBeInstanceOf(AxiosError);

        await expect(apiModule.eformsignApi.authenticate(5)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );
        expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it("allows forced retries and resets the automatic circuit after a success", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockResolvedValueOnce({ data: { success: true } })
            .mockResolvedValueOnce({ data: { success: true } });

        await expect(apiModule.eformsignApi.authenticate(1)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:00:30.001Z"));
        await expect(apiModule.eformsignApi.authenticate(2)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:01:00.002Z"));
        await expect(apiModule.eformsignApi.authenticate(3)).rejects.toBeInstanceOf(AxiosError);
        await expect(apiModule.eformsignApi.authenticate(4)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );

        await expect(
            apiModule.eformsignApi.authenticate(5, undefined, { force: true }),
        ).resolves.toEqual({ success: true });
        await expect(apiModule.eformsignApi.authenticate(6)).resolves.toEqual({ success: true });
        expect(mockPost).toHaveBeenCalledTimes(5);
    });
});
