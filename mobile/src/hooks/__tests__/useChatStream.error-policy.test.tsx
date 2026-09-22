import { act, renderHook } from "@testing-library/react";
import { useChatStream } from "../useChatStream";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

// EM v1.0 client policy pins for the chat stream error paths:
// - SSE `error` payloads are proxy-sanitized authored copy and render verbatim
//   (the legacy getUserErrorMessage adapter used to replace them with the
//   shared unknown message);
// - transport failures surface locally authored Korean copy only (never
//   `HTTP error: ...` / `Unknown error` internals);
// - confirm tool failures never interpolate the upstream error detail into
//   the conversation.

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index >= chunks.length) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(chunks[index]));
            index += 1;
        },
    });
}

describe("useChatStream error policy", () => {
    const originalFetch = globalThis.fetch;
    const originalTextEncoder = globalThis.TextEncoder;
    const originalTextDecoder = globalThis.TextDecoder;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        localStorage.clear();
        globalThis.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder;
        globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
        fetchMock = jest.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        globalThis.TextEncoder = originalTextEncoder;
        globalThis.TextDecoder = originalTextDecoder;
        jest.useRealTimers();
    });

    test("renders a sanitized SSE error payload verbatim instead of re-adapting it", async () => {
        const upstreamAuthoredCopy = "자동 전송 규칙을 찾을 수 없어요";
        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/api/ai/chat/stream")) {
                return {
                    ok: true,
                    body: createSSEStream([
                        `event: message\ndata: ${JSON.stringify({
                            type: "error",
                            error: upstreamAuthoredCopy,
                        })}\n\n`,
                    ]),
                } as unknown as Response;
            }
            return { ok: true, json: async () => ({}) } as unknown as Response;
        });

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("테스트");
        });

        const assistant = result.current.messages[result.current.messages.length - 1];
        // Stream end still settles the state to "complete" (pre-existing
        // behavior); the policy pin is that the authored payload copy renders
        // verbatim instead of being re-adapted.
        expect(result.current.error).toBe(upstreamAuthoredCopy);
        expect(assistant?.content).toBe(upstreamAuthoredCopy);
    });

    test("transport failure surfaces locally authored copy with no internal details", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        jest.useFakeTimers();
        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/api/ai/chat/stream")) {
                return { ok: false, status: 500 } as unknown as Response;
            }
            return { ok: true, json: async () => ({}) } as unknown as Response;
        });

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("테스트");
        });

        expect(consoleErrorSpy).toHaveBeenCalled();
        const assistant = result.current.messages[result.current.messages.length - 1];
        expect(assistant?.content).toBe("일시적인 오류가 발생했어요. 다시 시도합니다…");
        expect(assistant?.content).not.toContain("HTTP error");
        expect(assistant?.content).not.toContain("Unknown error");

        // The scheduled auto-retry is never advanced in this test; restore real
        // timers in afterEach so nothing fires after teardown.
    });

    test("a failed confirm tool result never interpolates the upstream error detail", async () => {
        fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/api/ai/chat/stream")) {
                return {
                    ok: true,
                    body: createSSEStream([
                        `event: message\ndata: ${JSON.stringify({
                            type: "confirmation",
                            confirmationMessage: "전송을 확인해 주세요",
                            confirmationIntentId: "intent-1",
                            confirmationNonce: "nonce-1",
                            sessionId: "confirm-session-1",
                        })}\n\n`,
                    ]),
                } as unknown as Response;
            }
            if (url.includes("/api/ai/chat/confirm")) {
                return {
                    ok: true,
                    json: async () => ({ success: false, error: "raw upstream tool detail" }),
                } as unknown as Response;
            }
            return { ok: true, json: async () => ({}) } as unknown as Response;
        });

        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("테스트");
        });

        expect(result.current.pendingConfirmation).not.toBeNull();

        await act(async () => {
            await result.current.confirmAction();
        });

        const assistant = result.current.messages[result.current.messages.length - 1];
        expect(assistant?.role).toBe("assistant");
        expect(assistant?.content).toBe("작업을 처리하지 못했습니다.");
        expect(assistant?.content).not.toContain("raw upstream tool detail");
    });
});
