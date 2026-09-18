import { ConfigService } from "@nestjs/config";
import { ALIGO_DEFAULT_SENDER_POLICY_VERSION } from "domain/ports/aligo-sms-api.port";
import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { AligoDefaultSenderPolicyService } from "./aligo-default-sender-policy.service";

const valid = { availability: "available", provider: "aligo", mode: "live", version: ALIGO_DEFAULT_SENDER_POLICY_VERSION, identityDigest: "a".repeat(64) };

describe("configured default-sender policy reader", () => {
    it("fails closed for legacy, throwing and malformed adapters without sending or logging source data", () => {
        const sendSms = jest.fn();
        expect(new AligoDefaultSenderPolicyService({ sendSms }).read()).toEqual({ availability: "unavailable" });
        expect(new AligoDefaultSenderPolicyService({ sendSms, getDefaultSenderPolicy() { throw new Error("unavailable"); } }).read())
            .toEqual({ availability: "unavailable" });
        for (const invalid of [undefined, null, {}, { ...valid, identityDigest: "raw-phone" }, { ...valid, version: "future" },
            { ...valid, mode: "unknown" }, { ...valid, sender: "01000000031" }, { ...valid, apiKey: "synthetic-secret" }]) {
            const reader = new AligoDefaultSenderPolicyService({ sendSms, getDefaultSenderPolicy: () => invalid } as never);
            expect(reader.read()).toEqual({ availability: "unavailable" });
        }
        expect(sendSms).not.toHaveBeenCalled();
    });

    it("retains a strict valid policy from the adapter", () => {
        const sendSms = jest.fn();
        const reader = new AligoDefaultSenderPolicyService({ sendSms, getDefaultSenderPolicy: () => valid } as never);
        expect(reader.read()).toEqual(valid);
        expect(sendSms).not.toHaveBeenCalled();
    });

    it("separates stub positive controls from live provider authority", () => {
        const values: Record<string, string> = { ALIGO_API_KEY: "synthetic-key", ALIGO_USER_ID: "synthetic-user", ALIGO_SENDER_PHONE: "01000000031" };
        const live = new AligoDefaultSenderPolicyService(new AligoApiClient({ get: (key: string) => values[key] } as ConfigService)).read();
        const stub = new AligoDefaultSenderPolicyService(new E2eAligoApiStub()).read();
        expect(live).toMatchObject({ availability: "available", mode: "live" });
        expect(stub).toMatchObject({ availability: "available", mode: "stub" });
        if (live.availability !== "available" || stub.availability !== "available") throw new Error("Missing configured fixture");
        expect(stub.identityDigest).not.toBe(live.identityDigest);
        expect(new AligoDefaultSenderPolicyService(new E2eAligoApiStub()).read()).toEqual(stub);
    });
});
