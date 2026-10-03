import { useFormStore } from "./form-store";

describe("form store contract re-issue target", () => {
    beforeEach(() => {
        useFormStore.getState().resetAll();
    });

    it("binds the replaced contract to the prefilled client and keeps its payment date", () => {
        useFormStore.getState().prefillFromContract({
            clientId: 7,
            name: "산모",
            paymentDate: "2026-09-15",
            supersedeDocumentId: "doc-old",
        });

        expect(useFormStore.getState().supersede).toEqual({ clientId: 7, documentId: "doc-old" });
        expect(useFormStore.getState().paymentDate).toBe("2026-09-15");
    });

    it("drops the target on any other form entry so a later contract never cancels it", () => {
        useFormStore.getState().prefillFromContract({ clientId: 7, supersedeDocumentId: "doc-old" });
        useFormStore.getState().prefillFromContract({ clientId: 8 });
        expect(useFormStore.getState().supersede).toBeNull();

        useFormStore.getState().prefillFromContract({ clientId: 7, supersedeDocumentId: "doc-old" });
        useFormStore.getState().prefillFromClient({ id: 9, name: "다른 산모" });
        expect(useFormStore.getState().supersede).toBeNull();

        useFormStore.getState().prefillFromContract({ clientId: 7, supersedeDocumentId: "doc-old" });
        useFormStore.getState().resetAll();
        expect(useFormStore.getState().supersede).toBeNull();
    });

    it("ignores a target without a client to bind it to", () => {
        useFormStore.getState().prefillFromContract({ supersedeDocumentId: "doc-old" });
        expect(useFormStore.getState().supersede).toBeNull();
    });
});
