import {
    describeScheduleBlockingReasons,
    formatSessionIndices,
    GENERIC_BLOCKING_REASON,
} from "./service-record-blocking-reasons";

describe("describeScheduleBlockingReasons", () => {
    it("groups 15 same-code reasons into one line with a 회차 range", () => {
        const reasons = Array.from({ length: 15 }, (_, index) => ({
            code: "MISSING_ASSIGNMENT_PROVENANCE",
            message: `Session ${index + 1} has no uniquely-owned service-record assignment`,
            sessionIndex: index + 1,
        }));
        const lines = describeScheduleBlockingReasons(reasons);
        expect(lines).toHaveLength(1);
        expect(lines[0].label).toBe("담당 제공인력 배정 정보를 찾을 수 없어요 (1–15회차)");
        expect(lines[0].label).not.toMatch(/[A-Za-z]/);
    });

    it("keeps one line per code for mixed codes, in first-seen order", () => {
        const lines = describeScheduleBlockingReasons([
            { code: "NON_SERVICE_DAY", message: "Session 5 is dated x", sessionIndex: 5 },
            { code: "MISSING_PLANNED_DATE", message: "Session 1 has no planned service date", sessionIndex: 1 },
            { code: "NON_SERVICE_DAY", message: "Session 3 is dated y", sessionIndex: 3 },
            { code: "NON_SERVICE_DAY", message: "Session 4 is dated z", sessionIndex: 4 },
            { code: "INVALID_SESSION_COUNT", message: "서비스 제공 회차 수가 설정되지 않았습니다." },
        ]);
        expect(lines.map((line) => line.label)).toEqual([
            "서비스일이 아닌 날짜가 있어요 (3–5회차)",
            "예정된 제공일이 없는 회차가 있어요 (1회차)",
            "서비스 제공 회차 수가 설정되지 않았어요.",
        ]);
    });

    it("falls back to the generic Korean line for an unknown code with an English message", () => {
        const lines = describeScheduleBlockingReasons([
            { code: "SOMETHING_NEW", message: "Something odd happened", sessionIndex: 2 },
            { code: "SOMETHING_NEW", message: "Something odd happened", sessionIndex: 3 },
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0].text).toBe(GENERIC_BLOCKING_REASON);
        expect(lines[0].label).toBe("제공일을 계산할 수 없는 회차가 있어요 (2–3회차)");
    });

    it("shows an unknown code's message as is when every message in the group is the same Korean text", () => {
        const lines = describeScheduleBlockingReasons([
            { code: "BRAND_NEW", message: "새로운 사유가 있습니다." },
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0].label).toBe("새로운 사유가 있습니다.");
    });

    it("groups 15 unknown-code reasons with session-specific Korean messages into one generic line", () => {
        const reasons = Array.from({ length: 15 }, (_, index) => ({
            code: "NEW_BLOCKER",
            message: `${index + 1}회차에 새로운 사유가 있습니다.`,
            sessionIndex: index + 1,
        }));
        const lines = describeScheduleBlockingReasons(reasons);
        expect(lines).toHaveLength(1);
        expect(lines[0].label).toBe("제공일을 계산할 수 없는 회차가 있어요 (1–15회차)");
    });

    it("keeps an identical Korean message for an unknown code across sessions and appends the range", () => {
        const lines = describeScheduleBlockingReasons([
            { code: "NEW_BLOCKER", message: "새로운 사유가 있어요.", sessionIndex: 2 },
            { code: "NEW_BLOCKER", message: "새로운 사유가 있어요.", sessionIndex: 4 },
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0].label).toBe("새로운 사유가 있어요 (2, 4회차)");
    });

    it("uses the generic line for mixed Korean/English or differing messages under one unknown code", () => {
        const mixed = describeScheduleBlockingReasons([
            { code: "BRAND_NEW", message: "첫 번째 사유" },
            { code: "BRAND_NEW", message: "Second reason" },
        ]);
        expect(mixed.map((line) => line.label)).toEqual([GENERIC_BLOCKING_REASON]);
        const differing = describeScheduleBlockingReasons([
            { code: "BRAND_NEW", message: "첫 번째 사유" },
            { code: "BRAND_NEW", message: "두 번째 사유" },
        ]);
        expect(differing.map((line) => line.label)).toEqual([GENERIC_BLOCKING_REASON]);
    });

    it("treats codes that collide with Object.prototype members as unknown", () => {
        const lines = describeScheduleBlockingReasons([
            { code: "constructor", message: "oops", sessionIndex: 1 },
            { code: "__proto__", message: "oops", sessionIndex: 2 },
            { code: "toString", message: "oops" },
        ]);
        expect(lines.map((line) => line.text)).toEqual([GENERIC_BLOCKING_REASON, GENERIC_BLOCKING_REASON, GENERIC_BLOCKING_REASON]);
        expect(lines.map((line) => line.code)).toEqual(["constructor", "__proto__", "toString"]);
    });

    it("counts decomposed Jamo as Korean", () => {
        const decomposed = "새로운 사유".normalize("NFD");
        expect(decomposed).not.toBe("새로운 사유");
        const [line] = describeScheduleBlockingReasons([{ code: "BRAND_NEW", message: decomposed }]);
        expect(line.label).toBe("새로운 사유");
    });

    it("prefers the Korean table over the backend message for known codes", () => {
        const [line] = describeScheduleBlockingReasons([
            { code: "EDITOR_PROJECTION_UNAVAILABLE", message: "서비스 예정 회차 근거를 확인할 수 없습니다." },
        ]);
        expect(line.label).toBe("서비스 예정 회차 근거를 확인할 수 없어요.");
    });
});

describe("formatSessionIndices", () => {
    it("collapses runs and lists the rest", () => {
        expect(formatSessionIndices([5, 1, 2, 3, 3])).toBe("1–3, 5회차");
        expect(formatSessionIndices([2])).toBe("2회차");
        expect(formatSessionIndices([])).toBe("");
    });
});
