import path from "node:path";
import { z } from "zod";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import {
    WorkerError, applyLedgerRecords, decodeLedgerLine, emptyLedgerState, identifier, isoUtc,
    type LedgerRecord, type LedgerState,
} from "domain/eformsign-backup/worker";
import { decodeCheckpoint } from "./ledger-checkpoint";
import { errorCode, isPrivate, lstatOrNull, readRegularFile, type LedgerFs } from "./ledger-fs";

export type LedgerStatus = "ok" | "not_initialized" | "recovery_required";

export const MARKER_NAME = "installation.json";
export const LEDGER_DIR_NAME = "ledger";
export const CHECKPOINT_NAME = "checkpoint.json";
const JOURNAL_PATTERN = /^journal-(\d{12})\.jsonl$/;

export function journalName(base: number): string {
    return `journal-${String(base).padStart(12, "0")}.jsonl`;
}

const markerSchema = z.strictObject({
    schemaVersion: z.literal(1),
    installationId: identifier,
    archiveId: identifier,
    createdAt: isoUtc,
});
export type InstallationMarker = z.infer<typeof markerSchema>;

export function encodeMarker(marker: InstallationMarker): Buffer {
    return Buffer.from(`${canonicalJson(marker)}\n`, "utf8");
}

export interface ReplayOutcome {
    status: LedgerStatus;
    state: LedgerState;
    reasons: string[];
    /** Base (first seq) of the journal that takes new records: `checkpoint.lastSeq + 1`, or 1. */
    journalBase: number;
    journalExists: boolean;
    /** Records in the live journal. */
    journalRecords: number;
    /** Bytes of the live journal that end on a newline. */
    validLength: number;
    /** Bytes after the last newline of the live journal, or `null`. */
    tail: Buffer | null;
}

function outcome(status: LedgerStatus, reasons: string[], extra: Partial<ReplayOutcome> = {}): ReplayOutcome {
    return {
        status, state: emptyLedgerState(), reasons, journalBase: 1, journalExists: false, journalRecords: 0,
        validLength: 0, tail: null, ...extra,
    };
}

type MarkerRead = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; marker: InstallationMarker };

async function readMarker(fs: LedgerFs, controlPath: string): Promise<MarkerRead> {
    const read = await readRegularFile(fs, path.join(controlPath, MARKER_NAME));
    if (read.kind === "missing") return { kind: "missing" };
    if (read.kind === "unsafe") return { kind: "invalid" };
    try {
        const parsed = markerSchema.safeParse(JSON.parse(read.bytes.toString("utf8")));
        return parsed.success ? { kind: "ok", marker: parsed.data } : { kind: "invalid" };
    } catch {
        return { kind: "invalid" };
    }
}

interface JournalFile { name: string; base: number }

/** Lines of a journal that end on a newline, plus whatever follows the last newline. */
function splitJournal(bytes: Buffer): { lines: string[]; validLength: number; tail: Buffer | null } {
    const lastNewline = bytes.lastIndexOf(0x0a);
    const validLength = lastNewline + 1;
    const text = bytes.subarray(0, validLength).toString("utf8");
    return {
        lines: validLength === 0 ? [] : text.slice(0, -1).split("\n"),
        validLength,
        tail: validLength < bytes.length ? bytes.subarray(validLength) : null,
    };
}

/** The history journal that should end exactly at the checkpoint: its first and last record must agree with it. */
async function historyEndsAt(fs: LedgerFs, ledgerDir: string, journal: JournalFile, lastSeq: number): Promise<boolean> {
    const read = await readRegularFile(fs, path.join(ledgerDir, journal.name));
    if (read.kind !== "file") return false;
    const { lines, tail } = splitJournal(read.bytes);
    if (tail !== null || lines.length === 0) return false;
    const first = decodeLedgerLine(lines[0]!);
    const last = decodeLedgerLine(lines[lines.length - 1]!);
    return first.ok && last.ok && first.record.seq === journal.base && last.record.seq === lastSeq;
}

/**
 * Reads the control directory and decides the ledger status per contract W2. Never writes and never creates anything;
 * a torn tail is returned for the caller to repair or ignore. Throws `control-unavailable` only for unexpected I/O errors.
 */
export async function replayLedger(fs: LedgerFs, controlPath: string): Promise<ReplayOutcome> {
    const marker = await readMarker(fs, controlPath);
    if (marker.kind === "invalid") return outcome("recovery_required", ["marker-invalid"]);

    const ledgerDir = path.join(controlPath, LEDGER_DIR_NAME);
    const dirStat = await lstatOrNull(fs, ledgerDir);
    if (dirStat !== null && (!dirStat.isDirectory() || !isPrivate(dirStat))) {
        return outcome("recovery_required", ["ledger-dir-invalid"]);
    }
    let entries: string[] = [];
    if (dirStat !== null) {
        try {
            entries = await fs.readdir(ledgerDir);
        } catch (error) {
            if (errorCode(error) !== "ENOENT") throw new WorkerError("control-unavailable");
        }
    }

    if (marker.kind === "missing") {
        return entries.length === 0 ? outcome("not_initialized", []) : outcome("recovery_required", ["marker-missing"]);
    }
    if (dirStat === null) return outcome("recovery_required", ["ledger-missing"]);

    const journals: JournalFile[] = [];
    for (const name of entries) {
        if (!name.startsWith("journal-")) continue;
        const match = JOURNAL_PATTERN.exec(name);
        const base = match ? Number(match[1]) : 0;
        if (base < 1) return outcome("recovery_required", ["journal-name-invalid"]);
        journals.push({ name, base });
    }

    let baseState = emptyLedgerState();
    let hasCheckpoint = false;
    if (entries.includes(CHECKPOINT_NAME)) {
        const read = await readRegularFile(fs, path.join(ledgerDir, CHECKPOINT_NAME));
        const restored = read.kind === "file" ? decodeCheckpoint(read.bytes) : null;
        if (restored === null) return outcome("recovery_required", ["checkpoint-invalid"]);
        baseState = restored;
        hasCheckpoint = true;
    }
    const expectedBase = baseState.lastSeq + 1;

    if (journals.some((journal) => journal.base > expectedBase)) return outcome("recovery_required", ["journal-base-ahead"]);
    if (hasCheckpoint) {
        const history = journals.filter((journal) => journal.base < expectedBase).sort((a, b) => b.base - a.base);
        if (history.length === 0 || !(await historyEndsAt(fs, ledgerDir, history[0]!, baseState.lastSeq))) {
            return outcome("recovery_required", ["history-journal-mismatch"]);
        }
    }

    const live = journals.find((journal) => journal.base === expectedBase);
    const finish = (state: LedgerState, extra: Partial<ReplayOutcome>): ReplayOutcome => {
        const installation = state.installation;
        if (installation === null || installation.installationId !== marker.marker.installationId
            || installation.archiveId !== marker.marker.archiveId) {
            return outcome("recovery_required", ["marker-ledger-mismatch"]);
        }
        return outcome("ok", [], { state, journalBase: expectedBase, ...extra });
    };

    if (live === undefined) {
        return hasCheckpoint ? finish(baseState, {}) : outcome("recovery_required", ["ledger-empty"]);
    }
    const read = await readRegularFile(fs, path.join(ledgerDir, live.name));
    if (read.kind !== "file") return outcome("recovery_required", ["journal-unsafe"]);

    const { lines, validLength, tail } = splitJournal(read.bytes);
    const records: LedgerRecord[] = [];
    for (const [index, line] of lines.entries()) {
        const decoded = decodeLedgerLine(line);
        if (!decoded.ok) return outcome("recovery_required", [`line-${index + 1}-${decoded.error}`]);
        records.push(decoded.record);
    }
    if (records.length === 0 && !hasCheckpoint) {
        return outcome("recovery_required", tail === null ? ["ledger-empty"] : ["ledger-empty", "torn-first-record"]);
    }
    let state: LedgerState;
    try {
        state = applyLedgerRecords(baseState, records);
    } catch (error) {
        return outcome("recovery_required", [`record-rejected-${error instanceof WorkerError ? error.reasonCode : "invalid"}`]);
    }
    return finish(state, { journalExists: true, journalRecords: records.length, validLength, tail });
}
