import axios from "axios";
import type { AxiosError, AxiosRequestConfig } from "axios";

import {
    AuthSessionEndedError,
    TransientStreamError,
    createReconnectBackoff,
    openAuthenticatedEventSource,
} from "../authenticated-event-source";

// The real client module runs here (its refreshAppAuthSession is the single-flight
// under test); only axios, its network edge, is replaced.
type AxiosMockInternals = {
    responseInterceptorUse: jest.Mock;
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
    const barePost = jest.fn();
    const mockAxios = jest.fn() as AxiosFunctionMock;
    mockAxios.post = barePost;
    mockAxios.create = jest.fn(() => ({
        interceptors: {
            request: { use: requestInterceptorUse },
            response: { use: responseInterceptorUse },
        },
        post: jest.fn(),
    }));
    mockAxios.__mockApi = { responseInterceptorUse, barePost };
    return { __esModule: true, default: mockAxios };
});

jest.mock("@/lib/auth/authority-state", () => ({
    resetAuthorityState: jest.fn(),
}));

const mockAxios = axios as unknown as AxiosFunctionMock;
const ENDPOINT = "/api/realtime/events";

class FakeEventSource {
    static instances: FakeEventSource[] = [];
    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }
}

function unauthorizedRequestError(config: AxiosRequestConfig): AxiosError {
    return {
        name: "AxiosError",
        message: "Request failed with status code 401",
        config,
        response: { status: 401, data: { error: "Unauthorized" } },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

const refreshRejection = (status: number) => ({ response: { status, data: {} } });

describe("openAuthenticatedEventSource", () => {
    let fetchMock: jest.Mock;
    const originalFetch = globalThis.fetch;
    const originalEventSource = globalThis.EventSource;

    const probeResults = (...statuses: number[]) => {
        for (const status of statuses) fetchMock.mockResolvedValueOnce({ status });
    };

    beforeEach(() => {
        FakeEventSource.instances = [];
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: FakeEventSource,
        });
        fetchMock = jest.fn().mockResolvedValue({ status: 200 });
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset().mockResolvedValue({ data: { success: true } });
        window.history.replaceState({}, "", "/dashboard");
    });

    afterEach(() => {
        jest.useRealTimers();
        globalThis.fetch = originalFetch;
        Object.defineProperty(globalThis, "EventSource", {
            configurable: true,
            writable: true,
            value: originalEventSource,
        });
    });

    it("opens the stream without a refresh when the session probe is already 200", async () => {
        const source = await openAuthenticatedEventSource(ENDPOINT);

        expect(source).toBe(FakeEventSource.instances[0]);
        expect(FakeEventSource.instances[0].url).toBe(ENDPOINT);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me");
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
        expect(mockAxios.__mockApi.barePost).not.toHaveBeenCalled();
    });

    it("refreshes exactly once on a 401 probe, re-probes, then opens the stream", async () => {
        probeResults(401, 200);

        await openAuthenticatedEventSource(ENDPOINT);

        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledWith("/api/auth/refresh", undefined, {
            withCredentials: true,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(FakeEventSource.instances).toHaveLength(1);
    });

    it("three streams and an axios request hitting 401 at once share one refresh", async () => {
        probeResults(401, 401, 401);
        let finishRefresh: (value: unknown) => void = () => undefined;
        mockAxios.__mockApi.barePost.mockReturnValue(new Promise((resolve) => (finishRefresh = resolve)));
        mockAxios.mockResolvedValue({ data: "replayed" });

        const streams = [1, 2, 3].map(() => openAuthenticatedEventSource(ENDPOINT));
        const replayedConfig: AxiosRequestConfig = { method: "GET", url: "/clients" };
        const axiosRequest = (mockAxios.__mockApi.responseInterceptorUse.mock.calls[0][1] as (
            err: AxiosError,
        ) => Promise<unknown>)(unauthorizedRequestError(replayedConfig));
        // Let every probe land and the refresh be requested before the server answers.
        for (let i = 0; i < 20; i += 1) await Promise.resolve();

        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);

        finishRefresh({ data: { success: true } });
        await Promise.all([...streams, axiosRequest]);

        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(mockAxios).toHaveBeenCalledWith(replayedConfig); // the axios request really took the 401 path
        expect(FakeEventSource.instances).toHaveLength(3);
    });

    it("waits out AUTH_REFRESH_REPLAY_CONCURRENT (Retry-After) and then opens the stream", async () => {
        jest.useFakeTimers();
        probeResults(401, 200);
        mockAxios.__mockApi.barePost.mockRejectedValue({
            response: {
                status: 409,
                data: { code: "AUTH_REFRESH_REPLAY_CONCURRENT" },
                headers: { "retry-after": "2" },
            },
        });

        const opening = openAuthenticatedEventSource(ENDPOINT);
        const outcome = opening.then((source) => ({ source }), (error: unknown) => ({ error }));

        await jest.advanceTimersByTimeAsync(1999);
        expect(FakeEventSource.instances).toHaveLength(0);
        await jest.advanceTimersByTimeAsync(1);

        await expect(outcome).resolves.toEqual({ source: FakeEventSource.instances[0] });
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects with AuthSessionEndedError when the refresh itself returns 401", async () => {
        probeResults(401);
        mockAxios.__mockApi.barePost.mockRejectedValue(refreshRejection(401));

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(AuthSessionEndedError);
        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it("rejects with AuthSessionEndedError when the refresh returns 403 (rejected or pending account)", async () => {
        probeResults(401);
        mockAxios.__mockApi.barePost.mockRejectedValue({
            response: { status: 403, data: { code: "ACCOUNT_REJECTED" } },
        });

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(AuthSessionEndedError);
        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it("rejects with AuthSessionEndedError when the probe is still 401 after a successful refresh", async () => {
        probeResults(401, 401);

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(AuthSessionEndedError);
        expect(mockAxios.__mockApi.barePost).toHaveBeenCalledTimes(1);
        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it.each([
        ["a 502 refresh", () => probeResults(401), refreshRejection(502)],
        ["a refresh network error", () => probeResults(401), new Error("Network Error")],
    ])("treats %s as transient, not a logout", async (_label, arrange, rejection) => {
        arrange();
        mockAxios.__mockApi.barePost.mockRejectedValue(rejection);

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(TransientStreamError);
    });

    it("treats a 5xx probe as transient", async () => {
        probeResults(503);

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(TransientStreamError);
        expect(mockAxios.__mockApi.barePost).not.toHaveBeenCalled();
    });

    it("treats a probe network failure as transient", async () => {
        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

        await expect(openAuthenticatedEventSource(ENDPOINT)).rejects.toBeInstanceOf(TransientStreamError);
    });

    it("gives up on a bootstrap that never settles after 20 s with a transient error", async () => {
        jest.useFakeTimers();
        fetchMock.mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        );

        const outcome = openAuthenticatedEventSource(ENDPOINT).then(
            () => "opened",
            (error: unknown) => error,
        );
        await jest.advanceTimersByTimeAsync(19_999);
        expect(FakeEventSource.instances).toHaveLength(0);
        await jest.advanceTimersByTimeAsync(1);

        expect(await outcome).toBeInstanceOf(TransientStreamError);
        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it("rejects with an AbortError and opens nothing when the caller aborts mid-probe", async () => {
        const controller = new AbortController();
        fetchMock.mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        );

        const opening = openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal });
        controller.abort();

        await expect(opening).rejects.toMatchObject({ name: "AbortError" });
        expect(FakeEventSource.instances).toHaveLength(0);
    });

    it("does not even probe when the signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal })).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not open the stream when the caller aborts while the refresh is still running", async () => {
        probeResults(401);
        const controller = new AbortController();
        let finishRefresh: (value: unknown) => void = () => undefined;
        mockAxios.__mockApi.barePost.mockReturnValue(new Promise((resolve) => (finishRefresh = resolve)));

        const opening = openAuthenticatedEventSource(ENDPOINT, { signal: controller.signal });
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        controller.abort();
        finishRefresh({ data: {} });

        await expect(opening).rejects.toMatchObject({ name: "AbortError" });
        expect(FakeEventSource.instances).toHaveLength(0);
    });
});

describe("createReconnectBackoff", () => {
    it("doubles from 3 s and caps at 60 s", () => {
        const backoff = createReconnectBackoff();

        expect(Array.from({ length: 8 }, () => backoff.nextDelay())).toEqual([
            3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000,
        ]);
    });

    it("returns to 3 s only after reset", () => {
        const backoff = createReconnectBackoff();
        backoff.nextDelay();
        backoff.nextDelay();

        expect(backoff.nextDelay()).toBe(12_000);
        backoff.reset();
        expect(backoff.nextDelay()).toBe(3000);
    });
});
