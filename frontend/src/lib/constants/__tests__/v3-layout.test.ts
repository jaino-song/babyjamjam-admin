import { isLayoutExcluded } from "../v3-layout";
import { PUBLIC_AUTH_PATHS } from "@/lib/auth/routes";

describe("V3 route chrome", () => {
    it("includes agent in standard admin chrome", () => { expect(isLayoutExcluded("/agent")).toBe(false); });
    it.each(["/", "/logout", "/select-branch", "/admin/users", ...PUBLIC_AUTH_PATHS])("keeps %s excluded", (route) => { expect(isLayoutExcluded(route)).toBe(true); });
    it.each(["/dashboard", "/clients", "/messages", "/contracts", "/agent/subpage"])("keeps %s in standard chrome", (route) => { expect(isLayoutExcluded(route)).toBe(false); });
});
