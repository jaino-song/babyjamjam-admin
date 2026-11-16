import { AUTH_ROUTES, isAuthPath, isPublicAuthPath } from "./routes";

describe("public route boundaries", () => {
  it.each(["/privacy", "/terms", "/privacy/", "/terms/"])("allows signed-out visitors to %s without making it an auth flow", (path) => {
    expect(isPublicAuthPath(path)).toBe(true);
    expect(isAuthPath(path)).toBe(false);
  });

  it.each(Object.values(AUTH_ROUTES))("preserves the auth route %s", (path) => {
    expect(isAuthPath(path)).toBe(true);
    expect(isPublicAuthPath(path)).toBe(true);
  });

  it.each(["/clients", "/privacy-settings", "/terms/new", "/privacy/new", "", null, undefined])("keeps %s protected", (path) => {
    expect(isPublicAuthPath(path)).toBe(false);
  });

  it("preserves public service-record links", () => {
    expect(isPublicAuthPath("/service-record/token")).toBe(true);
    expect(isAuthPath("/service-record/token")).toBe(false);
  });
});
