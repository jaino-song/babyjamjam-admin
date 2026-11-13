import { BadRequestException } from "@nestjs/common";

export type OpenManualRecoveryResponse = {
    kind: "editable"; jobId: string; claimEpoch: string; claimExpiresAt: string;
    document: { companyId: string; templateId: string; documentId: string };
} | { kind: "verify_only"; jobId: string; claimEpoch: string; claimExpiresAt: string };
export interface VerifyManualRecoveryResponse { kind: "pending" | "verified"; jobId: string; claimEpoch: string }
export function assertEmptyManualRecoveryBody(body: unknown): void {
    if (body === undefined) return;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) {
        throw new BadRequestException({ code: "VALIDATION_FAILED" });
    }
}
export function parseManualRecoveryEpochBody(body: unknown): bigint {
    if (body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1) {
        const value = (body as Record<string, unknown>)["claimEpoch"];
        if (typeof value === "string" && /^[1-9][0-9]{0,18}$/.exec(value)?.[0] === value && BigInt(value) <= 9223372036854775807n) return BigInt(value);
    }
    throw new BadRequestException({ code: "VALIDATION_FAILED" });
}
