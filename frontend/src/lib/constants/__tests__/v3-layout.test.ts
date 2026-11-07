import { isLayoutExcluded } from "../v3-layout";
import { PUBLIC_AUTH_PATHS } from "@/lib/auth/routes";

describe("V3 route chrome", () => {
    it("includes chat in standard admin chrome", () => { expect(isLayoutExcluded("/chat")).toBe(false); });
    it.each(["/", "/logout", "/select-branch", "/admin/users", ...PUBLIC_AUTH_PATHS])("keeps %s excluded", (route) => { expect(isLayoutExcluded(route)).toBe(true); });
    it.each(["/dashboard", "/clients", "/messages", "/contracts", "/chat/subpage"])("keeps %s in standard chrome", (route) => { expect(isLayoutExcluded(route)).toBe(false); });
});
