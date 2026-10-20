import { randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { WorkerError, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";

export interface AtomicPublishOptions {
    /** Test seam: called before each durable step, may throw or kill the process. */
    fault?: (point: ArchiveFaultPoint) => void;
    /** Reason code for an I/O failure; `control-unavailable` when the directory is under the control path. */
    ioReasonCode?: WorkerReasonCode;
}

const PRIVATE_FILE_MODE = 0o600;
const NAME_MAX_BYTES = 255;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function hasCode(error: unknown, code: string): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function isSafeName(name: string): boolean {
    return typeof name === "string" && name.length > 0 && Buffer.byteLength(name, "utf8") <= NAME_MAX_BYTES
        && name !== "." && name !== ".." && !/[/\\\u0000]/u.test(name);
}

async function writeAll(file: FileHandle, bytes: Uint8Array, fault?: (point: ArchiveFaultPoint) => void): Promise<void> {
    let written = 0;
    // An empty payload still passes the write fault point once, like the archive primitive.
    do {
        fault?.("write");
        const { bytesWritten } = await file.write(bytes, written, bytes.byteLength - written, written);
        if (bytesWritten <= 0 && written < bytes.byteLength) throw new Error("short write");
        written += bytesWritten;
    } while (written < bytes.byteLength);
}

/** The existing entry must be a regular file holding exactly `bytes`; anything else is a conflict or unsafe. */
async function compareExisting(finalPath: string, bytes: Uint8Array): Promise<void> {
    const entry = await fs.lstat(finalPath);
    if (entry.isSymbolicLink()) throw new WorkerError("archive-unsafe-path");
    if (!entry.isFile() || entry.size !== bytes.byteLength) throw new WorkerError("archive-conflict");
    const file = await fs.open(finalPath, READ_FLAGS);
    try {
        const stat = await file.stat();
        if (stat.dev !== entry.dev || stat.ino !== entry.ino) throw new WorkerError("archive-unsafe-path");
        const existing = Buffer.alloc(bytes.byteLength);
        let filled = 0;
        while (filled < existing.length) {
            const { bytesRead } = await file.read(existing, filled, existing.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        const expected = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        if (filled !== existing.length || !existing.equals(expected)) throw new WorkerError("archive-conflict");
    } finally {
        await file.close();
    }
}

/**
 * Contract W4 write sequence for a small file (manifest, completion, run inventory, marker): temp file in the same
 * directory (O_CREAT|O_EXCL|O_NOFOLLOW, 0600) -> write -> fsync -> close -> link (no clobber) -> unlink its own
 * temp after an inode check -> directory fsync. An existing file with the same bytes is reused; different bytes
 * are `archive-conflict` and the existing file is never touched. This is the only worker file that unlinks, and
 * only the temp file it created itself.
 */
export async function publishBytesNoClobber(
    dirPath: string, name: string, bytes: Uint8Array, options: AtomicPublishOptions = {},
): Promise<{ disposition: "created" | "reused" }> {
    if (!isSafeName(name)) throw new WorkerError("invalid-path-segment");
    const { fault, ioReasonCode = "archive-unavailable" } = options;
    const finalPath = `${dirPath}/${name}`;
    let directory: FileHandle | undefined;
    let file: FileHandle | undefined;
    let tempPath: string | undefined;
    let tempIdentity: { dev: number; ino: number } | undefined;
    let removeTemp = true;
    try {
        directory = await fs.open(dirPath, DIRECTORY_FLAGS);
        const candidate = `${dirPath}/.atomic-${randomBytes(16).toString("hex")}.tmp`;
        file = await fs.open(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
        tempPath = candidate;
        const created = await file.stat();
        tempIdentity = { dev: created.dev, ino: created.ino };
        await writeAll(file, bytes, fault);
        fault?.("file-sync");
        await file.sync();
        await file.close(); file = undefined;
        fault?.("publish");
        let disposition: "created" | "reused" = "created";
        try {
            await fs.link(tempPath, finalPath);
        } catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            await compareExisting(finalPath, bytes);
            disposition = "reused";
        }
        fault?.("cleanup");
        await unlinkOwnTemp(tempPath, tempIdentity);
        tempPath = undefined;
        fault?.("directory-sync");
        await directory.sync();
        removeTemp = false;
        return { disposition };
    } catch (error) {
        if (error instanceof WorkerError) throw error;
        if (hasCode(error, "ENOSPC")) throw new WorkerError(ioReasonCode === "control-unavailable" ? "control-space" : "archive-space");
        throw new WorkerError(ioReasonCode);
    } finally {
        try { await file?.close(); } catch { /* the failure is already reported */ }
        if (removeTemp && tempPath && tempIdentity) {
            try { await unlinkOwnTemp(tempPath, tempIdentity); } catch { /* leave it for the orphan count */ }
        }
        try { await directory?.close(); } catch { /* the failure is already reported */ }
    }
}

async function unlinkOwnTemp(path: string, identity: { dev: number; ino: number }): Promise<void> {
    const entry = await fs.lstat(path);
    if (!entry.isFile() || entry.dev !== identity.dev || entry.ino !== identity.ino) throw new Error("not our temp file");
    await fs.unlink(path);
}
