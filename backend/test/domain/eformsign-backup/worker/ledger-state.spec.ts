import {
    WorkerError, applyLedgerRecord, applyLedgerRecords, destinationKey, emptyLedgerState,
    integrityErrorCount, judgeHistoricalCoverage, ledgerStateFromJson, ledgerStateToJson, nextSnapshotSequence,
    type LedgerBodies, type LedgerRecord, type LedgerRecordType, type LedgerState,
} from "domain/eformsign-backup/worker";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";

const RUN1 = "11111111-1111-4111-8111-111111111111";
const RUN2 = "22222222-2222-4222-8222-222222222222";
const SNAP1 = "snap-0001";
const SNAP2 = "snap-0002";
const hex = (char: string) => char.repeat(64);
const ART1 = hex("1");
const ART2 = hex("2");
const DEST = "local:arch-1";
const REV = "local-layout-v1";
const KEY1 = destinationKey(ART1, DEST, REV);
const REL1 = `eformsign/company-1/D001/artifacts/document/${hex("a")}.pdf`;
const clock = (n: number) => `2026-10-19T00:00:${String(n).padStart(2, "0")}.000Z`;

let nextSeq = 1;
function rec<T extends LedgerRecordType>(type: T, body: LedgerBodies[T], seq = nextSeq++): LedgerRecord {
    return { v: 1, seq, type, at: clock(seq % 60), body } as LedgerRecord;
}
const installed = () => rec("installed", {
    installationId: "inst-1", archiveId: "arch-1", archiveDev: 2049, archiveIno: 77, destinationIdentity: DEST, destinationRevision: REV,
});
const runStarted = (runId = RUN1) => rec("run_started", { runId, scheduledFor: null, startedAt: clock(1) });
const bound = (runId: string, snapshotId: string, sequence: number) => rec("snapshot_bound", {
    runId, snapshotId, sequence, scopeRevision: "scope-1", policyRevision: "policy-1", counts: { candidates: 1, included: 1 },
});
const candidate = (snapshotId = SNAP1, ordinal = 0) => rec("candidate_observed", {
    snapshotId, ordinal, documentId: "D001", classification: "included", metadataRevision: hex("c"),
    artifacts: [{ artifactType: "document", artifactIdentity: ART1, sha256: hex("a"), byteLength: 100 }],
});
const transition = (
    to: LedgerBodies["destination_transition"]["to"], from: LedgerBodies["destination_transition"]["from"],
    extra: Partial<LedgerBodies["destination_transition"]> = {}, artifactIdentity = ART1,
) => rec("destination_transition", {
    artifactIdentity, destinationIdentity: DEST, destinationRevision: REV, from, to, reasonCode: null, attempts: 0,
    nextRetryAt: null, relativeKey: null, ...extra,
});
const finished = (runId = RUN1) => rec("run_finished", {
    runId, finishedAt: clock(50), snapshotStatus: "partial", historicalCoverage: "unverified",
    reasonCodes: ["coverage-unverified", "drive-not-configured"],
    counts: { candidates: 1, included: 1, verified: 1, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 },
});

function build(make: () => LedgerRecord[]): LedgerState {
    nextSeq = 1;
    return applyLedgerRecords(emptyLedgerState(), make());
}
function reasonOf(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof WorkerError ? error.reasonCode : `other:${String(error)}`;
    }
}
/** The full path of a destination to `verified` for ART1. */
const toVerified = () => [
    transition("pending", null), transition("transferring", "pending"), transition("verifying", "transferring"),
    transition("verified", "verifying", { relativeKey: REL1 }),
];

describe("applyLedgerRecord (T-WRK-01)", () => {
    beforeEach(() => { nextSeq = 1; });

    it("starts empty and applies an installed record", () => {
        const state = applyLedgerRecord(emptyLedgerState(), installed());
        expect(state.lastSeq).toBe(1);
        expect(state.installation).toMatchObject({ installationId: "inst-1", archiveId: "arch-1", archiveDev: 2049, archiveIno: 77, origin: "installed", priorLedgerName: null });
        expect(state.sequenceFloor).toBe(0);
    });

    it("rejects a sequence that is not lastSeq + 1 (gap, repeat, rewind)", () => {
        const state = applyLedgerRecord(emptyLedgerState(), installed());
        expect(reasonOf(() => applyLedgerRecord(state, runStarted()))).toBeNull();
        nextSeq = 1;
        expect(reasonOf(() => applyLedgerRecord(state, rec("run_started", { runId: RUN1, scheduledFor: null, startedAt: clock(1) }, 3)))).toBe("ledger-seq-gap");
        expect(reasonOf(() => applyLedgerRecord(state, rec("run_started", { runId: RUN1, scheduledFor: null, startedAt: clock(1) }, 1)))).toBe("ledger-seq-gap");
        expect(reasonOf(() => applyLedgerRecord(emptyLedgerState(), rec("installed", (installed() as LedgerRecord & { type: "installed" }).body, 2)))).toBe("ledger-seq-gap");
    });

    it("requires the first record to be installed or recovery_started", () => {
        for (const first of [runStarted(), bound(RUN1, SNAP1, 1), transition("pending", null), finished()]) {
            nextSeq = 1;
            expect(reasonOf(() => applyLedgerRecord(emptyLedgerState(), { ...first, seq: 1 }))).toBe("ledger-first-record");
        }
        nextSeq = 1;
        const recovery = rec("recovery_started", {
            installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: DEST, destinationRevision: REV,
            priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3, knownGaps: [],
        });
        expect(reasonOf(() => applyLedgerRecord(emptyLedgerState(), recovery))).toBeNull();
    });

    it("rejects a second installation record", () => {
        const state = applyLedgerRecord(emptyLedgerState(), installed());
        expect(reasonOf(() => applyLedgerRecord(state, rec("installed", (installed() as LedgerRecord & { type: "installed" }).body, 2)))).toBe("ledger-duplicate-install");
    });

    it("rejects an unknown record type", () => {
        const state = applyLedgerRecord(emptyLedgerState(), installed());
        expect(reasonOf(() => applyLedgerRecord(state, { v: 1, seq: 2, type: "mystery", at: clock(2), body: {} } as unknown as LedgerRecord))).toBe("ledger-schema");
        expect(reasonOf(() => applyLedgerRecord(state, { ...runStarted(), seq: 2, v: 2 } as unknown as LedgerRecord))).toBe("ledger-schema");
    });

    it("is pure: the input state is not changed and the result is a new state", () => {
        const before = build(() => [installed(), runStarted()]);
        const snapshotJson = canonicalJson(ledgerStateToJson(before));
        const after = applyLedgerRecord(before, bound(RUN1, SNAP1, 1));
        expect(after).not.toBe(before);
        expect(canonicalJson(ledgerStateToJson(before))).toBe(snapshotJson);
        expect(before.snapshots.size).toBe(0);
        expect(after.snapshots.size).toBe(1);
    });

    it("applyLedgerRecords equals folding applyLedgerRecord", () => {
        nextSeq = 1;
        const records = [installed(), runStarted(), bound(RUN1, SNAP1, 1), candidate(), ...toVerified(), finished()];
        const folded = records.reduce(applyLedgerRecord, emptyLedgerState());
        const bulk = applyLedgerRecords(emptyLedgerState(), records);
        expect(canonicalJson(ledgerStateToJson(bulk))).toBe(canonicalJson(ledgerStateToJson(folded)));
        expect(bulk.lastSeq).toBe(records.length);
    });

    it("tracks runs: open until run_finished, and refuses a finish for an unknown or finished run", () => {
        const open = build(() => [installed(), runStarted()]);
        expect(open.runs.get(RUN1)).toMatchObject({ status: "open", finishedAt: null, snapshotStatus: null });
        const done = applyLedgerRecord(open, { ...finished(), seq: 3 } as LedgerRecord);
        expect(done.runs.get(RUN1)).toMatchObject({ status: "finished", snapshotStatus: "partial", historicalCoverage: "unverified" });
        expect(reasonOf(() => applyLedgerRecord(done, { ...finished(), seq: 4 } as LedgerRecord))).toBe("ledger-inconsistent");
        expect(reasonOf(() => applyLedgerRecord(open, { ...finished(RUN2), seq: 3 } as LedgerRecord))).toBe("ledger-inconsistent");
        expect(reasonOf(() => applyLedgerRecord(open, { ...runStarted(), seq: 3 } as LedgerRecord))).toBe("ledger-inconsistent");
    });

    it("a late run_finished for an older run is allowed after a newer run started", () => {
        const state = build(() => [installed(), runStarted(RUN1), runStarted(RUN2), finished(RUN1)]);
        expect(state.runs.get(RUN1)!.status).toBe("finished");
        expect(state.runs.get(RUN2)!.status).toBe("open");
    });

    it("binds snapshots with a rising sequence and reuses the sequence of a snapshot already bound", () => {
        const state = build(() => [installed(), runStarted(RUN1), bound(RUN1, SNAP1, 1), finished(RUN1), runStarted(RUN2)]);
        expect(reasonOf(() => applyLedgerRecord(state, { ...bound(RUN2, SNAP2, 1), seq: 6 } as LedgerRecord))).toBe("ledger-inconsistent");
        expect(reasonOf(() => applyLedgerRecord(state, { ...bound(RUN2, SNAP1, 5), seq: 6 } as LedgerRecord))).toBe("ledger-inconsistent");
        const again = applyLedgerRecord(state, { ...bound(RUN2, SNAP1, 1), seq: 6 } as LedgerRecord);
        expect(again.runs.get(RUN2)!.sequence).toBe(1);
        expect(applyLedgerRecord(state, { ...bound(RUN2, SNAP2, 2), seq: 6 } as LedgerRecord).snapshots.get(SNAP2)!.sequence).toBe(2);
        expect(reasonOf(() => applyLedgerRecord(state, { ...bound(RUN1, SNAP2, 2), seq: 6 } as LedgerRecord))).toBe("ledger-inconsistent"); // run already finished
    });

    it("keeps only the candidates of the latest bound snapshot but remembers every artifact", () => {
        const state = build(() => [installed(), runStarted(RUN1), bound(RUN1, SNAP1, 1), candidate(SNAP1, 0), finished(RUN1),
            runStarted(RUN2), bound(RUN2, SNAP2, 2)]);
        expect(state.candidates.size).toBe(0);
        expect(state.artifacts.get(ART1)).toEqual({ documentId: "D001", artifactType: "document", sha256: hex("a"), byteLength: 100 });
    });

    it("refuses a candidate for a snapshot that was never bound", () => {
        const state = build(() => [installed(), runStarted()]);
        expect(reasonOf(() => applyLedgerRecord(state, { ...candidate(), seq: 3 } as LedgerRecord))).toBe("ledger-inconsistent");
    });

    it("destination entries: walks to verified and records lastVerifiedAt and the relative key", () => {
        const state = build(() => [installed(), runStarted(), bound(RUN1, SNAP1, 1), candidate(), ...toVerified()]);
        const entry = state.destinations.get(KEY1)!;
        expect(entry).toMatchObject({ state: "verified", relativeKey: REL1, nextRetryAt: null, reasonCode: null });
        expect(entry.lastVerifiedAt).toBe(clock(8));
        expect(entry.history.map((event) => event.to)).toEqual(["pending", "transferring", "verifying", "verified"]);
    });

    it("rejects a transition whose from does not match the entry, and forbidden edges", () => {
        const state = build(() => [installed(), runStarted(), transition("pending", null)]);
        expect(reasonOf(() => applyLedgerRecord(state, { ...transition("transferring", null), seq: 4 } as LedgerRecord))).toBe("forbidden-transition");
        expect(reasonOf(() => applyLedgerRecord(state, { ...transition("verified", "transferring"), seq: 4 } as LedgerRecord))).toBe("forbidden-transition");
        expect(reasonOf(() => applyLedgerRecord(state, { ...transition("verified", "pending"), seq: 4 } as LedgerRecord))).toBe("forbidden-transition");
        expect(reasonOf(() => applyLedgerRecord(state, { ...transition("pending", "pending"), seq: 4 } as LedgerRecord))).toBe("forbidden-transition");
    });

    it("keeps the earlier verified event when a later integrity_error arrives", () => {
        const state = build(() => [installed(), runStarted(), bound(RUN1, SNAP1, 1), candidate(), ...toVerified(),
            transition("integrity_error", "verified", { reasonCode: "artifact-integrity", relativeKey: REL1 })]);
        const entry = state.destinations.get(KEY1)!;
        expect(entry.state).toBe("integrity_error");
        expect(entry.reasonCode).toBe("artifact-integrity");
        expect(entry.lastVerifiedAt).toBe(clock(8)); // the earlier success is still on record
        expect(entry.history.map((event) => event.to)).toEqual(["pending", "transferring", "verifying", "verified", "integrity_error"]);
        expect(entry.history.find((event) => event.to === "verified")).toMatchObject({ seq: 8, kind: "transition" });
        expect(entry.relativeKey).toBe(REL1);
        expect(integrityErrorCount(entry)).toBe(1);
    });

    it("moves through retry_wait with attempts and nextRetryAt, then back to pending", () => {
        const state = build(() => [installed(), runStarted(), transition("pending", null), transition("transferring", "pending"),
            transition("retry_wait", "transferring", { reasonCode: "crashed", attempts: 1, nextRetryAt: clock(30) })]);
        expect(state.destinations.get(KEY1)).toMatchObject({ state: "retry_wait", attempts: 1, nextRetryAt: clock(30), reasonCode: "crashed" });
        const pending = applyLedgerRecord(state, { ...transition("pending", "retry_wait", { attempts: 1 }), seq: 6 } as LedgerRecord);
        expect(pending.destinations.get(KEY1)).toMatchObject({ state: "pending", nextRetryAt: null });
    });

    it("keys destinations by artifact, destination identity and revision (a verified key is not reused for another revision)", () => {
        const state = build(() => [installed(), runStarted(), ...toVerified()]);
        const otherRevision = rec("destination_transition", {
            artifactIdentity: ART1, destinationIdentity: DEST, destinationRevision: "local-layout-v2", from: null, to: "pending",
            reasonCode: null, attempts: 0, nextRetryAt: null, relativeKey: null,
        });
        const next = applyLedgerRecord(state, { ...otherRevision, seq: state.lastSeq + 1 } as LedgerRecord);
        expect(next.destinations.get(KEY1)!.state).toBe("verified");
        expect(next.destinations.get(destinationKey(ART1, DEST, "local-layout-v2"))!.state).toBe("pending");
    });

    it("records a gap and the terminal set for source-removed, and a gap for exact-bytes-unavailable", () => {
        const state = build(() => [installed(), runStarted(), bound(RUN1, SNAP1, 1), candidate(),
            transition("pending", null), transition("blocked", "pending", { reasonCode: "source-removed" }),
            transition("pending", null, {}, ART2)]);
        const REL2 = `eformsign/company-1/D002/artifacts/document/${hex("b")}.pdf`;
        expect(state.terminalUnavailable.has(ART1)).toBe(true);
        expect(state.gaps).toEqual([{ documentId: "D001", artifactIdentity: ART1, reasonCode: "source-removed" }]);
        expect(judgeHistoricalCoverage(state)).toBe("known_gap");
        const more = applyLedgerRecord(state, { ...transition("blocked", "pending", { reasonCode: "exact-bytes-unavailable", relativeKey: REL2 }, ART2), seq: state.lastSeq + 1 } as LedgerRecord);
        expect(more.gaps.map((gap) => gap.reasonCode)).toEqual(["source-removed", "exact-bytes-unavailable"]);
        expect(more.gaps[1]).toEqual({ documentId: "D002", artifactIdentity: ART2, reasonCode: "exact-bytes-unavailable" });
    });

    it("does not record a gap for an ordinary block, and does not duplicate a gap", () => {
        const state = build(() => [installed(), runStarted(), bound(RUN1, SNAP1, 1), candidate(), transition("pending", null),
            transition("blocked", "pending", { reasonCode: "archive-unavailable" })]);
        expect(state.gaps).toEqual([]);
        expect(judgeHistoricalCoverage(state)).toBe("unverified");
        const twice = applyLedgerRecords(state, [
            { ...transition("pending", "blocked"), seq: 7 } as LedgerRecord,
            { ...transition("blocked", "pending", { reasonCode: "source-removed" }), seq: 8 } as LedgerRecord,
            { ...transition("blocked", "blocked", { reasonCode: "source-removed" }), seq: 9 } as LedgerRecord,
        ]);
        expect(twice.gaps).toHaveLength(1);
    });

    it("refuses a gap-producing transition for an artifact whose document it cannot determine", () => {
        const state = build(() => [installed(), runStarted(), transition("pending", null)]);
        expect(reasonOf(() => applyLedgerRecord(state, { ...transition("blocked", "pending", { reasonCode: "source-removed" }), seq: 4 } as LedgerRecord))).toBe("ledger-inconsistent");
        const withKey = applyLedgerRecord(state, {
            ...transition("blocked", "pending", { reasonCode: "source-removed", relativeKey: REL1 }), seq: 4,
        } as LedgerRecord);
        expect(withKey.gaps[0]!.documentId).toBe("D001");
    });

    it("recovery_started carries the sequence floor and known gaps into the state", () => {
        nextSeq = 1;
        const state = applyLedgerRecord(emptyLedgerState(), rec("recovery_started", {
            installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: DEST, destinationRevision: REV,
            priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3,
            knownGaps: [{ documentId: "D007", artifactIdentity: null, reasonCode: "source-removed" }],
        }));
        expect(state.installation).toMatchObject({ origin: "recovery_started", priorLedgerName: "ledger.quarantine-x" });
        expect(state.sequenceFloor).toBe(3);
        expect(state.gaps).toEqual([{ documentId: "D007", artifactIdentity: null, reasonCode: "source-removed" }]);
        expect(judgeHistoricalCoverage(state)).toBe("known_gap");
    });

    it("nextSnapshotSequence is max(ledger, recovery floor, archive) + 1: floor 3 gives 4", () => {
        nextSeq = 1;
        const recovered = applyLedgerRecord(emptyLedgerState(), rec("recovery_started", {
            installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: DEST, destinationRevision: REV,
            priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3, knownGaps: [],
        }));
        expect(nextSnapshotSequence(recovered)).toBe(4);
        expect(nextSnapshotSequence(recovered, 2)).toBe(4);
        expect(nextSnapshotSequence(recovered, 9)).toBe(10);
        const afterRun = applyLedgerRecords(recovered, [
            { ...runStarted(), seq: 2 } as LedgerRecord, { ...bound(RUN1, SNAP1, 4), seq: 3 } as LedgerRecord,
        ]);
        expect(nextSnapshotSequence(afterRun)).toBe(5);
        expect(nextSnapshotSequence(afterRun, 3)).toBe(5);
        expect(nextSnapshotSequence(emptyLedgerState())).toBe(1);
        expect(reasonOf(() => applyLedgerRecord(recovered, { ...runStarted(), seq: 2 } as LedgerRecord))).toBeNull();
        expect(reasonOf(() => nextSnapshotSequence(recovered, -1))).toBe("ledger-inconsistent");
        expect(reasonOf(() => nextSnapshotSequence(recovered, 999_999_999_999))).toBe("ledger-inconsistent");
    });

    it("a snapshot at or below the recovery floor is refused", () => {
        nextSeq = 1;
        const recovered = applyLedgerRecords(emptyLedgerState(), [
            rec("recovery_started", {
                installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: DEST, destinationRevision: REV,
                priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3, knownGaps: [],
            }),
            runStarted(),
        ]);
        expect(reasonOf(() => applyLedgerRecord(recovered, { ...bound(RUN1, SNAP1, 3), seq: 3 } as LedgerRecord))).toBe("ledger-inconsistent");
        expect(reasonOf(() => applyLedgerRecord(recovered, { ...bound(RUN1, SNAP1, 4), seq: 3 } as LedgerRecord))).toBeNull();
    });

    it("recovered_verified marks the key verified, appends a recovery event, and lets 'already verified' apply", () => {
        nextSeq = 1;
        const state = applyLedgerRecords(emptyLedgerState(), [
            rec("recovery_started", {
                installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: DEST, destinationRevision: REV,
                priorLedgerName: "ledger.quarantine-x", sequenceFloor: 0, knownGaps: [],
            }),
            rec("recovered_verified", { artifactIdentity: ART1, relativeKey: REL1, sha256: hex("a") }),
        ]);
        const entry = state.destinations.get(KEY1)!;
        expect(entry).toMatchObject({ state: "verified", relativeKey: REL1, lastVerifiedAt: clock(2) });
        expect(entry.history).toEqual([{ seq: 2, at: clock(2), from: null, to: "verified", reasonCode: null, attempts: 0, kind: "recovery" }]);
        expect(state.artifacts.get(ART1)).toMatchObject({ documentId: "D001", artifactType: "document", sha256: hex("a"), byteLength: null });
        // a later check can still demote it, and the recovery event survives
        const demoted = applyLedgerRecord(state, { ...transition("integrity_error", "verified", { reasonCode: "artifact-integrity" }), seq: 3 } as LedgerRecord);
        expect(demoted.destinations.get(KEY1)!.history.map((event) => `${event.kind}:${event.to}`)).toEqual(["recovery:verified", "transition:integrity_error"]);
    });

    it("stages artifacts and publishes manifests and completions idempotently, refusing different bytes under one key", () => {
        const manifestKey = `eformsign/company-1/D001/manifests/${hex("c")}.json`;
        const completionKey = `eformsign/company-1/completions/000000000001-${hex("d")}.json`;
        const state = build(() => [installed(), runStarted(), rec("staging_verified", { artifactIdentity: ART1, sha256: hex("a"), byteLength: 100 }),
            rec("manifest_published", { relativeKey: manifestKey, sha256: hex("e") }),
            rec("completion_published", { relativeKey: completionKey, sha256: hex("d"), sequence: 1 })]);
        expect(state.staged.get(ART1)).toMatchObject({ sha256: hex("a"), byteLength: 100 });
        expect(state.manifests.get(manifestKey)!.sha256).toBe(hex("e"));
        expect(state.completions.get(completionKey)).toMatchObject({ sha256: hex("d"), sequence: 1 });
        expect(nextSnapshotSequence(state)).toBe(2);
        const repeat = applyLedgerRecord(state, { ...rec("manifest_published", { relativeKey: manifestKey, sha256: hex("e") }), seq: state.lastSeq + 1 } as LedgerRecord);
        expect(repeat.manifests.size).toBe(1);
        expect(reasonOf(() => applyLedgerRecord(state, { ...rec("manifest_published", { relativeKey: manifestKey, sha256: hex("f") }), seq: state.lastSeq + 1 } as LedgerRecord))).toBe("archive-conflict");
        expect(reasonOf(() => applyLedgerRecord(state, { ...rec("completion_published", { relativeKey: completionKey, sha256: hex("f"), sequence: 1 }), seq: state.lastSeq + 1 } as LedgerRecord))).toBe("archive-conflict");
    });

    it("records discarded tails", () => {
        const state = build(() => [installed(), rec("tail_discarded", { byteLength: 42, quarantineName: "tail-000000000002.quarantine" })]);
        expect(state.tailDiscards).toEqual([{ byteLength: 42, quarantineName: "tail-000000000002.quarantine", at: clock(2) }]);
    });
});

describe("ledger state JSON (checkpoint)", () => {
    function richState(): LedgerState {
        nextSeq = 1;
        return applyLedgerRecords(emptyLedgerState(), [
            installed(), runStarted(RUN1), bound(RUN1, SNAP1, 1), candidate(), ...toVerified(),
            transition("integrity_error", "verified", { reasonCode: "artifact-integrity", relativeKey: REL1 }),
            transition("pending", "integrity_error"), transition("blocked", "pending", { reasonCode: "source-removed" }),
            rec("staging_verified", { artifactIdentity: ART2, sha256: hex("b"), byteLength: 5 }),
            rec("manifest_published", { relativeKey: `eformsign/company-1/D001/manifests/${hex("c")}.json`, sha256: hex("e") }),
            rec("completion_published", { relativeKey: `eformsign/company-1/completions/000000000001-${hex("d")}.json`, sha256: hex("d"), sequence: 1 }),
            rec("tail_discarded", { byteLength: 3, quarantineName: "tail-000000000015.quarantine" }),
            finished(RUN1), runStarted(RUN2),
        ]);
    }

    it("round-trips through a canonical-JSON-safe plain object", () => {
        const state = richState();
        const json = ledgerStateToJson(state);
        const text = canonicalJson(json); // throws for Map, Set, undefined, non-integers
        expect(text.length).toBeGreaterThan(100);
        const restored = ledgerStateFromJson(JSON.parse(text));
        expect(restored).toEqual(state);
        expect(canonicalJson(ledgerStateToJson(restored))).toBe(text);
        expect(restored.destinations.get(KEY1)!.history.some((event) => event.to === "verified")).toBe(true);
        expect(restored.terminalUnavailable.has(ART1)).toBe(true);
        expect(restored.gaps).toEqual(state.gaps);
    });

    it("round-trips the empty state and keeps applying records after a restore", () => {
        expect(ledgerStateFromJson(JSON.parse(canonicalJson(ledgerStateToJson(emptyLedgerState()))))).toEqual(emptyLedgerState());
        const state = richState();
        const restored = ledgerStateFromJson(JSON.parse(canonicalJson(ledgerStateToJson(state))));
        const next = { ...finished(RUN2), seq: state.lastSeq + 1 } as LedgerRecord;
        expect(canonicalJson(ledgerStateToJson(applyLedgerRecord(restored, next)))).toBe(canonicalJson(ledgerStateToJson(applyLedgerRecord(state, next))));
    });

    it("rejects a checkpoint with an extra field, a wrong version or a bad value as ledger-schema", () => {
        const json = JSON.parse(canonicalJson(ledgerStateToJson(richState()))) as Record<string, unknown>;
        for (const broken of [{ ...json, extra: 1 }, { ...json, schemaVersion: 2 }, { ...json, lastSeq: -1 }, { ...json, runs: "x" }, null, 5, []]) {
            expect(reasonOf(() => ledgerStateFromJson(broken))).toBe("ledger-schema");
        }
    });
});
