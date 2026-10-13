import { getDocumentStatusCategory } from "application/utils/eformsign-document-list";

const doc = (status_type: string, step_type = "05", step_name = "이용자 서명") => ({
    id: "d",
    current_status: { status_type, step_type, step_name },
});

describe("getDocumentStatusCategory", () => {
    it.each([
        ["060", "drafting"],
        // 041 (doc_refuse_revoke): a refused revoke, the document continues exactly like 060.
        ["041", "drafting"],
        ["doc_refuse_revoke", "drafting"],
        ["062", "completed"],
        ["050", "completed"],
        // 040/045 keep the per-document "expired" tab; only their label/tone differ.
        ["040", "expired"],
        ["045", "expired"],
        ["042", "expired"],
        ["090", "expired"],
        ["080", "expired"],
        // 047/049/099 are deleted rows: never listed under a tab.
        ["047", "unknown"],
        ["099", "unknown"],
    ])("files %s under %s", (statusType, category) => {
        expect(getDocumentStatusCategory(doc(statusType))).toBe(category);
    });

    it("files 041 at the provider review step under in-progress, like 060", () => {
        expect(getDocumentStatusCategory(doc("041", "06", "제공기관 확인"))).toBe("in-progress");
        expect(getDocumentStatusCategory(doc("060", "06", "제공기관 확인"))).toBe("in-progress");
    });
});
