import { classifyReviewItem } from "./holiday-review-classification";

const EVENT_DATE = "2026-11-10";
const NEW_END = "2026-11-16";
const free = { caseStatus: null, days: [] };

describe("classifyReviewItem", () => {
    it("is safe when there is no case or no session near the change", () => {
        expect(classifyReviewItem(free, EVENT_DATE, NEW_END)).toEqual({
            category: "safe",
            reason: "no_sessions_after_date",
        });
        expect(
            classifyReviewItem(
                { caseStatus: "WAITING_FOR_DETAILS", days: [{ date: "2026-11-09", locked: false }] },
                EVENT_DATE,
                NEW_END,
            ),
        ).toEqual({ category: "safe", reason: "no_sessions_after_date" });
    });

    it.each(["FINALIZING", "FINALIZATION_FAILED", "DOCUMENTS_CREATED", "COMPLETED"])(
        "is risk/finalized for the immutable case status %s",
        (status) => {
            expect(classifyReviewItem({ caseStatus: status, days: [] }, EVENT_DATE, NEW_END)).toEqual({
                category: "risk",
                reason: "finalized",
            });
        },
    );

    it("does not treat an ordinary in-progress status as finalized", () => {
        expect(classifyReviewItem({ caseStatus: "AWAITING_COMPLETION", days: [] }, EVENT_DATE, NEW_END).category).toBe(
            "safe",
        );
    });

    it("is risk when a session is recorded on or after the changed date (boundary included)", () => {
        const onDate = classifyReviewItem(
            { caseStatus: null, days: [{ date: EVENT_DATE, locked: false }] },
            EVENT_DATE,
            NEW_END,
        );
        expect(onDate).toEqual({ category: "risk", reason: "session_on_or_after_date" });
        const after = classifyReviewItem(
            { caseStatus: null, days: [{ date: "2026-11-12", locked: false }] },
            EVENT_DATE,
            NEW_END,
        );
        expect(after.reason).toBe("session_on_or_after_date");
    });

    it("is risk when a locked session lies after the new end (a fix would 409)", () => {
        // Earlier end (holiday removed): the new end 11-11 is before the locked 11-12 session,
        // and the change date 11-13 is after it, so only the lock rule applies.
        const result = classifyReviewItem(
            { caseStatus: null, days: [{ date: "2026-11-12", locked: true }] },
            "2026-11-13",
            "2026-11-11",
        );
        expect(result).toEqual({ category: "risk", reason: "locked_session_after_new_end" });
    });

    it("ignores an unlocked session before the change date and a locked one exactly on the new end", () => {
        const result = classifyReviewItem(
            { caseStatus: null, days: [{ date: "2026-11-11", locked: true }] },
            "2026-11-13",
            "2026-11-11",
        );
        expect(result.category).toBe("safe");
    });

    it("reports the first matching rule: finalized beats sessions", () => {
        expect(
            classifyReviewItem(
                { caseStatus: "COMPLETED", days: [{ date: "2026-11-12", locked: true }] },
                EVENT_DATE,
                NEW_END,
            ).reason,
        ).toBe("finalized");
    });
});
