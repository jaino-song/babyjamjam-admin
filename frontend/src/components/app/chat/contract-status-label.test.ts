import { contractStatusResultLabel, isRejectedContractDocument } from "./contract-status-label";

function doc(displayStatus: string | null | undefined, statusType: string | undefined) {
    return {
        display_status: displayStatus,
        current_status: statusType === undefined ? undefined : { status_type: statusType },
    } as never;
}

describe("isRejectedContractDocument", () => {
    it("is true for the rejected_by_reviewer display status", () => {
        expect(isRejectedContractDocument(doc("rejected_by_reviewer", "071"))).toBe(true);
    });

    it("falls back to status code 071 when the display status is absent", () => {
        expect(isRejectedContractDocument(doc(undefined, "071"))).toBe(true);
        expect(isRejectedContractDocument(doc(null, "071"))).toBe(true);
    });

    it("is false for 070 and for any other known display status", () => {
        expect(isRejectedContractDocument(doc(undefined, "070"))).toBe(false);
        expect(isRejectedContractDocument(doc("signed", "071"))).toBe(false);
    });

    it("is false when there is no document", () => {
        expect(isRejectedContractDocument(null)).toBe(false);
        expect(isRejectedContractDocument(undefined)).toBe(false);
        expect(isRejectedContractDocument(doc(undefined, undefined))).toBe(false);
    });
});

describe("contractStatusResultLabel", () => {
    it("shows 반려됨 for a rejected contract although the summary reads signed", () => {
        expect(contractStatusResultLabel({ documentStatus: "requested", hasSigned: true, rejectedByReviewer: true })).toBe("반려됨");
    });

    it("keeps the summary wording for every other status", () => {
        expect(contractStatusResultLabel({ documentStatus: "requested", hasSigned: true })).toBe("서명 완료");
        expect(contractStatusResultLabel({ documentStatus: "requested", hasSigned: false, rejectedByReviewer: false })).toBe("서명 요청됨");
        expect(contractStatusResultLabel({ documentStatus: "completed", hasSigned: true, rejectedByReviewer: false })).toBe("계약 완료");
    });
});

describe("contractStatusResultLabel for a voided contract (계약 파기)", () => {
    it("reads 파기됨 whether or not the customer had signed", () => {
        expect(contractStatusResultLabel({ documentStatus: "voided", hasSigned: false })).toBe("파기됨");
        expect(contractStatusResultLabel({ documentStatus: "voided", hasSigned: true })).toBe("파기됨");
    });
});

describe("isRejectedContractDocument for a voided document", () => {
    it("is false: a voided display status is not a reviewer rejection, even at code 071", () => {
        expect(isRejectedContractDocument(doc("voided", "071"))).toBe(false);
    });
});
