import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "../useChatStream";

describe("useChatStream command intercept", () => {
    beforeEach(() => {
        (global as any).fetch = jest.fn();
        localStorage.clear();
    });

    test("intercepts '산모 등록' and does not call SSE endpoint", async () => {
        const { result } = renderHook(() => useChatStream());

        await act(async () => {
            await result.current.sendMessage("산모 등록");
        });

        expect((global as any).fetch).not.toHaveBeenCalled();
        expect(result.current.messages.some((m: any) => m.ui?.type === "clientRegistrationWizard")).toBe(true);
    });
});
