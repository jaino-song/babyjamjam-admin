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

    it("keeps an unknown reissue date blank without requiring a cancellation target", () => {
        useFormStore.getState().prefillFromContract({ clientId: 7, isContractReissue: true });
        expect(useFormStore.getState().paymentDate).toBe("");
        expect(useFormStore.getState().isContractReissue).toBe(true);
        expect(useFormStore.getState().supersede).toBeNull();
    });

    it.each(["contract", "client", "reset"])("clears reissue context on %s entry", (entry) => {
        useFormStore.getState().prefillFromContract({ clientId: 7, isContractReissue: true });
        if (entry === "contract") useFormStore.getState().prefillFromContract({ clientId: 8 });
        if (entry === "client") useFormStore.getState().prefillFromClient({ id: 8, name: "다른 산모" });
        if (entry === "reset") useFormStore.getState().resetAll();
        expect(useFormStore.getState().isContractReissue).toBe(false);
        expect(useFormStore.getState().paymentDate).not.toBe("");
    });
});
