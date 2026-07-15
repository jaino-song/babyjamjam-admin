import { act, renderHook } from "@testing-library/react";
import { useChatStream } from "../useChatStream";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

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

describe("useChatStream SSE parsing", () => {
    const originalFetch = globalThis.fetch;
    const assignGlobalEncoding = () => {
        Object.assign(globalThis, {
            TextEncoder,
            TextDecoder: TextDecoder as unknown as typeof globalThis.TextDecoder,
        });
    };

    beforeEach(() => {
        localStorage.clear();
        assignGlobalEncoding();
        globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/api/ai/chat/stream")) {
                return {
                    ok: true,
                    body: createSSEStream([
                        'event: message\ndata: {"type":"chunk","content":"안',
                        '녕하세요"}\n\n',
                        'event: message\ndata: {"type":"done","sessionId":"sse-session-1"}',
                    ]),
                } as unknown as Response;
            }

            return {
                ok: true,
                json: async () => ({}),
            } as unknown as Response;
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("handles fragmented SSE events without dropping content", async () => {
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("테스트");
        });

        const assistant = result.current.messages[result.current.messages.length - 1];
        expect(assistant?.role).toBe("assistant");
        expect(assistant?.content).toBe("안녕하세요");
        expect(assistant?.isStreaming).toBe(false);
        expect(result.current.sessionId).toBe("sse-session-1");
        expect(result.current.state).toBe("complete");
    });
});
