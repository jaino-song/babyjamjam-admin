import { normalizeClientCreateInput, normalizeClientUpdateInput, type ClientWriteExisting } from "./client-write-normalization";

const existing: ClientWriteExisting = {
    voucherClient: true, type: "A통합1형", fullPrice: "100000", grant: "60000", actualPrice: "40000",
    duration: 2, startDate: new Date("2026-05-04T00:00:00Z"), endDate: new Date("2026-05-06T00:00:00Z"),
};

describe("client write descriptor shared with automation planning", () => {
    it("uses the submitted calendar day and Korean holidays, with canonical non-voucher pricing", () => {
        const write = normalizeClientCreateInput({
            name: "합성 고객", phone: "01000000001", fullPrice: "100,000", grant: "20,000", actualPrice: "80,000",
            startDate: "2026-05-04T23:00:00-04:00", endDate: "2026-05-06",
        });
        expect(write).toMatchObject({
            startDate: new Date("2026-05-04T00:00:00Z"), endDate: new Date("2026-05-06T00:00:00Z"),
            duration: 2, voucherClient: false, fullPrice: "100000", grant: "0", actualPrice: "100000", type: null,
        });
    });

    it("preserves a canonical voucher selection and pre-booking duration before dates are complete", () => {
        expect(normalizeClientCreateInput({
            name: "합성 고객", phone: "01000000001", voucherClient: true, type: "A통합1형",
            duration: 10, fullPrice: "100,000", grant: "60,000", actualPrice: "40,000",
        })).toMatchObject({ duration: 10, startDate: null, endDate: null, type: "A통합1형", grant: "60000", actualPrice: "40000" });
    });

    it("does not apply registration defaults or pricing to an unrelated partial update", () => {
        const write = normalizeClientUpdateInput(existing, { address: "합성 주소" });
        expect(write.address).toBe("합성 주소");
        for (const key of ["duration", "voucherClient", "type", "fullPrice", "grant", "actualPrice", "serviceStatus", "breastPump"] as const) {
            expect(Object.prototype.hasOwnProperty.call(write, key)).toBe(false);
        }
        expect(write.startDate).toBeUndefined();
    });

    it("preserves a contracted count when extending dates; fills only an absent count", () => {
        expect(normalizeClientUpdateInput(existing, { endDate: "2026-05-08" }).duration).toBeUndefined();
        expect(normalizeClientUpdateInput({ ...existing, duration: null }, { endDate: "2026-05-08" }).duration).toBe(4);
    });

    it("distinguishes explicit clears from omissions and rejects a count without a complete updated period", () => {
        expect(normalizeClientUpdateInput(existing, { endDate: null, duration: null })).toMatchObject({ endDate: null, duration: null });
        expect(() => normalizeClientUpdateInput(existing, { endDate: null, duration: 2 })).toThrow("시작일과 종료일이 모두");
        expect(() => normalizeClientUpdateInput(existing, { duration: null })).toThrow("1일 이상");
        expect(() => normalizeClientUpdateInput(existing, { duration: 3 })).toThrow("1일 이상 2일 이하");
    });

    it("normalizes an explicit non-voucher change using retained total price", () => {
        expect(normalizeClientUpdateInput(existing, { voucherClient: false })).toMatchObject({
            voucherClient: false, type: null, fullPrice: "100000", grant: "0", actualPrice: "100000",
        });
        expect(normalizeClientUpdateInput(existing, { actualPrice: null })).toMatchObject({
            type: "A통합1형", fullPrice: "100000", grant: "60000", actualPrice: null,
        });
    });

    it("rejects invalid calendar dates and reversed merged periods", () => {
        expect(() => normalizeClientUpdateInput(existing, { dueDate: "2026-02-31" })).toThrow();
        expect(() => normalizeClientUpdateInput(existing, { endDate: "2026-05-01" })).toThrow("시작일은 종료일보다");
    });

    it("never forwards action metadata or IDs into a customer patch", () => {
        const input = { name: "합성 수정", id: 9, targetVersion: "old", taskAutomation: { choice: "yes" }, eDocId: "injected" };
        const write = normalizeClientUpdateInput(existing, input);
        expect(write.name).toBe("합성 수정");
        for (const field of ["id", "targetVersion", "taskAutomation", "eDocId"]) expect(Object.prototype.hasOwnProperty.call(write, field)).toBe(false);
    });
});
