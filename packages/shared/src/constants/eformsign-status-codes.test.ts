import {
    COMPLETED_STATUS_CODES,
    EXPIRED_STATUS_CODES,
    REJECTED_STATUS_CODES,
} from "./eformsign-status-codes";

describe("COMPLETED_STATUS_CODES", () => {
    it("matches the eformsign completed-status snapshot (no drift across backend/frontend/mobile)", () => {
        expect(COMPLETED_STATUS_CODES).toEqual([
            "003", "012", "022", "032", "050", "062", "072", "092",
        ]);
    });
});

describe("EXPIRED_STATUS_CODES", () => {
    it("matches the canonical (backend semantics + 090) snapshot", () => {
        expect(EXPIRED_STATUS_CODES).toEqual([
            "011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080", "090",
        ]);
    });

    it("includes '090' (withdrawal), which frontend and mobile were both missing", () => {
        expect(EXPIRED_STATUS_CODES).toContain("090");
    });

    it("includes '047'/'049' (doc_request_delete / doc_delete), matching backend and frontend", () => {
        expect(EXPIRED_STATUS_CODES).toContain("047");
        expect(EXPIRED_STATUS_CODES).toContain("049");
    });

    it("does not overlap with COMPLETED_STATUS_CODES", () => {
        const overlap = EXPIRED_STATUS_CODES.filter((code) =>
            (COMPLETED_STATUS_CODES as readonly string[]).includes(code),
        );
        expect(overlap).toEqual([]);
    });

    it("exposes REJECTED_STATUS_CODES as the same set under backend's naming", () => {
        expect(REJECTED_STATUS_CODES).toBe(EXPIRED_STATUS_CODES);
    });
});
