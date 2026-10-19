import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError, type WorkerReasonCode } from "domain/eformsign-backup/worker";

/** `statfs(2)` magic numbers (contract W3). btrfs is deliberately absent: its subvolume `st_dev` never matches `/proc/locks`. */
export const FS_TYPE_EXT4 = 0xef53;
export const FS_TYPE_XFS = 0x58465342;
export const NFS_SUPER_MAGIC = 0x6969;
export const SUPPORTED_FS_TYPES: ReadonlySet<number> = new Set([FS_TYPE_EXT4, FS_TYPE_XFS]);

export interface StatfsInfo {
    type: number;
    bavail: bigint | number;
    bsize: number;
    ffree: number;
}

/** Injectable view of the kernel facts the worker depends on, so tests can fake an NFS mount or a full disk. */
export interface FsProbe {
    statfs(path: string): Promise<StatfsInfo>;
    readProcLocks(): Promise<string>;
}

export function createRealFsProbe(): FsProbe {
    return {
        async statfs(target) {
            const info = await fs.statfs(target);
            return { type: info.type, bavail: info.bavail, bsize: info.bsize, ffree: info.ffree };
        },
        readProcLocks: () => fs.readFile("/proc/locks", "utf8"),
    };
}
export const realFsProbe: FsProbe = createRealFsProbe();

async function statfsOrThrow(probe: FsProbe, target: string, unavailable: WorkerReasonCode): Promise<StatfsInfo> {
    try {
        return await probe.statfs(target);
    } catch {
        // Never forward the cause: it carries the path.
        throw new WorkerError(unavailable);
    }
}

/** Throws `unsupported-filesystem` unless the path is on ext4 or xfs (NFS, CIFS, FUSE and btrfs are refused). */
export async function assertSupportedFilesystem(
    probe: FsProbe, target: string, unavailable: WorkerReasonCode = "archive-unavailable",
): Promise<void> {
    const info = await statfsOrThrow(probe, target, unavailable);
    if (!SUPPORTED_FS_TYPES.has(info.type)) throw new WorkerError("unsupported-filesystem");
}

/**
 * True when `bytes` still fit after keeping `reserveBytes` free, and more than `reserveInodes` inodes remain
 * (the file being written needs one). Arithmetic is BigInt, so a huge filesystem cannot overflow it.
 */
export async function hasRoom(
    probe: FsProbe, target: string, bytes: number, reserveBytes: number, reserveInodes: number,
    unavailable: WorkerReasonCode = "archive-unavailable",
): Promise<boolean> {
    const info = await statfsOrThrow(probe, target, unavailable);
    const available = BigInt(info.bavail) * BigInt(info.bsize);
    const needed = BigInt(bytes) + BigInt(reserveBytes);
    return available >= needed && BigInt(info.ffree) > BigInt(reserveInodes);
}

/** A mount point has a different `st_dev` than its parent; `/` is its own parent and always counts. */
export async function isMountPoint(target: string): Promise<boolean> {
    try {
        const parent = path.dirname(target);
        if (parent === target) return true;
        const [own, up] = await Promise.all([fs.lstat(target), fs.lstat(parent)]);
        return own.dev !== up.dev;
    } catch {
        throw new WorkerError("archive-unavailable");
    }
}
