import { assertOutboundRecipients } from "./outbound-recipient-policy";

describe("outbound recipient allowlist", () => {
    beforeEach(() => {
        const env = { ...process.env };
        delete env["OUTBOUND_ALLOWLIST_REQUIRED"];
        delete env["SMS_RECIPIENT_ALLOWLIST"];
        delete env["EMAIL_RECIPIENT_ALLOWLIST"];
        jest.replaceProperty(process, "env", env);
    });

    afterEach(() => jest.restoreAllMocks());

    it.each(["010-1234-5678", "01012345678", "+82 10 1234 5678"])("normalizes %s to the allowed number", (recipient) => {
        process.env["SMS_RECIPIENT_ALLOWLIST"] = "01012345678";
        expect(() => assertOutboundRecipients("SMS", [recipient])).not.toThrow();
    });

    it("blocks the whole batch if a single recipient is outside the list", () => {
        process.env["SMS_RECIPIENT_ALLOWLIST"] = "01000000001, 01012345678";
        expect(() => assertOutboundRecipients("SMS", ["01012345678", "01000000002"]))
            .toThrow(/^Blocked by staging recipient allowlist: SMS recipient \*\*\*0002$/);
    });

    it("trims addresses and compares them case insensitively", () => {
        process.env["EMAIL_RECIPIENT_ALLOWLIST"] = " qa@example.test, Other@Example.test ";
        expect(() => assertOutboundRecipients("email", [" QA@EXAMPLE.TEST ", "other@example.test"])).not.toThrow();
        expect(() => assertOutboundRecipients("email", ["unlisted@example.test"]))
            .toThrow(/^Blocked by staging recipient allowlist: email recipient \*\*\*@example\.test$/);
    });

    it("keeps delivery unrestricted when the flag and lists are absent", () => {
        expect(() => assertOutboundRecipients("SMS", ["01000000002"])).not.toThrow();
        expect(() => assertOutboundRecipients("email", ["unlisted@example.test"])).not.toThrow();
    });

    it.each(["", " , "])("keeps delivery unrestricted with blank lists (%p)", (list) => {
        process.env["SMS_RECIPIENT_ALLOWLIST"] = list;
        process.env["EMAIL_RECIPIENT_ALLOWLIST"] = list;
        expect(() => assertOutboundRecipients("SMS", ["01000000002"])).not.toThrow();
        expect(() => assertOutboundRecipients("email", ["unlisted@example.test"])).not.toThrow();
    });

    it.each([undefined, "TRUE"])("enforces each non-empty list independently with required set to %p", (flag) => {
        if (flag !== undefined) process.env["OUTBOUND_ALLOWLIST_REQUIRED"] = flag;
        process.env["SMS_RECIPIENT_ALLOWLIST"] = "01000000001";
        process.env["EMAIL_RECIPIENT_ALLOWLIST"] = " , ";
        expect(() => assertOutboundRecipients("SMS", ["01000000001"])).not.toThrow();
        expect(() => assertOutboundRecipients("SMS", ["01000000002"])).toThrow(/^Blocked by staging recipient allowlist/);
        expect(() => assertOutboundRecipients("email", ["unlisted@example.test"])).not.toThrow();
    });

    it.each([undefined, "", " , "])("blocks both channels with required and absent or empty lists (%p)", (list) => {
        process.env["OUTBOUND_ALLOWLIST_REQUIRED"] = "true";
        if (list !== undefined) {
            process.env["SMS_RECIPIENT_ALLOWLIST"] = list;
            process.env["EMAIL_RECIPIENT_ALLOWLIST"] = list;
        }
        expect(() => assertOutboundRecipients("SMS", ["01000000002"])).toThrow(/^Blocked by staging recipient allowlist/);
        expect(() => assertOutboundRecipients("email", ["qa@example.test"])).toThrow(/^Blocked by staging recipient allowlist/);
    });
});
