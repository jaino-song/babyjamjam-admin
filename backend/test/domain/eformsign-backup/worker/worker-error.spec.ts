import { WORKER_REASON_CODES, WorkerError, isWorkerReasonCode } from "domain/eformsign-backup/worker";

const REQUIRED = [
    "forbidden-transition", "ledger-seq-gap", "ledger-first-record", "ledger-schema", "ledger-checksum", "invalid-path-segment",
    "control-unavailable", "control-space", "archive-unavailable", "archive-conflict", "archive-unsafe-path", "archive-space",
    "archive-identity-mismatch", "archive-marker-invalid", "unsupported-filesystem", "artifact-integrity", "integrity-repeated",
    "pdf-shape", "token-file-invalid", "export-base-url-invalid", "export-response-invalid", "credential-rejected", "config-invalid",
    "lock-not-held", "not-initialized", "recovery-required", "restore-conflict", "restore-output-invalid", "crashed",
    "coverage-unverified", "drive-not-configured", "retry-exhausted-run", "snapshot-expired", "snapshot-not-ready",
    "exact-bytes-unavailable", "archive-not-mount-point", "source-removed", "version-changed", "consistency-conflict",
    "artifact-too-large", "rate-limited", "artifact-pending", "mirror-missing", "export-unavailable", "network-timeout",
    "export-request-rejected", "idempotency-conflict", "internal",
];

describe("WorkerError", () => {
    it("lists every reason code the contract units need, once each", () => {
        for (const code of REQUIRED) expect(WORKER_REASON_CODES).toContain(code);
        expect(new Set(WORKER_REASON_CODES).size).toBe(WORKER_REASON_CODES.length);
        for (const code of WORKER_REASON_CODES) expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    });

    it("carries the reason code and a message that is the code alone", () => {
        const error = new WorkerError("archive-conflict");
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("WorkerError");
        expect(error.reasonCode).toBe("archive-conflict");
        expect(error.message).toBe("archive-conflict");
    });

    it("recognises a reason code only for its exact spelling", () => {
        expect(isWorkerReasonCode("internal")).toBe(true);
        for (const bad of ["Internal", "", "toString", "__proto__", 5, null, undefined]) expect(isWorkerReasonCode(bad)).toBe(false);
    });
});
