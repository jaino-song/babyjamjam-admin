/**
 * @jest-environment node
 */
import { authenticatedFetch, openAuthenticatedEventSource } from "../authenticated-fetch";

describe("authenticatedFetch", () => {
    afterEach(() => {
        jest.restoreAllMocks();
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
                return Response.json(
                    {
                        code: "AUTH_REFRESH_REQUIRED",
                        error: "Session refresh required",
                    },
                    { status: 401 },
                );
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
            .mockResolvedValueOnce(Response.json(
                { code: "AUTH_REFRESH_REQUIRED" },
                { status: 401 },
            ))
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
            return Response.json(
                { code: "AUTH_REFRESH_REQUIRED" },
                { status: 401 },
            );
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
            .mockResolvedValueOnce(Response.json(
                { code: "AUTH_REFRESH_REQUIRED" },
                { status: 401 },
            ))
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
