import {
    hasCustomerSigned,
    isCancellableUnsignedContract,
    REQUESTED_DOCUMENT_STATUS_TYPES,
} from "./eformsign-customer-signature";

describe("isCancellableUnsignedContract", () => {
    it.each(["001", "002", "010", "043", "020", "030", "041", "060", "063", "064", "070", "071"])(
        "allows unsigned status %s only outside provider review",
        (statusType) => {
            expect(isCancellableUnsignedContract({ statusType, stepType: "05", stepName: "고객 서명" })).toBe(true);
            expect(isCancellableUnsignedContract({ statusType, stepType: "06", stepName: "제공기관 확인" })).toBe(false);
            expect(isCancellableUnsignedContract({ statusType, stepType: null, stepName: "제공기관 검토" })).toBe(false);
        },
    );

    it.each(["003", "012", "022", "032", "050", "062", "072", "092", "040", "042", "045", "047", "049", "090", "099", "999", ""])(
        "fails closed for status %s",
        (statusType) => {
            expect(isCancellableUnsignedContract({ statusType, stepType: "05", stepName: "고객 서명" })).toBe(false);
        },
    );

    it.each(["30", " doc_request_outsider "])("normalizes status %s", (statusType) => {
        expect(isCancellableUnsignedContract({ statusType, stepType: "05", stepName: null })).toBe(true);
    });

    it.each([null, undefined])("rejects a missing contract (%s)", (contract) => {
        expect(isCancellableUnsignedContract(contract)).toBe(false);
    });
});

describe("REQUESTED_DOCUMENT_STATUS_TYPES", () => {
    it("holds exactly the pre-signature requested states, 063/064 included", () => {
        expect([...REQUESTED_DOCUMENT_STATUS_TYPES].sort()).toEqual(["030", "041", "060", "063", "064", "070", "071"]);
    });

    it.each(["063", "064"])("reads %s as unsigned outside provider review and signed inside it, like 060", (statusType) => {
        expect(hasCustomerSigned({ statusType, stepType: "05", stepName: "고객 서명" })).toBe(false);
        expect(hasCustomerSigned({ statusType, stepType: "06", stepName: "제공기관 확인" })).toBe(true);
    });
});

describe("071 (reviewer rejection, 계약-04) reads like 070", () => {
    it("is a live requested state whose customer signature is valid at the provider-review step", () => {
        expect(REQUESTED_DOCUMENT_STATUS_TYPES.has("071")).toBe(true);
        expect(hasCustomerSigned({ statusType: "071", stepType: "06", stepName: "제공기관 확인" })).toBe(true);
        expect(hasCustomerSigned({ statusType: "070", stepType: "06", stepName: "제공기관 확인" })).toBe(true);
        expect(hasCustomerSigned({ statusType: "071", stepType: "05", stepName: "이용자 서명" })).toBe(false);
    });
});
