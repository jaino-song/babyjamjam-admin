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

    it("has a strict body schema for exactly the twelve contract types", () => {
        expect([...LEDGER_RECORD_TYPES].sort()).toEqual([
            "candidate_observed", "completion_published", "destination_transition", "installed", "manifest_published",
            "recovered_verified", "recovery_started", "run_finished", "run_started", "snapshot_bound",
            "staging_verified", "tail_discarded",
        ]);
        expect(Object.keys(LEDGER_BODY_SCHEMAS).sort()).toEqual([...LEDGER_RECORD_TYPES].sort());
        expect(H).toHaveLength(64);
    });
});
