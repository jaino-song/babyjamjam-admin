import {
    assertEformsignCreationOptions,
    assertStoredEformsignRecipients,
} from "./eformsign-recipient-policy";

describe("eformsign recipient allowlist", () => {
    const allowedRecipient = { id: "allowed@example.test" };

    beforeEach(() => {
        jest.replaceProperty(process, "env", {
            ...process.env,
            OUTBOUND_ALLOWLIST_REQUIRED: "true",
            SMS_RECIPIENT_ALLOWLIST: "",
            EMAIL_RECIPIENT_ALLOWLIST: "allowed@example.test",
        });
    });

    afterEach(() => jest.restoreAllMocks());

    it("allows a stored recipient with a listed email", () => {
        expect(() => assertStoredEformsignRecipients({
            current_status: { step_recipients: [allowedRecipient] },
            previous_status: [],
        })).not.toThrow();
    });

    it("blocks a stored recipient without a phone or email", () => {
        expect(() => assertStoredEformsignRecipients({
            current_status: { step_recipients: [{ name: "Unverified recipient" }] },
            previous_status: [],
        })).toThrow(/^Blocked by staging recipient allowlist: eformsign recipients could not be verified$/);
    });

    it("allows creation mode without a document ID and with listed recipients", () => {
        expect(() => assertEformsignCreationOptions({
            mode: { type: "01" },
            prefill: { recipients: [allowedRecipient] },
        })).not.toThrow();
    });

    it.each([
        { type: "02" },
        { type: "01", document_id: "existing-document" },
    ])("blocks creation with incompatible mode options (%p)", (mode) => {
        expect(() => assertEformsignCreationOptions({
            mode,
            prefill: { recipients: [allowedRecipient] },
        })).toThrow(/^Blocked by staging recipient allowlist: eformsign recipients could not be verified$/);
    });
});
