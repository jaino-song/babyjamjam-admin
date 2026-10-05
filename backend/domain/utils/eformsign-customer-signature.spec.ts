import { isCancellableUnsignedContract } from "./eformsign-customer-signature";

describe("isCancellableUnsignedContract", () => {
    it.each(["001", "002", "010", "043", "020", "030", "060", "070"])(
        "allows unsigned status %s only outside provider review",
        (statusType) => {
            expect(isCancellableUnsignedContract({ statusType, stepType: "05", stepName: "고객 서명" })).toBe(true);
            expect(isCancellableUnsignedContract({ statusType, stepType: "06", stepName: "제공기관 확인" })).toBe(false);
            expect(isCancellableUnsignedContract({ statusType, stepType: null, stepName: "제공기관 검토" })).toBe(false);
        },
    );

    it.each(["003", "012", "022", "032", "050", "062", "072", "092", "047", "049", "099", "999", ""])(
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
