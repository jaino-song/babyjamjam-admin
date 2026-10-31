/**
 * @jest-environment node
 */
import { authenticatedFetch, openAuthenticatedEventSource } from "../authenticated-fetch";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const mockQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
jest.mock("@/lib/queryClient", () => ({ getQueryClient: () => mockQueryClient }));
jest.mock("@/hooks/useGetAuthUser", () => ({ AUTH_USER_QUERY_KEY: ["authUser"] }));

describe("authenticatedFetch", () => {
    afterEach(() => {
        jest.restoreAllMocks();
        mockQueryClient.clear();
    });

    const authorityInputs = [
        "/auth/me",
        "/api/auth/me",
        "/auth/me/",
        "/api/auth/me/?refetch=1",
        "/api/auth/me?refetch=1",
        "/api/auth/me/#authority",
        "https://example.test/auth/me/?refetch=1",
        "https://example.test/api/auth/me?refetch=1",
        new URL("https://example.test/api/auth/me/?refetch=1"),
        new Request("https://example.test/auth/me/?refetch=1"),
        new Request("https://example.test/api/auth/me/?refetch=1"),
    ];

    describe.each([false, true])("authority 403 after refresh=%s", (afterRefresh) => {
        it.each(authorityInputs)("does not invalidate its own authority request: %s", async (input) => {
            mockQueryClient.setQueryData(["authUser"], { role: "admin" });
            const forbidden = new Response("forbidden", { status: 403 });
            const fetchMock = jest.spyOn(global, "fetch");
            if (afterRefresh) {
                fetchMock
                    .mockResolvedValueOnce(new Response(null, { status: 401 }))
                    .mockResolvedValueOnce(new Response(null, { status: 204 }));
            }
            fetchMock.mockResolvedValueOnce(forbidden);

            expect(await authenticatedFetch(input)).toBe(forbidden);
            expect(mockQueryClient.getQueryState(["authUser"])?.isInvalidated).toBe(false);
            expect(mockQueryClient.getQueryData(["authUser"])).toEqual({ role: "admin" });
            expect(fetchMock).toHaveBeenCalledTimes(afterRefresh ? 3 : 1);
            expect(forbidden.bodyUsed).toBe(false);
        });

        it.each([
            "/api/auth/me/settings",
            "/api/auth/member",
            "/api/clients?redirect=/auth/me",
            "/api/clients#redirect=/auth/me",
            "https://example.test/api/clients/?redirect=/auth/me",
            new URL("https://example.test/api/clients"),
            new Request("https://example.test/api/clients"),
        ])("still invalidates other forbidden requests: %s", async (input) => {
            mockQueryClient.setQueryData(["authUser"], { role: "admin" });
            const forbidden = new Response(null, { status: 403 });
            const fetchMock = jest.spyOn(global, "fetch");
            if (afterRefresh) {
                fetchMock
                    .mockResolvedValueOnce(new Response(null, { status: 401 }))
                    .mockResolvedValueOnce(new Response(null, { status: 204 }));
            }
            fetchMock.mockResolvedValueOnce(forbidden);

            expect(await authenticatedFetch(input)).toBe(forbidden);
            expect(mockQueryClient.getQueryState(["authUser"])?.isInvalidated).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(afterRefresh ? 3 : 1);
        });
    });

    it("returns the untouched 403, refetches authority, and neither retries nor clears unrelated state", async () => {
        const forbidden = Response.json({ code: "ACCESS_DENIED" }, { status: 403 });
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(forbidden);
        const freshUser = { role: "user" };
        const queryFn = jest.fn().mockResolvedValue(freshUser);
        mockQueryClient.setQueryData(["authUser"], { role: "admin" });
        mockQueryClient.setQueryData(["clients"], [42]);
        const observer = new QueryObserver(mockQueryClient, {
            queryKey: ["authUser"], queryFn, staleTime: Infinity,
        });
        let unsubscribe: () => void = () => undefined;
        const refreshed = new Promise<void>((resolve) => {
            unsubscribe = observer.subscribe((result) => {
                if (result.isSuccess && result.data.role === freshUser.role) resolve();
            });
        });
        try {
            expect(await authenticatedFetch("/api/clients")).toBe(forbidden);
            await refreshed;
            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(mockQueryClient.getQueryData(["authUser"])).toEqual(freshUser);
            expect(mockQueryClient.getQueryData(["clients"])).toEqual([42]);
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(forbidden.bodyUsed).toBe(false);
            expect(await forbidden.json()).toEqual({ code: "ACCESS_DENIED" });
        } finally {
            unsubscribe();
        }
    });

    it("also invalidates authority when the unchanged 401 retry returns 403", async () => {
        mockQueryClient.setQueryData(["authUser"], { role: "admin" });
        const forbidden = new Response("not JSON", { status: 403 });
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(forbidden);
        expect(await authenticatedFetch("/api/clients")).toBe(forbidden);
        expect(mockQueryClient.getQueryState(["authUser"])?.isInvalidated).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(forbidden.bodyUsed).toBe(false);
    });

    it("refreshes once and retries concurrent protected requests once", async () => {
        const attempts = new Map<string, number>();
        const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url === "/api/auth/refresh") {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return new Response(null, { status: 204 });
            }

            const attempt = (attempts.get(url) ?? 0) + 1;
            attempts.set(url, attempt);
            if (attempt === 1) {
                return Response.json({ code: "UPSTREAM_ERROR" }, { status: 401 });
            }
            return Response.json({ success: true });
        });

        const responses = await Promise.all([
            authenticatedFetch("/api/clients"),
            authenticatedFetch("/api/notifications"),
        ]);

        expect(responses.every((response) => response.ok)).toBe(true);
        expect(fetchMock.mock.calls.filter(([input]) => (
            input === "/api/auth/refresh"
        ))).toHaveLength(1);
        expect(attempts).toEqual(new Map([
            ["/api/clients", 2],
            ["/api/notifications", 2],
        ]));
    });

    it("preserves the request abort signal when retrying a streaming response", async () => {
        const controller = new AbortController();
        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(Response.json({ code: "UPSTREAM_ERROR" }, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response("data: streamed"));

        const response = await authenticatedFetch("/api/ai/chat/stream", {
            method: "POST",
            signal: controller.signal,
        });

        expect(await response.text()).toBe("data: streamed");
        expect(fetchMock.mock.calls[2]?.[1]?.signal).toBe(controller.signal);
    });

    it("does not refresh or retry after the original request is aborted", async () => {
        const controller = new AbortController();
        jest.spyOn(global, "fetch").mockImplementationOnce(async () => {
            controller.abort();
            return Response.json({ code: "UPSTREAM_ERROR" }, { status: 401 });
        });

        await expect(authenticatedFetch("/api/ai/chat/stream", {
            signal: controller.signal,
        })).rejects.toMatchObject({ name: "AbortError" });

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("recovers the application session before constructing an event stream", async () => {
        const originalEventSource = global.EventSource;
        const eventSourceConstructor = jest.fn();
        class TestEventSource {
            constructor(url: string | URL, options?: EventSourceInit) {
                eventSourceConstructor(url, options);
            }
        }
        global.EventSource = TestEventSource as unknown as typeof EventSource;

        const fetchMock = jest.spyOn(global, "fetch")
            .mockResolvedValueOnce(Response.json({ code: "UPSTREAM_ERROR" }, { status: 401 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(Response.json({ id: 42 }));

        try {
            await openAuthenticatedEventSource("/api/eformsign-docs/events");

            expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
                "/api/auth/me",
                "/api/auth/refresh",
                "/api/auth/me",
            ]);
            expect(eventSourceConstructor).toHaveBeenCalledWith(
                "/api/eformsign-docs/events",
                { withCredentials: false },
            );
        } finally {
            global.EventSource = originalEventSource;
        }
    });
});
