import { renderHook, act } from "@testing-library/react";
import { useChatStream, ChatMessage } from "../use-chat-stream";

describe("useChatStream command intercept", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = jest.fn();
        localStorage.clear();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("intercepts '산모 등록' and does not call SSE endpoint", async () => {
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("산모 등록");
        });

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(result.current.messages.some((m: ChatMessage) => m.ui?.type === "clientRegistrationWizard")).toBe(true);
    });
});
