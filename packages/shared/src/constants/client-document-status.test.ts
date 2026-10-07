import { getClientDocumentStatusMeta } from "./client-document-status";

describe("getClientDocumentStatusMeta", () => {
    it("keeps the unsigned labels when the customer has not signed", () => {
        expect(getClientDocumentStatusMeta("requested", { hasSigned: false })).toEqual({
            label: "서명 요청됨",
            variant: "warning",
        });
        expect(getClientDocumentStatusMeta("opened", { hasSigned: false }).label).toBe("열람됨");
        expect(getClientDocumentStatusMeta("created", { hasSigned: false }).label).toBe("발송 대기");
    });

    it("reads a signed-but-not-finalized contract as 서명 완료, never 서명 요청됨", () => {
        for (const status of ["requested", "opened", "created"]) {
            expect(getClientDocumentStatusMeta(status, { hasSigned: true })).toEqual({
                label: "서명 완료",
                variant: "info",
            });
        }
    });

    it("does not alter terminal or missing statuses when hasSigned is true", () => {
        expect(getClientDocumentStatusMeta("completed", { hasSigned: true }).label).toBe("계약 완료");
        expect(getClientDocumentStatusMeta("rejected", { hasSigned: true }).label).toBe("거부됨");
        expect(getClientDocumentStatusMeta(null, { hasSigned: true }).label).toBe("미발급");
    });

    it("never infers signed-ness from the status alone", () => {
        expect(getClientDocumentStatusMeta("requested", { hasSigned: undefined }).label).toBe("서명 요청됨");
        expect(getClientDocumentStatusMeta("requested", { hasSigned: null }).label).toBe("서명 요청됨");
    });
});
