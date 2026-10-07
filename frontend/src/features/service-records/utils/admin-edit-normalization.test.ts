import { normalizeHeaderChanges, normalizeSessionChanges } from "./admin-edit-normalization";

describe("admin edit normalization (mirrors the backend)", () => {
    it("trims every header string", () => {
        expect(normalizeHeaderChanges({ momName: " 이예지 ", babyWeight: "3.2 ", momBirth: "1999-01-01" }))
            .toEqual({ momName: "이예지", babyWeight: "3.2", momBirth: "1999-01-01" });
    });

    it("trims etcService and notes but leaves answers and other fields as sent", () => {
        const answers = { meals_meal: "3", sitzBath: " 실시 ", breast: ["이상없음"] };
        expect(normalizeSessionChanges({ sessionIndex: 2, etcService: " a ", notes: "b\n", paymentConfirmed: true, answers }))
            .toEqual({ sessionIndex: 2, etcService: "a", notes: "b", paymentConfirmed: true, answers });
    });

    it("keeps a whitespace-only text as an explicit blank", () => {
        expect(normalizeSessionChanges({ sessionIndex: 1, notes: "   " })).toEqual({ sessionIndex: 1, notes: "" });
        expect(normalizeHeaderChanges({ momName: "   " })).toEqual({ momName: "" });
    });
});
