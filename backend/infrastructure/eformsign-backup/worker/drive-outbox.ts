import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";

import { WorkerError } from "domain/eformsign-backup/worker";
import { publishBytesNoClobber } from "./atomic-file";

/**
 * The Drive outbox (BJJ-456 A3.2): durable bytes for a Drive record (manifest, completion, run inventory) that the Drive phase
 * must publish but the local archive did not publish in the same run, so nothing else can rebuild it. Every file is
 * `<control>/drive-outbox/<sha256>.json`, written once and never replaced or removed (the no-unlink rule); a published record may
 * be removed by the operator by hand.
 */
export const DRIVE_OUTBOX_DIR = "drive-outbox";
const DIRECTORY_MODE = 0o700;
const OUTBOX_MAX_BYTES = 64 * 1024 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function hasCode(error: unknown, code: string): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function sha256Of(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** The outbox directory, created 0700 when missing; a symlink or anything but a real directory is refused. */
async function ensureOutbox(controlPath: string): Promise<string> {
    const directory = `${controlPath}/${DRIVE_OUTBOX_DIR}`;
    try {
        await fs.mkdir(directory, { mode: DIRECTORY_MODE });
    } catch (error) {
        if (!hasCode(error, "EEXIST")) throw new WorkerError(hasCode(error, "ENOSPC") ? "control-space" : "control-unavailable");
    }
    try {
        const entry = await fs.lstat(directory);
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new WorkerError("control-unavailable");
    } catch (error) {
        throw error instanceof WorkerError ? error : new WorkerError("control-unavailable");
    }
    return directory;
}

/**
 * Writes `bytes` no-clobber (fsync file and directory, 0600) and returns their sha256. Identical bytes already there are fine; other
 * bytes under the same name are `artifact-integrity`. A control failure is `control-unavailable` / `control-space`.
 */
export async function writeOutbox(controlPath: string, bytes: Uint8Array): Promise<string> {
    const sha256 = sha256Of(bytes);
    const directory = await ensureOutbox(controlPath);
    try {
        await publishBytesNoClobber(directory, `${sha256}.json`, bytes, { ioReasonCode: "control-unavailable" });
    } catch (error) {
        if (error instanceof WorkerError && error.reasonCode === "archive-conflict") throw new WorkerError("artifact-integrity");
        throw error;
    }
    return sha256;
}

/**
 * The bytes the outbox holds for `sha256`. `null`: no such file. A file whose content does not hash to its name is
 * `artifact-integrity` (the record stays pending); a control failure is `control-unavailable`.
 */
export async function readOutbox(controlPath: string, sha256: string): Promise<Buffer | null> {
    if (!HEX64.test(sha256)) throw new WorkerError("invalid-path-segment");
    const target = `${controlPath}/${DRIVE_OUTBOX_DIR}/${sha256}.json`;
    let entry;
    try {
        entry = await fs.lstat(target);
    } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        throw new WorkerError("control-unavailable");
    }
    if (!entry.isFile() || entry.size > OUTBOX_MAX_BYTES) throw new WorkerError("artifact-integrity");
    let file;
    try {
        file = await fs.open(target, READ_FLAGS);
        const stat = await file.stat();
        if (stat.dev !== entry.dev || stat.ino !== entry.ino) throw new WorkerError("artifact-integrity");
        const bytes = Buffer.alloc(stat.size);
        let filled = 0;
        while (filled < bytes.length) {
            const { bytesRead } = await file.read(bytes, filled, bytes.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        const read = bytes.subarray(0, filled);
        if (sha256Of(read) !== sha256) throw new WorkerError("artifact-integrity");
        return read;
    } catch (error) {
        throw error instanceof WorkerError ? error : new WorkerError("control-unavailable");
    } finally {
        try { await file?.close(); } catch { /* read-only handle */ }
    }
}
