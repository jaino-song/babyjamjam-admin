import { contractPaymentDateFromFields, isCancellableContractStatus } from "./contract-reissue";

describe("contractPaymentDateFromFields", () => {
    const fields = (year: unknown, month: unknown, day: unknown) => [
        { id: "고객명", value: "홍길동" },
        { id: "본인부담금 수령 년도", value: year },
        { id: "본인부담금 수령 월", value: month },
        { id: "본인부담금 수령 일", value: day },
    ];

    it("reads the two-digit year the template stores", () => {
        expect(contractPaymentDateFromFields(fields("26", "09", "15"))).toBe("2026-09-15");
    });

    it("accepts a four-digit year and unpadded month/day", () => {
        expect(contractPaymentDateFromFields(fields("2026", "9", "5"))).toBe("2026-09-05");
    });

    it("returns null when a part is missing or the date does not exist", () => {
        expect(contractPaymentDateFromFields(fields("26", "", "15"))).toBeNull();
        expect(contractPaymentDateFromFields(fields("26", "02", "30"))).toBeNull();
        expect(contractPaymentDateFromFields(undefined)).toBeNull();
    });
});

describe("isCancellableContractStatus", () => {
    const unsigned = { hasSigned: false };

    it("is true only for unsigned, still-live contracts", () => {
        expect(isCancellableContractStatus("created", unsigned)).toBe(true);
        expect(isCancellableContractStatus("requested", unsigned)).toBe(true);
        expect(isCancellableContractStatus("opened", unsigned)).toBe(true);
        expect(isCancellableContractStatus("completed", unsigned)).toBe(false);
        expect(isCancellableContractStatus("revoked", unsigned)).toBe(false);
        // A cancellation is already pending; it must not be cancellable again.
        expect(isCancellableContractStatus("revoke_requested", unsigned)).toBe(false);
        expect(isCancellableContractStatus(null, unsigned)).toBe(false);
    });

    it("is false once the customer has signed, even though documentStatus still reads requested", () => {
        expect(isCancellableContractStatus("requested", { hasSigned: true })).toBe(false);
        expect(isCancellableContractStatus("opened", { hasSigned: true })).toBe(false);
        expect(isCancellableContractStatus("created", { hasSigned: true })).toBe(false);
    });
});
