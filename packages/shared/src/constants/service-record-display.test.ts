import { getSignatureStatusMeta } from "./service-record-display";

describe("getSignatureStatusMeta", () => {
    it("derives tone and label from the status code, not from English keywords in the Korean detail", () => {
        // The backend stores Korean statusDetail ("거부", "완료", step names); the old
        // keyword check looked for "reject"/"complete" and never matched.
        expect(getSignatureStatusMeta({ statusType: "061", statusDetail: "거부" })).toEqual({
            label: "거부",
            variant: "danger",
        });
        expect(getSignatureStatusMeta({ statusType: "050", statusDetail: "완료" })).toEqual({
            label: "서명 완료",
            variant: "success",
        });
        expect(getSignatureStatusMeta({ statusType: "080", statusDetail: "만료" })).toEqual({
            label: "만료",
            variant: "danger",
        });
    });

    it("uses the detail as display text for in-progress documents", () => {
        expect(getSignatureStatusMeta({ statusType: "070", statusDetail: "검토 요청" })).toEqual({
            label: "검토 요청",
            variant: "primary",
        });
        expect(getSignatureStatusMeta({ statusType: "060", statusDetail: "" })).toEqual({
            label: "진행 중",
            variant: "primary",
        });
    });

    it("keeps deleted documents neutral and falls back to a code-derived label", () => {
        expect(getSignatureStatusMeta({ statusType: "049", statusDetail: "삭제" })).toEqual({
            label: "삭제",
            variant: "neutral",
        });
        expect(getSignatureStatusMeta({ statusType: "061", statusDetail: " " })).toEqual({
            label: "거부·만료",
            variant: "danger",
        });
    });

    it("accepts provider status names and stays neutral for unknown or missing codes", () => {
        expect(getSignatureStatusMeta({ statusType: "doc_complete", statusDetail: "완료" }).variant).toBe("success");
        expect(getSignatureStatusMeta({ statusType: "zzz", statusDetail: "진행중" })).toEqual({
            label: "진행중",
            variant: "neutral",
        });
        expect(getSignatureStatusMeta({ statusDetail: "" })).toEqual({
            label: "상태 확인",
            variant: "neutral",
        });
        expect(getSignatureStatusMeta({ statusType: null, statusDetail: "COMPLETED" })).toEqual({
            label: "COMPLETED",
            variant: "neutral",
        });
    });
});

describe("getSignatureStatusMeta revoke request (040)", () => {
    it("shows a requested revoke as a non-terminal warning, ignoring a misleading stored detail", () => {
        for (const statusDetail of ["거부", "", null, "철회", "문서 취소 요청"]) {
            expect(getSignatureStatusMeta({ statusType: "040", statusDetail })).toEqual({
                label: "철회 요청됨",
                variant: "warning",
            });
        }
        expect(getSignatureStatusMeta({ statusType: "doc_request_revoke", statusDetail: "거부" })).toEqual({
            label: "철회 요청됨",
            variant: "warning",
        });
    });

    it("keeps the actual terminal negatives danger", () => {
        for (const statusType of ["011", "042", "061", "071", "080", "090"]) {
            expect(getSignatureStatusMeta({ statusType, statusDetail: "" }).variant).toBe("danger");
        }
    });
});
