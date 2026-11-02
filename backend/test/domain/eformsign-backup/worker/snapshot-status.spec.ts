import {
    DESTINATION_STATES, HISTORICAL_COVERAGES, SNAPSHOT_STATUSES, WORKER_REASON_CODES, emptyLedgerState, isSuccessfulSnapshotStatus,
    judgeHistoricalCoverage, judgeSnapshotStatus, type DestinationState, type LedgerState, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";

type Entry = { state: DestinationState; reasonCode: WorkerReasonCode | null };

describe("judgeSnapshotStatus (T-WRK-03)", () => {
    const verified: Entry = { state: "verified", reasonCode: null };

    it("is failed when the snapshot could not be made or read, whatever else holds", () => {
        const result = judgeSnapshotStatus({ snapshotFailure: "credential-rejected", controlFailure: "control-unavailable", localEntries: [verified] });
        expect(result).toEqual({ snapshotStatus: "failed", reasonCodes: ["credential-rejected"] });
    });

    it("is blocked on a control failure", () => {
        expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: "control-unavailable", localEntries: [verified] }))
            .toEqual({ snapshotStatus: "blocked", reasonCodes: ["control-unavailable"] });
    });

    it("is blocked when any included artifact is blocked, carrying the distinct sorted reasons", () => {
        const result = judgeSnapshotStatus({
            snapshotFailure: null, controlFailure: null,
            localEntries: [verified, { state: "blocked", reasonCode: "archive-unavailable" }, { state: "blocked", reasonCode: "control-space" },
                { state: "blocked", reasonCode: "archive-unavailable" }],
        });
        expect(result).toEqual({ snapshotStatus: "blocked", reasonCodes: ["archive-unavailable", "control-space"] });
        expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: null, localEntries: [{ state: "blocked", reasonCode: null }] }))
            .toEqual({ snapshotStatus: "blocked", reasonCodes: ["archive-unavailable"] });
    });

    it("is partial for everything else, even when every artifact is verified", () => {
        const expected = { snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-not-configured"] };
        expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: null, localEntries: [verified, verified] })).toEqual(expected);
        expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: null, localEntries: [] })).toEqual(expected);
        expect(judgeSnapshotStatus({
            snapshotFailure: null, controlFailure: null,
            localEntries: [{ state: "retry_wait", reasonCode: "rate-limited" }, { state: "integrity_error", reasonCode: null }],
        })).toEqual(expected);
    });

    describe("Drive destination (BJJ-456)", () => {
        const base = { snapshotFailure: null, controlFailure: null, localEntries: [verified] } as const;
        const unbound = judgeSnapshotStatus({ ...base });

        it("is byte-identical to today when the drive input is omitted or unbound, whatever else it carries", () => {
            expect(unbound).toEqual({ snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-not-configured"] });
            expect(judgeSnapshotStatus({ ...base, drive: { bound: false, phaseFailure: null, entryReasons: [] } })).toEqual(unbound);
            expect(judgeSnapshotStatus({ ...base, drive: { bound: false, phaseFailure: "drive-quota", entryReasons: ["drive-permission"] } })).toEqual(unbound);
        });

        it("drops drive-not-configured for a bound destination and keeps the run partial", () => {
            expect(judgeSnapshotStatus({ ...base, drive: { bound: true, phaseFailure: null, entryReasons: [] } }))
                .toEqual({ snapshotStatus: "partial", reasonCodes: ["coverage-unverified"] });
        });

        it("replaces drive-not-configured by the Drive phase failure and the distinct sorted entry reasons", () => {
            expect(judgeSnapshotStatus({ ...base, drive: { bound: true, phaseFailure: "drive-token-invalid", entryReasons: [] } }))
                .toEqual({ snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-token-invalid"] });
            expect(judgeSnapshotStatus({
                ...base,
                drive: { bound: true, phaseFailure: null, entryReasons: ["rate-limited", "drive-quota", "rate-limited", "network-timeout"] },
            })).toEqual({ snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-quota", "network-timeout", "rate-limited"] });
            expect(judgeSnapshotStatus({
                ...base, drive: { bound: true, phaseFailure: "drive-not-configured", entryReasons: ["drive-permission", "drive-not-configured"] },
            })).toEqual({ snapshotStatus: "partial", reasonCodes: ["coverage-unverified", "drive-not-configured", "drive-permission"] });
        });

        it("never lets a Drive failure make the run blocked or failed (u1-driveblocks)", () => {
            for (const phaseFailure of [null, "drive-not-configured", "drive-token-invalid", "drive-root-changed", "drive-quota", "drive-unavailable",
                "drive-permission", "drive-conflict", "network-timeout", "rate-limited", "artifact-integrity", "crashed"] as const) {
                const judged = judgeSnapshotStatus({
                    ...base, drive: { bound: true, phaseFailure, entryReasons: ["drive-permission", "artifact-integrity", "archive-unavailable", "control-unavailable"] },
                });
                expect(judged.snapshotStatus).toBe("partial");
            }
        });

        it("leaves failed and blocked judgements exactly as they are for a bound destination", () => {
            const drive = { bound: true, phaseFailure: "drive-token-invalid", entryReasons: ["drive-quota"] } as const;
            expect(judgeSnapshotStatus({ snapshotFailure: "credential-rejected", controlFailure: null, localEntries: [verified], drive }))
                .toEqual({ snapshotStatus: "failed", reasonCodes: ["credential-rejected"] });
            expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: "control-unavailable", localEntries: [verified], drive }))
                .toEqual({ snapshotStatus: "blocked", reasonCodes: ["control-unavailable"] });
            expect(judgeSnapshotStatus({ snapshotFailure: null, controlFailure: null, localEntries: [{ state: "blocked", reasonCode: "archive-unavailable" }], drive }))
                .toEqual({ snapshotStatus: "blocked", reasonCodes: ["archive-unavailable"] });
        });

        it("can never produce complete for a bound destination over the whole reason-code space", () => {
            for (const phaseFailure of [null, ...WORKER_REASON_CODES]) {
                for (const entryReason of WORKER_REASON_CODES) {
                    const judged = judgeSnapshotStatus({ ...base, drive: { bound: true, phaseFailure, entryReasons: [entryReason] } });
                    expect(judged.snapshotStatus).toBe("partial");
                    expect(judged.reasonCodes).toContain("coverage-unverified");
                }
            }
        });
    });

    it("can never produce complete or skipped_overlap, over a broad input matrix", () => {
        const failures: Array<WorkerReasonCode | null> = [null, "credential-rejected", "snapshot-not-ready", "export-request-rejected"];
        const controls: Array<WorkerReasonCode | null> = [null, "control-unavailable", "control-space"];
        const codes: Array<WorkerReasonCode | null> = [null, ...WORKER_REASON_CODES];
        let judged = 0;
        for (const snapshotFailure of failures) {
            for (const controlFailure of controls) {
                for (const state of DESTINATION_STATES) {
                    for (const reasonCode of codes) {
                        for (const localEntries of [[], [{ state, reasonCode }], [{ state, reasonCode }, { state: "verified" as const, reasonCode: null }]]) {
                            const { snapshotStatus, reasonCodes } = judgeSnapshotStatus({ snapshotFailure, controlFailure, localEntries });
                            expect(["failed", "blocked", "partial"]).toContain(snapshotStatus);
                            expect(snapshotStatus).not.toBe("complete");
                            expect(snapshotStatus).not.toBe("skipped_overlap");
                            expect(reasonCodes.length).toBeGreaterThan(0);
                            judged++;
                        }
                    }
                }
            }
        }
        expect(judged).toBeGreaterThan(10_000);
    });

    it("never counts skipped_overlap, or anything this worker can judge, as a successful run", () => {
        expect(isSuccessfulSnapshotStatus("skipped_overlap")).toBe(false);
        for (const status of ["failed", "blocked", "partial"] as const) expect(isSuccessfulSnapshotStatus(status)).toBe(false);
        expect(SNAPSHOT_STATUSES.filter(isSuccessfulSnapshotStatus)).toEqual(["complete"]);
    });
});

describe("judgeHistoricalCoverage (T-WRK-03)", () => {
    const withGaps = (gaps: LedgerState["gaps"]): LedgerState => ({ ...emptyLedgerState(), gaps });

    it("is unverified without gaps and known_gap with any gap", () => {
        expect(judgeHistoricalCoverage(emptyLedgerState())).toBe("unverified");
        expect(judgeHistoricalCoverage(withGaps([{ documentId: "D1", artifactIdentity: null, reasonCode: "source-removed" }]))).toBe("known_gap");
    });

    it("never returns no_known_gap", () => {
        const results = new Set<string>();
        for (let count = 0; count < 4; count++) {
            const gaps = Array.from({ length: count }, (_, index) => ({
                documentId: `D${index}`, artifactIdentity: null, reasonCode: "exact-bytes-unavailable" as const,
            }));
            results.add(judgeHistoricalCoverage(withGaps(gaps)));
        }
        expect([...results].sort()).toEqual(["known_gap", "unverified"]);
        expect(HISTORICAL_COVERAGES).toContain("no_known_gap"); // listed as a type only
    });
});
