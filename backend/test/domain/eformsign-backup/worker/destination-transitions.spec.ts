import {
    DESTINATION_STATES, INTEGRITY_RETRY_LIMIT, WorkerError, assertVerifiedReusable, destinationKey,
    integrityRetryDecision, transitionDestination, type DestinationState,
} from "domain/eformsign-backup/worker";

type Origin = DestinationState | null;

/** Contract §5 table written out edge by edge, independent of the implementation's lookup table. */
const ALLOWED_EDGES: ReadonlyArray<readonly [Origin, DestinationState]> = [
    [null, "not_configured"],
    [null, "pending"],
    ["not_configured", "pending"],
    ["pending", "transferring"],
    ["transferring", "verifying"],
    ["transferring", "retry_wait"],
    ["verifying", "retry_wait"],
    ["retry_wait", "pending"],
    ["blocked", "pending"],
    ["verifying", "verified"],
    ["verifying", "integrity_error"],
    ["verified", "integrity_error"],
    ["integrity_error", "pending"],
    // "any (except verified) -> blocked"
    [null, "blocked"], ["not_configured", "blocked"], ["pending", "blocked"], ["transferring", "blocked"],
    ["verifying", "blocked"], ["retry_wait", "blocked"], ["blocked", "blocked"], ["integrity_error", "blocked"],
];

const ORIGINS: Origin[] = [null, ...DESTINATION_STATES];
const isAllowed = (from: Origin, to: DestinationState) => ALLOWED_EDGES.some(([f, t]) => f === from && t === to);

function reasonOf(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof WorkerError ? error.reasonCode : `other:${String(error)}`;
    }
}

describe("transitionDestination (T-WRK-01)", () => {
    it.each(ALLOWED_EDGES.map(([from, to]) => [String(from), String(to), from, to] as const))(
        "allows %s -> %s", (_f, _t, from, to) => {
            expect(transitionDestination(from, to)).toBe(to);
        });

    it("forbids every pair outside the table with forbidden-transition (full origin x target matrix)", () => {
        let checked = 0;
        for (const from of ORIGINS) {
            for (const to of DESTINATION_STATES) {
                if (isAllowed(from, to)) continue;
                expect({ from, to, reason: reasonOf(() => transitionDestination(from, to)) })
                    .toEqual({ from, to, reason: "forbidden-transition" });
                checked++;
            }
        }
        expect(ALLOWED_EDGES).toHaveLength(21);
        expect(checked).toBe(9 * 8 - 21);
    });

    it("forbids the named transitions of contract §5", () => {
        expect(reasonOf(() => transitionDestination("transferring", "verified"))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("pending", "verified"))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("retry_wait", "verified"))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("verified", "blocked"))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("verified", "pending"))).toBe("forbidden-transition");
    });

    it("refuses every step that creates or publishes while the ledger needs recovery", () => {
        const ctx = { recoveryRequired: true };
        expect(reasonOf(() => transitionDestination("pending", "transferring", ctx))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination(null, "pending", ctx))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("blocked", "pending", ctx))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("transferring", "verifying", ctx))).toBe("forbidden-transition");
        expect(reasonOf(() => transitionDestination("verifying", "verified", ctx))).toBe("forbidden-transition");
        expect(transitionDestination("verified", "integrity_error", ctx)).toBe("integrity_error");
    });

    it("never carries a verified result across destination revisions", () => {
        expect(reasonOf(() => assertVerifiedReusable("local-layout-v1", "local-layout-v2"))).toBe("forbidden-transition");
        expect(reasonOf(() => assertVerifiedReusable("local-layout-v1", "local-layout-v1"))).toBeNull();
        expect(reasonOf(() => transitionDestination("verified", "integrity_error", {
            fromDestinationRevision: "local-layout-v1", destinationRevision: "local-layout-v2",
        }))).toBe("forbidden-transition");
    });

    it("moves retry_wait to pending only once nextRetryAt has come", () => {
        const nextRetryAt = "2026-10-19T00:10:00.000Z";
        const at = (now: string) => () => transitionDestination("retry_wait", "pending", { now, nextRetryAt });
        expect(reasonOf(at("2026-10-19T00:09:59.999Z"))).toBe("forbidden-transition");
        expect(reasonOf(at("2026-10-19T00:10:00.000Z"))).toBeNull();
        expect(reasonOf(at("2026-10-19T00:10:01.000Z"))).toBeNull();
        expect(reasonOf(() => transitionDestination("retry_wait", "pending", { now: "2026-10-19T00:10:00.000Z" })))
            .toBe("forbidden-transition");
        expect(transitionDestination("retry_wait", "pending")).toBe("pending"); // replay passes no clock
    });

    it("stops automatic retries after the integrity limit", () => {
        expect(INTEGRITY_RETRY_LIMIT).toBe(3);
        expect(transitionDestination("integrity_error", "pending", { integrityErrorCount: 2 })).toBe("pending");
        expect(reasonOf(() => transitionDestination("integrity_error", "pending", { integrityErrorCount: 3 })))
            .toBe("forbidden-transition");
        expect(transitionDestination("integrity_error", "blocked", { integrityErrorCount: 3 })).toBe("blocked");
        expect(integrityRetryDecision(2)).toEqual({ to: "pending", reasonCode: null });
        expect(integrityRetryDecision(3)).toEqual({ to: "blocked", reasonCode: "integrity-repeated" });
    });

    it("keys an entry by artifact identity, destination identity and destination revision", () => {
        expect(destinationKey("a".repeat(64), "local:arch-1", "local-layout-v1")).toBe(`${"a".repeat(64)}|local:arch-1|local-layout-v1`);
    });
});
