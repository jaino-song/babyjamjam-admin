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
    it("is true only for unsigned, still-live contracts", () => {
        expect(isCancellableContractStatus("created")).toBe(true);
        expect(isCancellableContractStatus("requested")).toBe(true);
        expect(isCancellableContractStatus("opened")).toBe(true);
        expect(isCancellableContractStatus("completed")).toBe(false);
        expect(isCancellableContractStatus("revoked")).toBe(false);
        expect(isCancellableContractStatus(null)).toBe(false);
    });
});
