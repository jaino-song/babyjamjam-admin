import { reducer } from "./use-toast";

// EM v1.0 client policy: the toast primitive renders caller copy verbatim.
// Callers resolve failures through the shared problem contract
// (normalizeApiError / resolveProblemPresentation) or author local copy before
// toasting — the primitive never re-runs a legacy string adapter over it, so
// registered-code outcomes reach the user flow unmodified.
describe("destructive toast copy", () => {
  it("passes caller copy through verbatim when a toast is created", () => {
    const state = reducer({ toasts: [] }, {
      type: "ADD_TOAST",
      toast: { id: "error", variant: "destructive", title: "저장하지 못했어요", description: "요청이 충돌해 처리할 수 없어요" },
    });
    expect(state.toasts[0].title).toBe("저장하지 못했어요");
    expect(state.toasts[0].description).toBe("요청이 충돌해 처리할 수 없어요");
  });

  it("passes caller copy through verbatim when an existing toast is updated", () => {
    const state = reducer({ toasts: [{ id: "loading", title: "처리 중", variant: "default" }] }, {
      type: "UPDATE_TOAST",
      toast: { id: "loading", variant: "destructive", title: "재발송을 요청하지 못했어요", description: "서버가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요" },
    });
    expect(state.toasts[0].title).toBe("재발송을 요청하지 못했어요");
    expect(state.toasts[0].description).toBe("서버가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요");
  });

  it("never rewrites registered-code copy into legacy phrasing", () => {
    const registeredCopy = "로그인이 필요해요. 다시 로그인해 주세요.";
    const state = reducer({ toasts: [] }, {
      type: "ADD_TOAST",
      toast: { id: "auth", variant: "destructive", description: registeredCopy },
    });
    expect(state.toasts[0].description).toBe(registeredCopy);
  });
});
