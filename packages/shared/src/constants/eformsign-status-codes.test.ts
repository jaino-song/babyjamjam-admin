import {
    COMPLETED_STATUS_CODES,
    DELETED_STATUS_CODES,
    EXPIRED_STATUS_CODES,
    EFORMSIGN_STATUS_CATEGORY_LABELS,
    getEformsignStatusCategory,
    getEformsignStatusLabel,
    isDeletedEformsignStatusCode,
    normalizeEformsignStatusCode,
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

describe("canonical eformsign status semantics", () => {
    it.each([
        ["doc_complete", "003"],
        ["3", "003"],
        ["doc_request_delete", "047"],
        ["090", "090"],
        [" 070 ", "070"],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizeEformsignStatusCode(input)).toBe(expected);
    });

    it.each([
        ["003", "completed"],
        ["047", "expired"],
        ["049", "expired"],
        ["090", "expired"],
        ["001", "in-progress"],
        ["099", "unknown"],
        ["", "unknown"],
        [null, "unknown"],
        ["not-a-provider-code", "unknown"],
    ] as const)("categorizes %s as %s", (input, expected) => {
        expect(getEformsignStatusCategory(input)).toBe(expected);
    });

    it("keeps deleted visibility separate from semantic category", () => {
        expect(DELETED_STATUS_CODES).toEqual(["047", "049", "099"]);
        expect(isDeletedEformsignStatusCode("047")).toBe(true);
        expect(isDeletedEformsignStatusCode("049")).toBe(true);
        expect(isDeletedEformsignStatusCode("099")).toBe(true);
        expect(isDeletedEformsignStatusCode("090")).toBe(false);
        expect(getEformsignStatusCategory("047")).toBe("expired");
        expect(getEformsignStatusCategory("099")).toBe("unknown");
    });

    it("maps every category to the shared Korean label", () => {
        expect(getEformsignStatusLabel("003")).toBe(EFORMSIGN_STATUS_CATEGORY_LABELS.completed);
        expect(getEformsignStatusLabel("047")).toBe(EFORMSIGN_STATUS_CATEGORY_LABELS.expired);
        expect(getEformsignStatusLabel("001")).toBe(EFORMSIGN_STATUS_CATEGORY_LABELS["in-progress"]);
        expect(getEformsignStatusLabel(null)).toBe(EFORMSIGN_STATUS_CATEGORY_LABELS.unknown);
    });
});
