import { reducer } from "./use-toast";

describe("error toast messages", () => {
  it("translates errors when an existing toast is updated", () => {
    const state = reducer({ toasts: [{ id: "loading", title: "처리 중", variant: "default" }] }, {
      type: "UPDATE_TOAST",
      toast: { id: "loading", variant: "destructive", title: "Error", description: "Failed to fetch" },
    });
    expect(state.toasts[0].title).toBe("요청을 처리하지 못했어요");
    expect(state.toasts[0].description).toContain("서버에 연결하지 못했어요");
  });

  it("filters technical details from error titles as well as descriptions", () => {
    const state = reducer({ toasts: [] }, {
      type: "ADD_TOAST",
      toast: { id: "error", variant: "destructive", title: "Prisma SQL query 오류", description: "password=secret 오류" },
    });
    expect(state.toasts[0].title).not.toMatch(/Prisma|SQL/);
    expect(state.toasts[0].description).not.toContain("secret");
  });
});
