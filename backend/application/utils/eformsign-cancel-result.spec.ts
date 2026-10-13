import { isDefinitiveVendorRefusal, successfulDeletedDocumentIds } from "./eformsign-cancel-result";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

describe("eformsign-cancel-result", () => {
    it.each([400, 401, 403, 422])("recognizes definitive %s", (status) => {
        expect(isDefinitiveVendorRefusal(new EformsignApiError("refused", status))).toBe(true);
    });
    it.each([404, 408, 429, 500, 503])("does not settle %s", (status) => {
        expect(isDefinitiveVendorRefusal(new EformsignApiError("uncertain", status))).toBe(false);
    });
    it.each(["4000004", "4000006"])("does not settle vendor absence %s", (code) => {
        expect(isDefinitiveVendorRefusal(new EformsignApiError("absent", 400, code))).toBe(false);
    });
    it("does not settle ordinary errors", () => expect(isDefinitiveVendorRefusal(new Error())).toBe(false));
    it.each([null, undefined, "bad", {}, { result: null }, { result: {} }, { result: { success_result: "doc" } }])(
        "returns no successes for malformed result %s", (result) => expect(successfulDeletedDocumentIds(result)).toEqual([]),
    );
    it("filters invalid ids without changing valid ids", () => {
        expect(successfulDeletedDocumentIds({ result: { success_result: ["doc-1", null, 3, "", "  ", " doc-2 "] } })).toEqual(["doc-1", " doc-2 "]);
    });
});
