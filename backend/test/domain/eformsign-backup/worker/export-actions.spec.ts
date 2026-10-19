import {
    BYTES_MISMATCH_ACTION, WORKER_REASON_CODES, WorkerError, actionForExportError, backoffSeconds, nextRetryAt,
    type ExportAction,
} from "domain/eformsign-backup/worker";

type Row = [string, number, string, Partial<ExportAction> & Pick<ExportAction, "reasonCode">];

/** One row per line of the contract §5 export-response table. */
const ROWS: Row[] = [
    ["429 RATE_LIMITED", 429, "RATE_LIMITED", { destinationAction: "retry_wait", runAction: "stop_downloads", reasonCode: "rate-limited" }],
    ["409 ARTIFACT_PENDING", 409, "ARTIFACT_PENDING", { destinationAction: "retry_wait", candidateAction: "retryable", runAction: "continue", reasonCode: "artifact-pending" }],
    ["409 MIRROR_MISSING", 409, "MIRROR_MISSING", { destinationAction: "retry_wait", candidateAction: "retryable", runAction: "continue", reasonCode: "mirror-missing" }],
    ["503 EXPORT_UNAVAILABLE", 503, "EXPORT_UNAVAILABLE", { destinationAction: "retry_wait", runAction: "stop_downloads_after_3_consecutive", reasonCode: "export-unavailable" }],
    ["500 INTERNAL", 500, "INTERNAL", { destinationAction: "retry_wait", runAction: "stop_downloads_after_3_consecutive", reasonCode: "export-unavailable" }],
    ["network failure", 0, "NETWORK", { destinationAction: "retry_wait", runAction: "stop_downloads_after_3_consecutive", reasonCode: "network-timeout" }],
    ["409 VERSION_CHANGED", 409, "VERSION_CHANGED", { destinationAction: "blocked", candidateAction: "blocked", runAction: "continue", reasonCode: "version-changed" }],
    ["409 CONSISTENCY_CONFLICT", 409, "CONSISTENCY_CONFLICT", { destinationAction: "blocked", candidateAction: "blocked", runAction: "continue", reasonCode: "consistency-conflict" }],
    ["409 ARTIFACT_TOO_LARGE", 409, "ARTIFACT_TOO_LARGE", { destinationAction: "blocked", runAction: "continue", reasonCode: "artifact-too-large" }],
    ["410 SOURCE_REMOVED", 410, "SOURCE_REMOVED", { destinationAction: "terminal_unless_held", candidateAction: "terminal_unavailable", runAction: "continue", reasonCode: "source-removed" }],
    ["410 SNAPSHOT_EXPIRED", 410, "SNAPSHOT_EXPIRED", { destinationAction: "unchanged", candidateAction: "unchanged", runAction: "stop_downloads", reasonCode: "snapshot-expired" }],
    ["409 SNAPSHOT_NOT_READY", 409, "SNAPSHOT_NOT_READY", { destinationAction: "unchanged", runAction: "poll_snapshot", reasonCode: "snapshot-not-ready" }],
    ["409 SNAPSHOT_FAILED", 409, "SNAPSHOT_FAILED", { destinationAction: "unchanged", runAction: "fail_run", reasonCode: "export-unavailable" }],
    ["409 IDEMPOTENCY_CONFLICT", 409, "IDEMPOTENCY_CONFLICT", { destinationAction: "unchanged", runAction: "fail_run", reasonCode: "idempotency-conflict" }],
    ["400 INVALID_REQUEST", 400, "INVALID_REQUEST", { destinationAction: "unchanged", runAction: "fail_run", reasonCode: "export-request-rejected" }],
    ["400 INVALID_CURSOR", 400, "INVALID_CURSOR", { runAction: "fail_run", reasonCode: "export-request-rejected" }],
    ["400 CURSOR_PARAMETER_MISMATCH", 400, "CURSOR_PARAMETER_MISMATCH", { runAction: "fail_run", reasonCode: "export-request-rejected" }],
    ["400 UNSUPPORTED_REVISION", 400, "UNSUPPORTED_REVISION", { runAction: "fail_run", reasonCode: "export-request-rejected" }],
    ["401 at download", 401, "UNAUTHORIZED", { destinationAction: "unchanged", candidateAction: "unchanged", runAction: "block_run", reasonCode: "credential-rejected" }],
    ["404 at download", 404, "NOT_FOUND", { destinationAction: "unchanged", runAction: "block_run", reasonCode: "credential-rejected" }],
];

describe("actionForExportError (contract §5)", () => {
    it.each(ROWS)("%s", (_name, httpStatus, code, expected) => {
        const action = actionForExportError({ httpStatus, code });
        expect(action).toMatchObject(expected);
        expect(action.reasonCode).toBeTruthy();
        expect((WORKER_REASON_CODES as readonly string[]).includes(action.reasonCode)).toBe(true);
    });

    it("fails the run at the snapshot stage for 401 and 404", () => {
        for (const [httpStatus, code] of [[401, "UNAUTHORIZED"], [404, "NOT_FOUND"]] as const) {
            expect(actionForExportError({ httpStatus, code, stage: "snapshot" })).toEqual({
                destinationAction: "unchanged", candidateAction: "unchanged", runAction: "fail_run", reasonCode: "credential-rejected",
            });
        }
    });

    it("decides an unknown code by status class and never leaves a reason code null", () => {
        expect(actionForExportError({ httpStatus: 502, code: "WHATEVER" })).toMatchObject({ destinationAction: "retry_wait", reasonCode: "export-unavailable" });
        expect(actionForExportError({ httpStatus: 429, code: "WHATEVER" })).toMatchObject({ reasonCode: "rate-limited" });
        expect(actionForExportError({ httpStatus: 418, code: "WHATEVER" })).toMatchObject({ runAction: "fail_run", reasonCode: "export-request-rejected" });
        expect(actionForExportError({ httpStatus: 302, code: "WHATEVER" })).toMatchObject({ runAction: "fail_run", reasonCode: "export-response-invalid" });
        expect(actionForExportError({ httpStatus: 401, code: "WHATEVER" })).toMatchObject({ reasonCode: "credential-rejected" });
        expect(actionForExportError({ httpStatus: 0, code: "WHATEVER" })).toMatchObject({ reasonCode: "network-timeout" });
        expect(actionForExportError({ httpStatus: 400, code: "__proto__" }).reasonCode).toBeTruthy();
        expect(actionForExportError({ httpStatus: 400, code: "constructor" }).reasonCode).toBeTruthy();
        for (let status = 0; status < 700; status++) {
            for (const code of ["", "X", "RATE_LIMITED", "NETWORK"]) {
                expect(actionForExportError({ httpStatus: status, code }).reasonCode).toBeTruthy();
            }
        }
    });

    it("hands out copies so a caller cannot change the table", () => {
        const first = actionForExportError({ httpStatus: 429, code: "RATE_LIMITED" });
        first.reasonCode = "internal";
        expect(actionForExportError({ httpStatus: 429, code: "RATE_LIMITED" }).reasonCode).toBe("rate-limited");
    });

    it("maps hash or length mismatch to integrity_error", () => {
        expect(BYTES_MISMATCH_ACTION).toEqual({
            destinationAction: "integrity_error", candidateAction: "unchanged", runAction: "continue", reasonCode: "artifact-integrity",
        });
    });
});

describe("backoffSeconds", () => {
    it("is min(60 * 2^(n-1), 21600) for n = 1..10", () => {
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(backoffSeconds)).toEqual([60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, 21600]);
    });

    it("stays at the 6 hour maximum for large attempts and rejects non-attempts", () => {
        expect(backoffSeconds(11)).toBe(21600);
        expect(backoffSeconds(1000)).toBe(21600);
        expect(backoffSeconds(Number.MAX_SAFE_INTEGER)).toBe(21600);
        for (const bad of [0, -1, 1.5, Number.NaN, Infinity]) expect(() => backoffSeconds(bad)).toThrow(WorkerError);
    });
});

describe("nextRetryAt", () => {
    const now = "2026-10-19T00:00:00.000Z";

    it("adds the backoff when Retry-After is absent or smaller", () => {
        expect(nextRetryAt(now, 1)).toBe("2026-10-19T00:01:00.000Z");
        expect(nextRetryAt(now, 3, 30)).toBe("2026-10-19T00:04:00.000Z");
        expect(nextRetryAt(new Date(now), 10)).toBe("2026-10-19T06:00:00.000Z");
    });

    it("uses Retry-After when it is larger than the backoff", () => {
        expect(nextRetryAt(now, 1, 600)).toBe("2026-10-19T00:10:00.000Z");
        expect(nextRetryAt(now, 1, 0.5)).toBe("2026-10-19T00:01:00.000Z");
    });

    it("ignores a Retry-After that is missing, negative or not finite, and rejects a bad clock", () => {
        for (const bad of [undefined, null, -5, Number.NaN, Infinity]) expect(nextRetryAt(now, 1, bad)).toBe("2026-10-19T00:01:00.000Z");
        expect(() => nextRetryAt("not a date", 1)).toThrow(WorkerError);
        expect(nextRetryAt(now, 1, 1e300)).toBe("2026-10-26T00:00:00.000Z"); // capped at 7 days
    });
});
