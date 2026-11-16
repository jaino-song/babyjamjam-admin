import { isLayoutExcluded } from "./v3-layout";

describe("mobile shell gating", () => {
  it.each(["/privacy", "/terms", "/privacy/", "/terms/", "/login", "/admin/feedback/1", "/admin/users"])("hides chrome on %s", (path) => {
    expect(isLayoutExcluded(path)).toBe(true);
  });

  it.each(["/admin/feedback", "/clients"])("shows the normal chrome on %s", (path) => {
    expect(isLayoutExcluded(path)).toBe(false);
  });
});
