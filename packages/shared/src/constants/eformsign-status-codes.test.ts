import {
    COMPLETED_STATUS_CODES,
    DELETED_STATUS_CODES,
    EXPIRED_STATUS_CODES,
    EFORMSIGN_STATUS_CATEGORY_LABELS,
    getEformsignStatusCategory,
    getEformsignStatusLabel,
    EFORMSIGN_REVOKE_REQUESTED_STATUS_CODE,
    EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES,
    EFORMSIGN_REVOKED_STATUS_CODES,
    IN_PROGRESS_STATUS_CODES,
    isDeletedEformsignStatusCode,
    isRevokeRequestedEformsignStatus,
    isRevokedEformsignStatus,
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

describe("040 (doc_request_revoke)", () => {
    it("is recognised by code, name and number, and only 040", () => {
        expect(EFORMSIGN_REVOKE_REQUESTED_STATUS_CODE).toBe("040");
        expect(isRevokeRequestedEformsignStatus("040")).toBe(true);
        expect(isRevokeRequestedEformsignStatus(40)).toBe(true);
        expect(isRevokeRequestedEformsignStatus("doc_request_revoke")).toBe(true);
        for (const other of ["042", "090", "080", "060", null, undefined, ""]) {
            expect(isRevokeRequestedEformsignStatus(other)).toBe(false);
        }
    });

    it("keeps the expired category (filtering/tabs/stats are unchanged); only the display layer differs", () => {
        expect(getEformsignStatusCategory("040")).toBe("expired");
    });
});

describe("045 (doc_request_reject) is treated exactly like 040", () => {
    it("is part of the revoke-requested set, by code, name and number", () => {
        expect([...EFORMSIGN_REVOKE_REQUESTED_STATUS_CODES]).toEqual(["040", "045"]);
        expect(isRevokeRequestedEformsignStatus("045")).toBe(true);
        expect(isRevokeRequestedEformsignStatus(45)).toBe(true);
        expect(isRevokeRequestedEformsignStatus("doc_request_reject")).toBe(true);
        expect(getEformsignStatusCategory("045")).toBe("expired");
    });
});

describe("042 (doc_revoke) and 090 (withdrawal) are revoked", () => {
    it("is exactly 042 and 090, by code, name and number", () => {
        expect([...EFORMSIGN_REVOKED_STATUS_CODES]).toEqual(["042", "090"]);
        expect(isRevokedEformsignStatus("042")).toBe(true);
        expect(isRevokedEformsignStatus(42)).toBe(true);
        expect(isRevokedEformsignStatus("doc_revoke")).toBe(true);
        expect(isRevokedEformsignStatus("090")).toBe(true);
        expect(isRevokedEformsignStatus("doc_withdraw")).toBe(true);
        for (const other of ["040", "045", "041", "080", "060", "003", null, undefined, ""]) {
            expect(isRevokedEformsignStatus(other)).toBe(false);
        }
    });

    it("keeps the expired category (tabs/filters/stats unchanged)", () => {
        expect(getEformsignStatusCategory("042")).toBe("expired");
        expect(getEformsignStatusCategory("090")).toBe("expired");
        expect(EXPIRED_STATUS_CODES).toEqual(expect.arrayContaining(["042", "090"]));
    });
});

describe("041 (doc_refuse_revoke) is the document's live in-progress state, like 060", () => {
    it("normalizes the event name and is in progress, not expired and not a revoke request", () => {
        expect(normalizeEformsignStatusCode("doc_refuse_revoke")).toBe("041");
        expect(normalizeEformsignStatusCode(41)).toBe("041");
        expect(IN_PROGRESS_STATUS_CODES).toContain("041");
        expect(getEformsignStatusCategory("041")).toBe(getEformsignStatusCategory("060"));
        expect(getEformsignStatusCategory("041")).toBe("in-progress");
        expect(isRevokeRequestedEformsignStatus("041")).toBe(false);
        expect(EXPIRED_STATUS_CODES as readonly string[]).not.toContain("041");
    });
});
