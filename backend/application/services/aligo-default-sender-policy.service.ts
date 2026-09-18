import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ALIGO_SMS_API_PORT, ALIGO_DEFAULT_SENDER_POLICY_VERSION, type AligoDefaultSenderPolicy, type IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";

const policySchema = z.discriminatedUnion("availability", [
    z.object({ availability: z.literal("unavailable") }).strict(),
    z.object({ availability: z.literal("available"), provider: z.literal("aligo"),
        version: z.literal(ALIGO_DEFAULT_SENDER_POLICY_VERSION), mode: z.enum(["live", "stub"]),
        identityDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

/** Reads the actual configured adapter. It never sends, probes credentials, or accepts caller JSON. */
@Injectable()
export class AligoDefaultSenderPolicyService {
    constructor(@Inject(ALIGO_SMS_API_PORT) private readonly api: IAligoSmsApiPort) {}

    read(): AligoDefaultSenderPolicy {
        try {
            const result = policySchema.safeParse(this.api.getDefaultSenderPolicy?.());
            return result.success ? result.data : { availability: "unavailable" };
        } catch {
            return { availability: "unavailable" };
        }
    }
}
