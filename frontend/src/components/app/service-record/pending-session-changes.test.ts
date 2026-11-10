import { computePendingHeaderChanges, computePendingSessionChanges } from "./pending-session-changes";

const base = [{ sessionIndex: 1, draft: { breast: ["이상없음"], notes: "기존 메모", meals_meal: 3, meals_snack: 1 } }];

describe("computePendingSessionChanges", () => {
    it.each([
        ["answer change", { answers: { breast: ["울혈"] } }, "② 유방상태", "이상없음", "울혈"],
        ["cleared answer", { answers: { breast: [] } }, "② 유방상태", "이상없음", "입력 없음"],
        ["multi-select", { answers: { breast: ["울혈", "통증"] } }, "② 유방상태", "이상없음", "울혈, 통증"],
        ["note field", { notes: "새 메모" }, "특이사항", "기존 메모", "새 메모"],
        ["other service", { etcService: "추가 지원" }, "기타 서비스", "입력 없음", "추가 지원"],
        ["cleared note", { notes: "" }, "특이사항", "기존 메모", "입력 없음"],
        ["count subfield keeps sibling", { answers: { meals_snack: 2 } }, "⑤ 식사/간식", "식사 3회 · 간식 1회", "식사 3회 · 간식 2회"],
    ])("formats %s", (_name, patch, label, before, after) => {
        expect(computePendingSessionChanges(base, [{ sessionIndex: 1, ...patch }])).toEqual([
            { sessionIndex: 1, rows: [expect.objectContaining({ label, before, after })] },
        ]);
    });

    it("omits untouched sessions and keys reverted to the formatted base value", () => {
        expect(computePendingSessionChanges(base, [])).toEqual([]);
        expect(computePendingSessionChanges(base, [{ sessionIndex: 1, answers: { breast: ["이상없음"] }, notes: "기존 메모 " }])).toEqual([]);
    });

    it("sorts sessions ascending and fields in review order, including unwritten sessions", () => {
        const changes = computePendingSessionChanges(base, [
            { sessionIndex: 3, notes: "미래 기록" },
            { sessionIndex: 1, notes: "새 메모", answers: { breast: ["울혈"], perineum: ["열상"] } },
        ]);
        expect(changes.map((change) => change.sessionIndex)).toEqual([1, 3]);
        expect(changes[0].rows.map((row) => row.key)).toEqual(["perineum", "breast", "notes"]);
        expect(changes[1].rows[0].before).toBe("입력 없음");
    });
});

describe("computePendingHeaderChanges", () => {
    it("omits unchanged and absent empty header values", () => {
        expect(computePendingHeaderChanges({}, { momName: "" })).toEqual([]);
        expect(computePendingHeaderChanges({ momName: "기존" }, { momName: "기존" })).toEqual([]);
    });
    it("labels only changed header values and supplies the empty label", () => {
        expect(computePendingHeaderChanges({ momName: "기존", babyName: "아기", deliveryType: "자연분만" }, {
            momName: "변경", babyName: "", deliveryType: "자연분만",
        })).toEqual([
            { key: "momName", label: "산모 성명", before: "기존", after: "변경" },
            { key: "babyName", label: "신생아 성명", before: "아기", after: "입력 없음" },
        ]);
    });
});
