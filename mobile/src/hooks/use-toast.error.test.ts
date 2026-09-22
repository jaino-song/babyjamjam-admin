import { reducer } from "./use-toast";

// EM v1.0 client policy: the toast primitive renders caller copy verbatim.
// Every caller is responsible for passing display copy already resolved
// through the shared problem contract (normalizeApiError /
// resolveProblemPresentation) or authored locally — the legacy primitive-level
// string re-adaptation was removed because it re-interpreted registered
// catalog copy. Callers' resolution behavior is pinned in their own tests.
describe("error toast messages", () => {
  it("renders contract-resolved copy verbatim when an existing toast is updated", () => {
    const state = reducer({ toasts: [{ id: "loading", title: "처리 중", variant: "default" }] }, {
      type: "UPDATE_TOAST",
      toast: { id: "loading", variant: "destructive", title: "요청을 처리하지 못했어요", description: "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요." },
    });
    expect(state.toasts[0].title).toBe("요청을 처리하지 못했어요");
    expect(state.toasts[0].description).toContain("서버에 연결하지 못했어요");
  });

  it("renders authored destructive copy verbatim without re-interpretation", () => {
    const title = "고객 등록에 실패했어요";
    const description = "이미 등록된 전화번호예요. 등록된 고객으로 계약을 진행해 주세요.";
    const state = reducer({ toasts: [] }, {
      type: "ADD_TOAST",
      toast: { id: "error", variant: "destructive", title, description },
    });
    expect(state.toasts[0].title).toBe(title);
    expect(state.toasts[0].description).toBe(description);
  });
});
