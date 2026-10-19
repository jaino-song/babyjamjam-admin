import path from "node:path";
import {
    UUID_V4_PATTERN, WorkerError, applyLedgerRecord, emptyLedgerState, encodeLedgerLine,
    type LedgerBodies, type LedgerRecord, type LedgerRecordOf, type LedgerRecordType, type LedgerState,
} from "domain/eformsign-backup/worker";
import { encodeCheckpoint } from "./ledger-checkpoint";
import {
    FLAGS, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, REAL_LEDGER_FS, currentUid, errorCode, isPrivate, lstatOrNull,
    readRegularFile, syncDirectory, writeAll, type LedgerFileHandle, type LedgerFs,
} from "./ledger-fs";
import {
    CHECKPOINT_NAME, LEDGER_DIR_NAME, MARKER_NAME, encodeMarker, journalName, replayLedger,
    type InstallationMarker, type LedgerStatus,
} from "./ledger-replay";

export type { LedgerFileHandle, LedgerFs, LedgerStat } from "./ledger-fs";
export type { LedgerStatus } from "./ledger-replay";

/** Where a test can interrupt the store. Production code never sets a hook. */
export type LedgerFaultPoint =
    | "before-write"
    | "mid-write"
    | "before-fsync"
    | "after-fsync"
    | "checkpoint-before-rename"
    | "checkpoint-after-rename";

/** Writes `<dir>/<name>` without clobbering and durably. Wired to the archive's no-clobber publisher by the runner. */
export type LedgerMarkerWriter = (dir: string, name: string, bytes: Uint8Array) => Promise<void>;

export interface LedgerOpenOptions {
    /** Never writes, repairs or creates anything; a torn tail is ignored and reported in `reasons`. */
    readOnly?: boolean;
    /** Test hook. An exception it throws is an I/O failure. */
    fault?: (point: LedgerFaultPoint) => void;
    /** Test seam for the filesystem calls the store makes. */
    fs?: LedgerFs;
    /** Timestamp for records the store writes on its own (`tail_discarded`). Defaults to the system clock. */
    now?: () => string;
    /** Required by `initialize` only. */
    writeMarker?: LedgerMarkerWriter;
}

export interface LedgerInitializeParams {
    installationId: string;
    archiveId: string;
    createdAt: string;
    /** The `installed` body. `installationId` and `archiveId` may be left out; if present they must match. */
    installedBody: Omit<LedgerBodies["installed"], "installationId" | "archiveId"> & Partial<Pick<LedgerBodies["installed"], "installationId" | "archiveId">>;
}

export const DEFAULT_COMPACTION_THRESHOLD = 50_000;
const MAX_QUARANTINE_NAMES = 16;

function unavailable(): WorkerError {
    return new WorkerError("control-unavailable");
}

async function verifyControlDirectory(fs: LedgerFs, controlPath: string): Promise<void> {
    if (typeof controlPath !== "string" || !path.isAbsolute(controlPath) || controlPath === "/"
        || controlPath.endsWith("/") || path.normalize(controlPath) !== controlPath) {
        throw unavailable();
    }
    const stat = await lstatOrNull(fs, controlPath);
    if (stat === null || !stat.isDirectory() || stat.isSymbolicLink() || !isPrivate(stat)) throw unavailable();
}

/**
 * The control ledger: an append-only, checksummed journal (contract W2). One writer at a time is the caller's job (the
 * worker lock); a read-only open may run next to it. Properties the rest of the worker relies on:
 * - `append` validates and reduces in memory first, so a rejected record never touches the disk, then writes the whole
 *   line and fsyncs before it resolves. Any I/O failure poisons the store: later appends throw `control-unavailable`
 *   without touching the filesystem.
 * - Replay trusts nothing: every line is decoded and checksummed, and anything but a torn tail is `recovery_required`.
 * - Nothing here ever removes a file: a torn tail is cut with ftruncate after it was copied aside, compaction only renames.
 */
export class LedgerStore {
    private _status: LedgerStatus;
    private _state: LedgerState;
    private _reasons: string[];
    private poisoned = false;
    private handle: LedgerFileHandle | null = null;
    private queue: Promise<void> = Promise.resolve();
    private journalBase: number;
    private journalRecords: number;
    private readonly ledgerDir: string;

    private constructor(
        private readonly controlPath: string,
        private readonly options: LedgerOpenOptions,
        private readonly fs: LedgerFs,
        replay: Awaited<ReturnType<typeof replayLedger>>,
    ) {
        this._status = replay.status;
        this._state = replay.state;
        this._reasons = [...replay.reasons];
        this.journalBase = replay.journalBase;
        this.journalRecords = replay.journalRecords;
        this.ledgerDir = path.join(controlPath, LEDGER_DIR_NAME);
    }

    /**
     * Opens and replays the ledger under `controlPath`. The result carries the status, the replayed state, the last seq and
     * the reasons; a writable open of a healthy ledger is ready to `append`. Throws `control-unavailable` when the
     * control directory itself is unusable or an unexpected I/O error occurs.
     */
    static async open(controlPath: string, options: LedgerOpenOptions = {}): Promise<LedgerStore> {
        const fs = options.fs ?? REAL_LEDGER_FS;
        await verifyControlDirectory(fs, controlPath);
        const replay = await replayLedger(fs, controlPath);
        const store = new LedgerStore(controlPath, options, fs, replay);
        if (replay.status === "ok" && replay.tail !== null) {
            if (options.readOnly === true) {
                store._reasons.push("torn-tail-ignored");
            } else {
                await store.repairTornTail(replay.tail, replay.validLength);
                store._reasons.push("torn-tail-repaired");
            }
        }
        return store;
    }

    get status(): LedgerStatus { return this._status; }
    get state(): LedgerState { return this._state; }
    get lastSeq(): number { return this._state.lastSeq; }
    get reasons(): readonly string[] { return this._reasons; }

    /** Assigns `seq = lastSeq + 1`, writes the record and fsyncs it. Resolves with the record that is now durable. */
    append<T extends LedgerRecordType>(type: T, body: LedgerBodies[T], at: string): Promise<LedgerRecordOf<T>> {
        return this.serialize(async () => {
            this.requireWritable("ok");
            const record = { v: 1, seq: this._state.lastSeq + 1, type, at, body } as LedgerRecord;
            await this.commit(record);
            return record as LedgerRecordOf<T>;
        });
    }

    /** Only from `not_initialized`: marker, ledger directory, first journal, then the `installed` record. */
    initialize(params: LedgerInitializeParams): Promise<void> {
        return this.serialize(async () => {
            this.requireWritable("not_initialized");
            const writeMarker = this.options.writeMarker;
            if (writeMarker === undefined) throw new WorkerError("internal");
            const { installedBody } = params;
            if ((installedBody.installationId ?? params.installationId) !== params.installationId
                || (installedBody.archiveId ?? params.archiveId) !== params.archiveId) {
                throw new WorkerError("ledger-inconsistent");
            }
            const record: LedgerRecord = {
                v: 1, seq: 1, type: "installed", at: params.createdAt,
                body: { ...installedBody, installationId: params.installationId, archiveId: params.archiveId },
            };
            // Validate everything before the first byte is written.
            encodeLedgerLine(record);
            applyLedgerRecord(emptyLedgerState(), record);
            const marker: InstallationMarker = {
                schemaVersion: 1, installationId: params.installationId, archiveId: params.archiveId, createdAt: params.createdAt,
            };
            try {
                await writeMarker(this.controlPath, MARKER_NAME, encodeMarker(marker));
                await this.ensureLedgerDirectory();
                await this.createJournal(1);
            } catch {
                throw this.poison();
            }
            this.journalBase = 1;
            this.journalRecords = 0;
            await this.commit(record);
            this._status = "ok";
            this._reasons = [];
        });
    }

    /**
     * When the live journal holds more than `threshold` records: checkpoint (temp, fsync, rename, directory fsync), then a
     * fresh journal. The old journal stays as history. Returns whether it compacted.
     */
    compactIfNeeded(threshold: number = DEFAULT_COMPACTION_THRESHOLD): Promise<boolean> {
        return this.serialize(async () => {
            this.requireWritable("ok");
            if (!Number.isInteger(threshold) || threshold < 0) throw new WorkerError("internal");
            if (this.journalRecords <= threshold) return false;
            const bytes = encodeCheckpoint(this._state);
            const { lastSeq } = this._state;
            try {
                await this.writeCheckpointTemp(`checkpoint-${lastSeq}.tmp`, bytes);
                this.options.fault?.("checkpoint-before-rename");
                await this.fs.rename(path.join(this.ledgerDir, `checkpoint-${lastSeq}.tmp`), path.join(this.ledgerDir, CHECKPOINT_NAME));
                this.options.fault?.("checkpoint-after-rename");
                await syncDirectory(this.fs, this.ledgerDir);
                await this.closeHandle();
                this.journalBase = lastSeq + 1;
                this.journalRecords = 0;
                await this.createJournal(this.journalBase);
            } catch {
                throw this.poison();
            }
            return true;
        });
    }

    /**
     * Only from `recovery_required`: moves the damaged ledger aside as `ledger.quarantine-<runId>` and opens an empty one.
     * The next record the caller appends must be `recovery_started`. Safe to repeat after a crash.
     */
    quarantineAndReset(runId: string): Promise<void> {
        return this.serialize(async () => {
            this.requireWritable("recovery_required");
            if (!UUID_V4_PATTERN.test(runId)) throw new WorkerError("invalid-path-segment");
            try {
                await this.closeHandle();
                const existing = await lstatOrNull(this.fs, this.ledgerDir);
                if (existing !== null && !(await this.isFreshLedger())) {
                    const target = path.join(this.controlPath, `ledger.quarantine-${runId}`);
                    if ((await lstatOrNull(this.fs, target)) !== null) throw unavailable();
                    await this.fs.rename(this.ledgerDir, target);
                    await syncDirectory(this.fs, this.controlPath);
                }
                await this.ensureLedgerDirectory();
                await this.createJournal(1, true);
            } catch {
                throw this.poison();
            }
            this._state = emptyLedgerState();
            this.journalBase = 1;
            this.journalRecords = 0;
            this._status = "ok";
            this._reasons = [];
        });
    }

    /** Releases the journal file handle. The store stays usable; the next append reopens it. */
    close(): Promise<void> {
        return this.serialize(() => this.closeHandle());
    }

    // ----- internals ---------------------------------------------------------------------------------------------

    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }

    /** Checks come in the order that keeps a poisoned store from doing any I/O at all. */
    private requireWritable(needed: LedgerStatus): void {
        if (this.poisoned) throw unavailable();
        if (this.options.readOnly === true) throw new WorkerError("internal");
        if (this._status === needed) return;
        if (this._status === "not_initialized") throw new WorkerError("not-initialized");
        if (this._status === "recovery_required") throw new WorkerError("recovery-required");
        throw new WorkerError("ledger-duplicate-install");
    }

    /** Any I/O failure ends this store's writing for good; the caller restarts and replays. */
    private poison(): WorkerError {
        this.poisoned = true;
        return unavailable();
    }

    /** Validate and reduce in memory, then write and fsync. Only a durable record advances the in-memory state. */
    private async commit(record: LedgerRecord): Promise<void> {
        const line = encodeLedgerLine(record);
        const next = applyLedgerRecord(this._state, record);
        const bytes = Buffer.from(line, "utf8");
        const { fault } = this.options;
        try {
            const handle = await this.journalHandle();
            fault?.("before-write");
            if (fault === undefined) {
                await writeAll(handle, bytes);
            } else {
                const half = Math.max(1, Math.floor(bytes.length / 2));
                await writeAll(handle, bytes.subarray(0, half));
                fault("mid-write");
                await writeAll(handle, bytes.subarray(half));
            }
            fault?.("before-fsync");
            await handle.sync();
            fault?.("after-fsync");
        } catch {
            throw this.poison();
        }
        this._state = next;
        this.journalRecords += 1;
    }

    private async journalHandle(): Promise<LedgerFileHandle> {
        if (this.handle !== null) return this.handle;
        const file = path.join(this.ledgerDir, journalName(this.journalBase));
        let handle: LedgerFileHandle;
        try {
            handle = await this.fs.open(file, FLAGS.appendExisting);
        } catch (error) {
            if (errorCode(error) !== "ENOENT") throw error;
            // The journal after a checkpoint is created on first use.
            return this.createJournal(this.journalBase);
        }
        const stat = await handle.stat();
        if (!stat.isFile() || !isPrivate(stat)) {
            await handle.close().catch(() => undefined);
            throw unavailable();
        }
        this.handle = handle;
        return handle;
    }

    /** O_CREAT|O_EXCL, 0600, then fsync of the ledger directory. `reuseEmpty` accepts an existing empty journal. */
    private async createJournal(base: number, reuseEmpty = false): Promise<LedgerFileHandle> {
        const file = path.join(this.ledgerDir, journalName(base));
        let handle: LedgerFileHandle;
        try {
            handle = await this.fs.open(file, FLAGS.createExclusive, PRIVATE_FILE_MODE);
        } catch (error) {
            if (!reuseEmpty || errorCode(error) !== "EEXIST") throw error;
            handle = await this.fs.open(file, FLAGS.appendExisting);
            const stat = await handle.stat();
            if (!stat.isFile() || !isPrivate(stat) || stat.size !== 0) {
                await handle.close().catch(() => undefined);
                throw unavailable();
            }
        }
        this.handle = handle;
        await syncDirectory(this.fs, this.ledgerDir);
        return handle;
    }

    private async closeHandle(): Promise<void> {
        const handle = this.handle;
        this.handle = null;
        if (handle !== null) await handle.close().catch(() => undefined);
    }

    /** Creates `<control>/ledger` (0700) and makes the new entry durable. An existing empty directory is accepted. */
    private async ensureLedgerDirectory(): Promise<void> {
        try {
            await this.fs.mkdir(this.ledgerDir, PRIVATE_DIR_MODE);
        } catch (error) {
            if (errorCode(error) !== "EEXIST") throw error;
            const stat = await this.fs.lstat(this.ledgerDir);
            if (!stat.isDirectory() || stat.isSymbolicLink() || !isPrivate(stat)) throw unavailable();
        }
        await syncDirectory(this.fs, this.controlPath);
    }

    /** A ledger directory that only holds nothing, or a single empty first journal, has nothing worth moving aside. */
    private async isFreshLedger(): Promise<boolean> {
        const entries = await this.fs.readdir(this.ledgerDir);
        if (entries.length === 0) return true;
        if (entries.length !== 1 || entries[0] !== journalName(1)) return false;
        const stat = await this.fs.lstat(path.join(this.ledgerDir, journalName(1)));
        return stat.isFile() && stat.size === 0;
    }

    private async writeCheckpointTemp(name: string, bytes: Uint8Array): Promise<void> {
        const file = path.join(this.ledgerDir, name);
        let handle: LedgerFileHandle;
        try {
            handle = await this.fs.open(file, FLAGS.createExclusive, PRIVATE_FILE_MODE);
        } catch (error) {
            if (errorCode(error) !== "EEXIST") throw error;
            // Our own leftover from an earlier crash: same name means same checkpoint, so start its content over.
            handle = await this.fs.open(file, FLAGS.reuseTemp);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.uid !== currentUid()) {
                await handle.close().catch(() => undefined);
                throw new WorkerError("control-unavailable");
            }
        }
        try {
            await writeAll(handle, bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    /**
     * Copies the torn bytes to `tail-<seq>.quarantine` (an existing file with identical bytes is accepted), cuts the journal
     * back to its last newline with ftruncate, then records `tail_discarded`.
     */
    private async repairTornTail(tail: Buffer, validLength: number): Promise<void> {
        const seq = this._state.lastSeq + 1;
        try {
            const quarantineName = await this.quarantineTail(seq, tail);
            const handle = await this.journalHandle();
            await handle.truncate(validLength);
            await handle.sync();
            await this.commit({
                v: 1, seq, type: "tail_discarded", at: (this.options.now ?? (() => new Date().toISOString()))(),
                body: { byteLength: tail.length, quarantineName },
            });
        } catch (error) {
            this.poison();
            await this.closeHandle();
            throw error instanceof WorkerError ? error : unavailable();
        }
    }

    private async quarantineTail(seq: number, tail: Buffer): Promise<string> {
        for (let attempt = 0; attempt < MAX_QUARANTINE_NAMES; attempt++) {
            const name = attempt === 0 ? `tail-${seq}.quarantine` : `tail-${seq}-${attempt}.quarantine`;
            const file = path.join(this.ledgerDir, name);
            let handle: LedgerFileHandle;
            try {
                handle = await this.fs.open(file, FLAGS.createExclusive, PRIVATE_FILE_MODE);
            } catch (error) {
                if (errorCode(error) !== "EEXIST") throw error;
                const existing = await readRegularFile(this.fs, file);
                if (existing.kind === "file" && existing.bytes.equals(tail)) return name;
                continue;
            }
            try {
                await writeAll(handle, tail);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await syncDirectory(this.fs, this.ledgerDir);
            return name;
        }
        throw unavailable();
    }
}
