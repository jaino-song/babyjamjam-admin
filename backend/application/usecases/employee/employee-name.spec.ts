import { areEmployeeNamesEqual } from "domain/repositories/employee.repository.interface";

describe("areEmployeeNamesEqual", () => {
    it.each([
        [" Alice  Kim ", "alice\tKIM"],
        ["김 관리사", "  김\n관리사  "],
        ["가", "가"],
        ["Élodie", "e\u0301LODIE"],
    ])("matches normalized names %s / %s", (left, right) => {
        expect(areEmployeeNamesEqual(left, right)).toBe(true);
    });

    it("does not identify a different person by phone", () => {
        expect(areEmployeeNamesEqual("김 관리사", "이 관리사")).toBe(false);
    });
});
