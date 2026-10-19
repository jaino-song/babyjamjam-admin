import { constants, promises as fsp } from "node:fs";
import { WorkerError } from "domain/eformsign-backup/worker";

/**
 * The narrow filesystem surface the ledger uses. `fs.promises` and its `FileHandle` satisfy it as they are;
 * a test passes a wrapper to inject EIO or to watch the call order. There is deliberately no remove operation.
 */
export interface LedgerStat {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    uid: number;
    mode: number;
}

export interface LedgerFileHandle {
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    write(buffer: Uint8Array, offset: number, length: number): Promise<{ bytesWritten: number }>;
    stat(): Promise<LedgerStat>;
    truncate(length: number): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
}

export interface LedgerFs {
    open(path: string, flags: number, mode?: number): Promise<LedgerFileHandle>;
    lstat(path: string): Promise<LedgerStat>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string, mode: number): Promise<void>;
    rename(from: string, to: string): Promise<void>;
}

export const REAL_LEDGER_FS: LedgerFs = {
    open: (path, flags, mode) => fsp.open(path, flags, mode),
    lstat: (path) => fsp.lstat(path),
    readdir: (path) => fsp.readdir(path),
    mkdir: async (path, mode) => { await fsp.mkdir(path, { mode }); },
    rename: (from, to) => fsp.rename(from, to),
};

export const FLAGS = {
    readFile: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    readDir: constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    appendExisting: constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    createExclusive: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    /** Reuse of our own leftover checkpoint temp file: same permissions, content restarted. */
    reuseTemp: constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
} as const;

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;
const WRITABLE_BY_OTHERS = 0o022;
/** Journals hold at most 50,000 records of well under 64 KiB; anything past this is not a journal we wrote. */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export function errorCode(error: unknown): string | undefined {
    return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function currentUid(): number {
    const uid = process.getuid?.();
    if (uid === undefined) throw new WorkerError("control-unavailable");
    return uid;
}

/** True for an object that is ours alone to write: owned by this process user, not group/other writable. */
export function isPrivate(stat: Pick<LedgerStat, "uid" | "mode">): boolean {
    return stat.uid === currentUid() && (stat.mode & WRITABLE_BY_OTHERS) === 0;
}

export async function writeAll(handle: LedgerFileHandle, bytes: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
        if (bytesWritten <= 0) throw new WorkerError("control-unavailable");
        offset += bytesWritten;
    }
}

export type ReadResult =
    | { kind: "missing" }
    | { kind: "unsafe" }
    | { kind: "file"; bytes: Buffer };

/** Reads a whole regular file without following a symlink. Unexpected I/O errors surface as `control-unavailable`. */
export async function readRegularFile(fs: LedgerFs, path: string): Promise<ReadResult> {
    let handle: LedgerFileHandle;
    try {
        handle = await fs.open(path, FLAGS.readFile);
    } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") return { kind: "missing" };
        if (code === "ELOOP" || code === "ENXIO" || code === "EISDIR") return { kind: "unsafe" };
        throw new WorkerError("control-unavailable");
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || !isPrivate(stat) || stat.size > MAX_FILE_BYTES) return { kind: "unsafe" };
        const bytes = Buffer.alloc(stat.size);
        let filled = 0;
        while (filled < bytes.length) {
            const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        return { kind: "file", bytes: bytes.subarray(0, filled) };
    } catch (error) {
        if (error instanceof WorkerError) throw error;
        throw new WorkerError("control-unavailable");
    } finally {
        await handle.close().catch(() => undefined);
    }
}

export async function lstatOrNull(fs: LedgerFs, path: string): Promise<LedgerStat | null> {
    try {
        return await fs.lstat(path);
    } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw new WorkerError("control-unavailable");
    }
}

/** fsync of a directory: makes a create or rename inside it durable. */
export async function syncDirectory(fs: LedgerFs, path: string): Promise<void> {
    const handle = await fs.open(path, FLAGS.readDir);
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
