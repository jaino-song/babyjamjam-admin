import {
    WORKER_REASON_CODES, WorkerError, backoffSeconds, classifyDriveFailure, nextRetryAt,
    type DriveFailureAction, type DriveFailureFacts,
} from "domain/eformsign-backup/worker";

const NOW = new Date("2026-11-02T00:00:00.000Z");
const at = (seconds: number): string => new Date(NOW.getTime() + seconds * 1000).toISOString();
const http = (httpStatus: number, reason: string | null = null, retryAfterSeconds: number | null = null): DriveFailureFacts => ({
    kind: "http", httpStatus, reason, retryAfterSeconds,
});

describe("classifyDriveFailure (T23)", () => {
    it("retries network failures and timeouts as network-timeout", () => {
        for (const kind of ["network", "timeout"] as const) {
            expect(classifyDriveFailure({ kind, httpStatus: null, reason: null, retryAfterSeconds: null }, 1, NOW))
                .toEqual({ kind: "retry_wait", reasonCode: "network-timeout", nextRetryAt: at(60) });
        }
    });

    it("retries 429 and the three rate-limit 403 reasons as rate-limited", () => {
        const expected: DriveFailureAction = { kind: "retry_wait", reasonCode: "rate-limited", nextRetryAt: at(60) };
        expect(classifyDriveFailure(http(429), 1, NOW)).toEqual(expected);
        for (const reason of ["userRateLimitExceeded", "rateLimitExceeded", "sharingRateLimitExceeded"]) {
            expect(classifyDriveFailure(http(403, reason), 1, NOW)).toEqual(expected);
        }
    });

    it("uses Retry-After as a lower bound: it wins when longer than the backoff and loses when shorter", () => {
        expect(classifyDriveFailure(http(429, null, 600), 1, NOW)).toMatchObject({ nextRetryAt: at(600) });
        expect(classifyDriveFailure(http(403, "rateLimitExceeded", 600), 2, NOW)).toMatchObject({ nextRetryAt: at(600) });
        expect(classifyDriveFailure(http(429, null, 10), 3, NOW)).toMatchObject({ nextRetryAt: at(240) });
        expect(classifyDriveFailure(http(429, null, 0), 1, NOW)).toMatchObject({ nextRetryAt: at(60) });
        expect(classifyDriveFailure(http(429, null, 7200.2), 1, NOW)).toMatchObject({ nextRetryAt: at(7201) });
    });

    it("retries every 5xx as drive-unavailable", () => {
        for (const status of [500, 502, 503, 504, 599]) {
            expect(classifyDriveFailure(http(status), 1, NOW)).toEqual({ kind: "retry_wait", reasonCode: "drive-unavailable", nextRetryAt: at(60) });
        }
        expect(classifyDriveFailure(http(503, null, 900), 1, NOW)).toMatchObject({ nextRetryAt: at(900) });
    });

    it("blocks storageQuotaExceeded as drive-quota", () => {
        expect(classifyDriveFailure(http(403, "storageQuotaExceeded"), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-quota" });
    });

    it("blocks 401 and every other 403 as drive-permission", () => {
        expect(classifyDriveFailure(http(401), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-permission" });
        for (const reason of [null, "forbidden", "insufficientFilePermissions", "appNotAuthorizedToFile", "dailyLimitExceeded"]) {
            expect(classifyDriveFailure(http(403, reason), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-permission" });
        }
    });

    it("answers 404 as absent and 409 as compare, whatever Retry-After says", () => {
        expect(classifyDriveFailure(http(404, "notFound", 99), 1, NOW)).toEqual({ kind: "absent" });
        expect(classifyDriveFailure(http(409, "duplicate", 99), 1, NOW)).toEqual({ kind: "compare" });
    });

    it("blocks any other 4xx as drive-conflict", () => {
        for (const status of [400, 402, 405, 408, 410, 412, 413, 416, 422, 428, 451, 499]) {
            expect(classifyDriveFailure(http(status), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-conflict" });
        }
    });

    it("blocks a rejected token as drive-token-invalid, for any status and reason", () => {
        for (const httpStatus of [400, 401, null]) {
            for (const reason of ["invalid_grant", "invalid_client", "unauthorized_client"]) {
                expect(classifyDriveFailure({ kind: "token-rejected", httpStatus, reason, retryAfterSeconds: null }, 4, NOW))
                    .toEqual({ kind: "blocked", reasonCode: "drive-token-invalid" });
            }
        }
        // A forced refresh that Google rejects is not the same as an API 401 after a good refresh.
        expect(classifyDriveFailure(http(401), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-permission" });
    });

    it("grows the wait with the attempt number, capped, and reuses the export backoff", () => {
        const waits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map((attempt) => {
            const action = classifyDriveFailure(http(503), attempt, NOW);
            expect(action).toEqual({ kind: "retry_wait", reasonCode: "drive-unavailable", nextRetryAt: nextRetryAt(NOW, attempt, null) });
            return (Date.parse((action as { nextRetryAt: string }).nextRetryAt) - NOW.getTime()) / 1000;
        });
        expect(waits).toEqual([60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, 21600, 21600]);
        expect(waits).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map(backoffSeconds));
    });

    it("accepts the clock as a Date or an ISO string", () => {
        expect(classifyDriveFailure(http(503), 2, NOW.toISOString())).toEqual(classifyDriveFailure(http(503), 2, NOW));
    });

    it("ignores a reason that is not a plain Google reason string", () => {
        for (const reason of ["userRateLimitExceeded; DROP", "rateLimitExceeded ", "x".repeat(65), "", "a-b"]) {
            expect(classifyDriveFailure(http(403, reason), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-permission" });
        }
        expect(classifyDriveFailure(http(403, "storageQuotaExceeded "), 1, NOW)).toEqual({ kind: "blocked", reasonCode: "drive-permission" });
    });

    it("retries a status outside 4xx/5xx and a missing status as drive-unavailable instead of dropping the entry", () => {
        for (const httpStatus of [null, 0, 200, 302, 399, 600, 99999]) {
            expect(classifyDriveFailure({ kind: "http", httpStatus, reason: null, retryAfterSeconds: null }, 1, NOW))
                .toEqual({ kind: "retry_wait", reasonCode: "drive-unavailable", nextRetryAt: at(60) });
        }
    });

    it("refuses an attempt number below 1 or a non-integer with internal", () => {
        for (const attempts of [0, -1, 1.5, Number.NaN]) {
            expect(() => classifyDriveFailure(http(503), attempts, NOW)).toThrow(expect.objectContaining({ reasonCode: "internal" }));
        }
        expect(() => classifyDriveFailure(http(503), 1, "not a date")).toThrow(WorkerError);
        // Actions that do not wait never need a valid attempt.
        expect(classifyDriveFailure(http(404), 0, NOW)).toEqual({ kind: "absent" });
    });

    it("maps every kind/status/reason combination to one of the four actions with a known reason code and no extra data", () => {
        const kinds: Array<DriveFailureFacts["kind"]> = ["network", "timeout", "http", "token-rejected"];
        const reasons: Array<string | null> = [null, "rateLimitExceeded", "storageQuotaExceeded", "other"];
        let judged = 0;
        for (const kind of kinds) {
            for (let status = 100; status <= 599; status += 1) {
                for (const reason of reasons) {
                    const action = classifyDriveFailure({ kind, httpStatus: status, reason, retryAfterSeconds: 5 }, 2, NOW);
                    expect(["retry_wait", "blocked", "absent", "compare"]).toContain(action.kind);
                    if (action.kind === "retry_wait") {
                        expect(Object.keys(action).sort()).toEqual(["kind", "nextRetryAt", "reasonCode"]);
                        expect(Date.parse(action.nextRetryAt)).toBeGreaterThan(NOW.getTime());
                    }
                    if (action.kind === "blocked") expect(Object.keys(action).sort()).toEqual(["kind", "reasonCode"]);
                    if (action.kind === "retry_wait" || action.kind === "blocked") {
                        expect((WORKER_REASON_CODES as readonly string[]).includes(action.reasonCode)).toBe(true);
                        expect(action.reasonCode).toMatch(/^(drive-|rate-limited$|network-timeout$)/);
                    }
                    judged += 1;
                }
            }
        }
        expect(judged).toBe(4 * 500 * 4);
    });
});
