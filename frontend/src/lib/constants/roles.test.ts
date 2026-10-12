import koTexts from "@/texts/ko.json";
import enTexts from "@/texts/en.json";
import {
    REGISTERABLE_ROLE_OPTIONS,
    ROLE_LABELS,
    getRoleLabel,
} from "./roles";

/** 권한-04 (BJJ-435): the role display names are 오너 / 지점장 / 매니저 / 회원. */
describe("role display names", () => {
    it("names every role in the shared map", () => {
        expect(ROLE_LABELS).toEqual({
            owner: "오너",
            admin: "지점장",
            manager: "매니저",
            user: "회원",
        });
    });

    it("shows user as 회원 and admin as 지점장 from getRoleLabel, with 회원 as the fallback", () => {
        expect(getRoleLabel("user")).toBe("회원");
        expect(getRoleLabel("admin")).toBe("지점장");
        expect(getRoleLabel("something-else")).toBe("회원");
    });

    it("offers the registerable roles under the same names", () => {
        expect(REGISTERABLE_ROLE_OPTIONS).toEqual([
            { value: "admin", label: "지점장" },
            { value: "manager", label: "매니저" },
            { value: "user", label: "회원" },
        ]);
    });

    it("keeps the Korean text catalog in step with the shared map", () => {
        expect(koTexts.roles).toMatchObject({
            owner: "오너",
            admin: "지점장",
            manager: "매니저",
            user: "회원",
        });
        expect(enTexts.roles.user).toBe("Member");
    });
});
