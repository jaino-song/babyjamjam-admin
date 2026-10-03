import { decideReviewItemAction } from "./holiday-review";

describe("decideReviewItemAction", () => {
    const base = { storedEnd: "2026-11-13", recalculatedEnd: "2026-11-16", previousEnd: "2026-11-13" };

    it("creates an item when this change caused the mismatch (stored matched the previous calendar)", () => {
        expect(decideReviewItemAction({ ...base, hadOpenItem: false })).toEqual({
            obsoleteOpenItem: false,
            createItem: true,
        });
    });

    it("never nags a client whose stored end already differed before the change", () => {
        expect(decideReviewItemAction({ ...base, previousEnd: "2026-11-12", hadOpenItem: false })).toEqual({
            obsoleteOpenItem: false,
            createItem: false,
        });
    });

    it("creates nothing when the stored end already matches the new calendar", () => {
        expect(decideReviewItemAction({ ...base, recalculatedEnd: "2026-11-13", hadOpenItem: false })).toEqual({
            obsoleteOpenItem: false,
            createItem: false,
        });
    });

    it("obsoletes the older open item and recreates it when the end still differs, regardless of previous", () => {
        expect(decideReviewItemAction({ ...base, previousEnd: "2026-11-16", hadOpenItem: true })).toEqual({
            obsoleteOpenItem: true,
            createItem: true,
        });
    });

    it("obsoletes the older open item without a new one when the changes cancelled out", () => {
        expect(decideReviewItemAction({ ...base, recalculatedEnd: "2026-11-13", hadOpenItem: true })).toEqual({
            obsoleteOpenItem: true,
            createItem: false,
        });
    });
});
