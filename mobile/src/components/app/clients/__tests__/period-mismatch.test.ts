import { dateDirectionParticle, periodFitToast } from "../period-mismatch";

describe("dateDirectionParticle", () => {
    it.each([
        [0, "으로"], [1, "로"], [2, "로"], [3, "으로"], [4, "로"],
        [5, "로"], [6, "으로"], [7, "로"], [8, "로"], [9, "로"],
    ])("uses the Korean date particle for digit %i", (digit, particle) => {
        expect(dateDirectionParticle(`2026.11.2${digit}`)).toBe(particle);
    });
});

it("does not claim an unchanged period was fitted", () => {
    expect(periodFitToast({ startDate: "2026-11-02T00:00:00+09:00", endDate: "2026-11-17" }, { startDate: "2026-11-02", endDate: "2026-11-17" })).toBeNull();
});

it.each([
    { startDate: null, endDate: null },
    { startDate: null, endDate: "2026-11-20" },
    { startDate: "2026-11-01", endDate: null },
])("does not claim an open period was fitted %j", (after) => {
    expect(periodFitToast({ startDate: "2026-11-02", endDate: "2026-11-17" }, after)).toBeNull();
});
