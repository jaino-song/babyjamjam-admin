import { createHash } from "node:crypto";
import {
    LEDGER_BODY_SCHEMAS, LEDGER_RECORD_TYPES, LEDGER_RECORD_VERSION, decodeLedgerLine, encodeLedgerLine,
    ledgerChecksum, type LedgerRecord,
} from "domain/eformsign-backup/worker";

const RUN = "11111111-1111-4111-8111-111111111111";
const H = "a".repeat(64);
const AT = "2026-10-19T01:02:03.000Z";

const record: LedgerRecord = {
    v: 1, seq: 7, type: "run_started", at: AT, body: { runId: RUN, scheduledFor: "2026-10-19T10:00:00+09:00", startedAt: AT },
};

function lineWith(change: (parsed: Record<string, unknown>) => void): string {
    const parsed = JSON.parse(encodeLedgerLine(record)) as Record<string, unknown>;
    change(parsed);
    return JSON.stringify(parsed);
}
/** A line that is internally consistent (valid `sum`) but carries the given envelope. */
function signed(envelope: { v: number; seq: number; type: string; at: string; body: unknown }): string {
    return JSON.stringify({ ...envelope, sum: ledgerChecksum(envelope) });
}

describe("ledger record line codec", () => {
    it("uses the contract checksum: sha256 of the domain label and canonical JSON, keys sorted", () => {
        const canonical = `{"at":"${AT}","body":{"runId":"${RUN}","scheduledFor":"2026-10-19T10:00:00+09:00","startedAt":"${AT}"},"seq":7,"type":"run_started","v":1}`;
        const expected = createHash("sha256").update(`eformsign-backup/ledger/v1\n${canonical}`, "utf8").digest("hex");
        expect(ledgerChecksum(record)).toBe(expected);
        const body = `{"runId":"${RUN}","scheduledFor":"2026-10-19T10:00:00+09:00","startedAt":"${AT}"}`;
        expect(encodeLedgerLine(record)).toBe(`{"at":"${AT}","body":${body},"seq":7,"sum":"${expected}","type":"run_started","v":1}\n`);
    });

    it("encodes to one canonical line ending in a newline and decodes back to the same record", () => {
        const line = encodeLedgerLine(record);
        expect(line.endsWith("\n")).toBe(true);
        expect(line.indexOf("\n")).toBe(line.length - 1);
        expect(decodeLedgerLine(line)).toEqual({ ok: true, record });
        expect(decodeLedgerLine(line.slice(0, -1))).toEqual({ ok: true, record });
        expect(JSON.parse(line)).toEqual({ ...record, sum: ledgerChecksum(record) });
        expect(LEDGER_RECORD_VERSION).toBe(1);
    });

    it("rejects a tampered sum, a tampered body and a tampered sequence as checksum errors", () => {
        expect(decodeLedgerLine(lineWith((p) => { p["sum"] = "b".repeat(64); }))).toEqual({ ok: false, error: "checksum" });
        expect(decodeLedgerLine(lineWith((p) => { (p["body"] as Record<string, unknown>)["startedAt"] = "2026-10-19T01:02:04.000Z"; })))
            .toEqual({ ok: false, error: "checksum" });
        expect(decodeLedgerLine(lineWith((p) => { p["seq"] = 8; }))).toEqual({ ok: false, error: "checksum" });
    });

    it("rejects an unknown type even when its sum is valid", () => {
        const line = signed({ v: 1, seq: 7, type: "something_else", at: AT, body: {} });
        expect(decodeLedgerLine(line)).toEqual({ ok: false, error: "unknown-type" });
    });

    it("rejects a wrong version", () => {
        const line = signed({ v: 2, seq: 7, type: "run_started", at: AT, body: record.body });
        expect(decodeLedgerLine(line)).toEqual({ ok: false, error: "unsupported-version" });
    });

    it("rejects a body that breaks its strict schema (extra field, bad value) even with a valid sum", () => {
        const extra = signed({ v: 1, seq: 7, type: "run_started", at: AT, body: { ...record.body, extra: 1 } });
        expect(decodeLedgerLine(extra)).toEqual({ ok: false, error: "schema" });
        const bad = signed({ v: 1, seq: 7, type: "run_started", at: AT, body: { ...record.body, runId: "not-a-uuid" } });
        expect(decodeLedgerLine(bad)).toEqual({ ok: false, error: "schema" });
        const notV4 = signed({ v: 1, seq: 7, type: "run_started", at: AT, body: { ...record.body, runId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" } });
        expect(decodeLedgerLine(notV4)).toEqual({ ok: false, error: "schema" });
    });

    it("never throws on garbage input", () => {
        for (const garbage of ["", "\n", "{", "[]", "null", "42", "{}", '{"v":1}', "\u0000", '{"__proto__":1,"v":1}', "x".repeat(10_000),
            '{"v":1,"seq":1e400,"type":"run_started","at":"x","body":{},"sum":"x"}',
            '{"v":1,"seq":9007199254740993,"type":"run_started","at":"2026-10-19T01:02:03Z","body":{},"sum":"' + "a".repeat(64) + '"}']) {
            const result = decodeLedgerLine(garbage);
            expect(result.ok).toBe(false);
        }
    });

    it("refuses to encode an invalid record with ledger-schema", () => {
        const bad = { ...record, body: { runId: "x", scheduledFor: null, startedAt: AT } } as unknown as LedgerRecord;
        expect(() => encodeLedgerLine(bad)).toThrow(expect.objectContaining({ reasonCode: "ledger-schema" }));
        expect(() => encodeLedgerLine({ ...record, v: 2 } as unknown as LedgerRecord)).toThrow(expect.objectContaining({ reasonCode: "ledger-schema" }));
    });

    it("has a strict body schema for exactly the eighteen contract types (twelve BJJ-455 plus six Drive)", () => {
        expect([...LEDGER_RECORD_TYPES].sort()).toEqual([
            "candidate_observed", "completion_published", "destination_transition", "drive_bound", "drive_node_created",
            "drive_node_reserved", "drive_ready", "drive_record_pending", "drive_record_published", "installed",
            "manifest_published", "recovered_verified", "recovery_started", "run_finished", "run_started", "snapshot_bound",
            "staging_verified", "tail_discarded",
        ]);
        expect(Object.keys(LEDGER_BODY_SCHEMAS).sort()).toEqual([...LEDGER_RECORD_TYPES].sort());
        expect(H).toHaveLength(64);
    });
});

describe("Drive record bodies (BJJ-456 U1)", () => {
    const BIND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const REV = `drive-layout-v1:${BIND}`;
    const FILE = "fileId_0123456789";
    const PARENT = "parentId_0123456789";
    const KEY = `eformsign/company-1/D001/artifacts/document/${H}.pdf`;
    const bound = {
        destinationIdentity: "drive:rootFolder0001", destinationRevision: REV, bindingId: BIND, rootFolderId: "rootFolder0001",
        rootName: "bjj-eformsign-backup", rootParentId: "myDriveRoot0001", accountId: "permission-1",
    };
    const bodies: Record<string, unknown> = {
        drive_bound: bound,
        drive_ready: { destinationRevision: REV },
        drive_node_reserved: { destinationRevision: REV, kind: "folder", nodeKey: "eformsign/company-1", fileId: FILE, parentFileId: PARENT },
        drive_node_created: { destinationRevision: REV, nodeKey: "eformsign/company-1", fileId: FILE },
        drive_record_published: { destinationRevision: REV, relativeKey: KEY, sha256: H, fileId: FILE },
        drive_record_pending: { destinationRevision: REV, relativeKey: KEY, sha256: H },
    };
    const wrap = (type: string, body: unknown) => ({ v: 1, seq: 9, type, at: AT, body });
    const without = (body: object, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));

    it("round-trips every new record type through the line codec", () => {
        for (const [type, body] of Object.entries(bodies)) {
            const original = wrap(type, body) as LedgerRecord;
            expect(decodeLedgerLine(encodeLedgerLine(original))).toEqual({ ok: true, record: original });
        }
    });

    it("rejects an extra field, a missing field and a bad value in every new body", () => {
        for (const [type, body] of Object.entries(bodies)) {
            const base = body as Record<string, unknown>;
            expect(decodeLedgerLine(signed(wrap(type, { ...base, extra: 1 })))).toEqual({ ok: false, error: "schema" });
            for (const key of Object.keys(base)) {
                expect(decodeLedgerLine(signed(wrap(type, without(base, key))))).toEqual({ ok: false, error: "schema" });
            }
        }
        const bad = (type: string, patch: Record<string, unknown>) => decodeLedgerLine(signed(wrap(type, { ...(bodies[type] as object), ...patch })));
        for (const fileId of ["short", "has space 0123456789", "x".repeat(129), "../../etc/passwd", ""]) {
            expect(bad("drive_node_reserved", { fileId })).toEqual({ ok: false, error: "schema" });
            expect(bad("drive_node_reserved", { parentFileId: fileId })).toEqual({ ok: false, error: "schema" });
            expect(bad("drive_node_created", { fileId })).toEqual({ ok: false, error: "schema" });
            expect(bad("drive_record_published", { fileId })).toEqual({ ok: false, error: "schema" });
            expect(bad("drive_bound", { rootFolderId: fileId })).toEqual({ ok: false, error: "schema" });
            expect(bad("drive_bound", { rootParentId: fileId })).toEqual({ ok: false, error: "schema" });
        }
        expect(bad("drive_node_reserved", { kind: "link" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_node_reserved", { nodeKey: "../escape" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_record_published", { sha256: "A".repeat(64) })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_record_pending", { sha256: "short" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_bound", { bindingId: "not-a-uuid" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_bound", { bindingId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_bound", { rootName: "" })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_bound", { rootName: "n".repeat(256) })).toEqual({ ok: false, error: "schema" });
        expect(bad("drive_bound", { rootName: "n".repeat(255) })).toEqual({ ok: true, record: expect.anything() });
        expect(bad("drive_ready", { destinationRevision: "has space" })).toEqual({ ok: false, error: "schema" });
    });

    it("keeps recovered_verified valid without Drive fields and requires the three Drive fields together", () => {
        const local = { artifactIdentity: H, relativeKey: KEY, sha256: H };
        const drive = { destinationIdentity: "drive:rootFolder0001", destinationRevision: REV, fileId: FILE };
        expect(decodeLedgerLine(signed(wrap("recovered_verified", local))).ok).toBe(true);
        expect(decodeLedgerLine(signed(wrap("recovered_verified", { ...local, ...drive }))).ok).toBe(true);
        for (const key of Object.keys(drive)) {
            expect(decodeLedgerLine(signed(wrap("recovered_verified", { ...local, ...without(drive, key) })))).toEqual({ ok: false, error: "schema" });
        }
        expect(decodeLedgerLine(signed(wrap("recovered_verified", { ...local, ...drive, fileId: "short" })))).toEqual({ ok: false, error: "schema" });
        expect(decodeLedgerLine(signed(wrap("recovered_verified", { ...local, ...drive, extra: 1 })))).toEqual({ ok: false, error: "schema" });
    });

    it("keeps recovery_started valid without a drive binding and accepts an optional strict drive object", () => {
        const base = {
            installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: "local:arch-1",
            destinationRevision: "local-layout-v1", priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3, knownGaps: [],
        };
        expect(decodeLedgerLine(signed(wrap("recovery_started", base))).ok).toBe(true);
        expect(decodeLedgerLine(signed(wrap("recovery_started", { ...base, drive: bound }))).ok).toBe(true);
        expect(decodeLedgerLine(signed(wrap("recovery_started", { ...base, drive: { ...bound, extra: 1 } })))).toEqual({ ok: false, error: "schema" });
        expect(decodeLedgerLine(signed(wrap("recovery_started", { ...base, drive: { ...bound, bindingId: "nope" } })))).toEqual({ ok: false, error: "schema" });
        expect(decodeLedgerLine(signed(wrap("recovery_started", { ...base, drive: without(bound, "rootName") })))).toEqual({ ok: false, error: "schema" });
    });
});

describe("RunCounts written before the Drive counters existed (BJJ-456 U1-F1)", () => {
    const RUN_ID = "11111111-1111-4111-8111-111111111111";
    const LEGACY_COUNTS = { candidates: 1, included: 1, verified: 1, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 };
    const ZERO_DRIVE = { driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 };
    const finished = (counts: unknown) => signed({
        v: 1, seq: 3, type: "run_finished", at: AT,
        body: { runId: RUN_ID, finishedAt: AT, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: ["coverage-unverified", "drive-not-configured"], counts },
    });

    it("reads a legacy run_finished line (no Drive counters) and normalizes them to zero", () => {
        const decoded = decodeLedgerLine(finished(LEGACY_COUNTS));
        expect(decoded.ok).toBe(true);
        if (decoded.ok && decoded.record.type === "run_finished") expect(decoded.record.body.counts).toEqual({ ...LEGACY_COUNTS, ...ZERO_DRIVE });
    });

    it("reads a line whose Drive counters are present, keeping them", () => {
        const counts = { ...LEGACY_COUNTS, driveVerified: 4, driveBlocked: 1, driveRetryWait: 2, driveIntegrityError: 3 };
        const decoded = decodeLedgerLine(finished(counts));
        expect(decoded.ok && decoded.record.type === "run_finished" && decoded.record.body.counts).toEqual(counts);
    });

    it("reads a line with only some Drive counters, defaulting the rest", () => {
        const decoded = decodeLedgerLine(finished({ ...LEGACY_COUNTS, driveVerified: 2 }));
        expect(decoded.ok && decoded.record.type === "run_finished" && decoded.record.body.counts).toEqual({ ...LEGACY_COUNTS, ...ZERO_DRIVE, driveVerified: 2 });
    });

    it("stays strict: a wrong type, a negative value, an unknown key and a missing legacy counter are still rejected", () => {
        for (const key of Object.keys(ZERO_DRIVE)) {
            for (const bad of ["1", -1, null, true]) {
                expect(decodeLedgerLine(finished({ ...LEGACY_COUNTS, [key]: bad }))).toEqual({ ok: false, error: "schema" });
            }
        }
        expect(decodeLedgerLine(finished({ ...LEGACY_COUNTS, driveExtra: 1 }))).toEqual({ ok: false, error: "schema" });
        const missingLegacy = Object.fromEntries(Object.entries(LEGACY_COUNTS).filter(([name]) => name !== "orphanTemps"));
        expect(decodeLedgerLine(finished(missingLegacy))).toEqual({ ok: false, error: "schema" });
    });

    it("a record written by this code carries all four Drive counters", () => {
        const record = { v: 1, seq: 3, type: "run_finished", at: AT, body: {
            runId: RUN_ID, finishedAt: AT, snapshotStatus: "partial", historicalCoverage: "unverified", reasonCodes: [], counts: { ...LEGACY_COUNTS, ...ZERO_DRIVE },
        } } as LedgerRecord;
        expect((JSON.parse(encodeLedgerLine(record)) as { body: { counts: object } }).body.counts).toEqual({ ...LEGACY_COUNTS, ...ZERO_DRIVE });
    });
});
