import { E2E_ROLE_COOKIE, getClientE2EAuthUser } from "@/lib/e2e";

describe("client E2E auth fixture", () => {
  afterEach(() => {
    document.cookie = `${E2E_ROLE_COOKIE}=; Max-Age=0; path=/`;
  });

  it("uses the owner fixture only for the explicit owner role cookie", () => {
    document.cookie = `${E2E_ROLE_COOKIE}=owner; path=/`;

    expect(getClientE2EAuthUser()).toMatchObject({ role: "owner", branchRole: "admin" });
  });

  it.each([undefined, "admin", "invalid"]) (
    "keeps the default admin fixture for %s role cookies",
    (role) => {
      if (role !== undefined) {
        document.cookie = `${E2E_ROLE_COOKIE}=${role}; path=/`;
      }

      expect(getClientE2EAuthUser()).toMatchObject({ role: "admin", branchRole: "admin" });
    },
  );
});
