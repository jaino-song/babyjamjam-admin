import {
    EFORMSIGN_IN_PROGRESS_STATUS_CODES,
    EFORMSIGN_REJECTED_STATUS_CODES,
    EFORMSIGN_REVOKE_REQUESTED_STATUS_DETAIL,
    TERMINAL_STATUS_CODES,
    UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE,
    UNASSIGNED_TERMINAL_STATUS_CODES,
    isReviewerRejectedStatus,
    isRevokeRequestedStatus,
} from "./eformsign-doc-status.constants";
import { normalizeEformsignStatusCode } from "../utils/eformsign-status-code";

describe("eformsign status code classification (single source)", () => {
    it.each(["040", "045", "doc_request_revoke", "doc_request_reject", 40, 45])(
        "reads %s as a revoke REQUEST",
        (status) => {
            expect(isRevokeRequestedStatus(status)).toBe(true);
        },
    );

    it.each(["041", "042", "060", "090", "080", null, undefined, ""])(
        "does not read %s as a revoke request",
        (status) => {
            expect(isRevokeRequestedStatus(status as never)).toBe(false);
        },
    );

    it("keeps 040/041/045 out of the terminal sets (a duplicate send stays blocked; the row can still advance)", () => {
        for (const code of ["040", "041", "045"]) {
            expect(TERMINAL_STATUS_CODES.has(code)).toBe(false);
            expect(UNASSIGNED_TERMINAL_STATUS_CODES.has(code)).toBe(false);
            expect(EFORMSIGN_REJECTED_STATUS_CODES.has(code)).toBe(false);
        }
        // 040 and 045 mirror each other after the review stage; 041 is plain in-progress.
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("040")).toBe(true);
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("045")).toBe(true);
    });

    it.each(["042", "090", "099", "047", "049", "011", "061", "080"])("keeps %s terminal", (code) => {
        expect(TERMINAL_STATUS_CODES.has(code)).toBe(true);
    });

    it("treats 041 (doc_refuse_revoke) as in-progress exactly like 060", () => {
        expect(normalizeEformsignStatusCode("doc_refuse_revoke")).toBe("041");
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("041")).toBe(true);
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("060")).toBe(true);
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("040")).toBe(false);
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("045")).toBe(false);
    });

    it.each(["071", "doc_reject_reviewer", 71])("reads %s as a reviewer rejection", (status) => {
        expect(isReviewerRejectedStatus(status)).toBe(true);
    });

    it.each(["070", "072", "061", "080", null, undefined, ""])("does not read %s as a reviewer rejection", (status) => {
        expect(isReviewerRejectedStatus(status as never)).toBe(false);
    });

    it("keeps 071 (reviewer rejection, 계약-04) out of every terminal set and in the in-progress set", () => {
        expect(TERMINAL_STATUS_CODES.has("071")).toBe(false);
        expect(UNASSIGNED_TERMINAL_STATUS_CODES.has("071")).toBe(false);
        expect(EFORMSIGN_REJECTED_STATUS_CODES.has("071")).toBe(false);
        expect(EFORMSIGN_IN_PROGRESS_STATUS_CODES.has("071")).toBe(true);
        // 070 and 072 still follow it on an unassigned row.
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("070")).toBe(true);
        expect(UNASSIGNED_FORWARD_STATUS_CODES_AFTER_REVIEW_STAGE.has("072")).toBe(true);
    });

    it("shares the webhook's revoke-requested detail text", () => {
        expect(EFORMSIGN_REVOKE_REQUESTED_STATUS_DETAIL).toBe("철회 요청");
    });
});
