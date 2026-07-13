import { buildSmsClientVariables } from "application/services/sms-client-variables";

describe("buildSmsClientVariables", () => {
    it("fills every PRICE_INFO variable from a fully-populated client", () => {
        const vars = buildSmsClientVariables({
            name: "김지니",
            phone: "010-1234-5678",
            type: "단태아 첫째아 A가1형",
            duration: 20,
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            area: { bankAccountInfo: { bankName: "국민", accNum: "123-45-6789" } },
        });
        expect(vars).toEqual({
            name: "김지니",
            clientName: "김지니",
            phone: "010-1234-5678",
            weeks: "4",
            duration: "20",
            type: "단태아 첫째아 A가1형",
            fullPrice: "1200000",
            grant: "1080000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
        });
    });

    it("computes weeks as floor(duration / 5)", () => {
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, duration: 23 }).weeks).toBe("4");
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, duration: 5 }).weeks).toBe("1");
    });

    it("falls back to empty strings (no literal placeholders) when fields are null", () => {
        const vars = buildSmsClientVariables({ name: "박산모", phone: null, type: null });
        expect(vars.weeks).toBe("0");
        expect(vars.duration).toBe("");
        expect(vars.fullPrice).toBe("");
        expect(vars.bankName).toBe("");
        expect(vars.accNum).toBe("");
        expect(vars.name).toBe("박산모");
    });

    it("handles a missing area / bankAccountInfo relation", () => {
        expect(buildSmsClientVariables({ name: "A", phone: null, type: null, area: null }).bankName).toBe("");
        expect(
            buildSmsClientVariables({ name: "A", phone: null, type: null, area: { bankAccountInfo: null } }).accNum,
        ).toBe("");
    });
});
