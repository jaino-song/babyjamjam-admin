import { promises as fs } from "node:fs";

import { WorkerError } from "domain/eformsign-backup/worker";
import type { FsProbe } from "./fs-probe";

export interface ProcLockEntry {
    pid: number;
    major: number;
    minor: number;
    inode: number;
}

/** `1: FLOCK  ADVISORY  WRITE <pid> <major hex>:<minor hex>:<inode decimal> 0 EOF` (blocked waiters carry `->` and never match). */
const LOCK_LINE = /^\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(-?\d+)\s+([0-9a-fA-F]+):([0-9a-fA-F]+):(\d+)(?:\s|$)/;

/** The exclusive flock holders listed in `/proc/locks`; POSIX, OFD, shared locks, waiters and malformed lines are ignored. */
export function parseProcLocks(text: string): ProcLockEntry[] {
    const entries: ProcLockEntry[] = [];
    for (const line of text.split("\n")) {
        const match = LOCK_LINE.exec(line);
        if (!match) continue;
        entries.push({
            pid: Number(match[1]), major: Number.parseInt(match[2]!, 16), minor: Number.parseInt(match[3]!, 16), inode: Number(match[4]),
        });
    }
    return entries;
}

/** Splits a Linux `st_dev` (the `new_encode_dev` layout) into the kernel's major and minor numbers. */
export function decodeDevice(dev: number | bigint): { major: number; minor: number } {
    const value = BigInt(dev);
    const major = ((value >> 8n) & 0xfffn) | ((value >> 32n) & 0xfffff000n);
    const minor = (value & 0xffn) | ((value >> 12n) & 0xffffff00n);
    return { major: Number(major), minor: Number(minor) };
}

/**
 * Contract W3: the process must itself hold an exclusive flock on the lock file (`flock -F` leaves the lock with node).
 * Anything else, including an unreadable `/proc/locks`, is `lock-not-held`; the cause never reaches the error.
 */
export async function assertLockHeld(lockPath: string, probe: FsProbe, pid: number = process.pid): Promise<void> {
    try {
        const stat = await fs.lstat(lockPath);
        if (!stat.isFile()) throw new WorkerError("lock-not-held");
        const { major, minor } = decodeDevice(stat.dev);
        const held = parseProcLocks(await probe.readProcLocks())
            .some((entry) => entry.pid === pid && entry.major === major && entry.minor === minor && entry.inode === stat.ino);
        if (!held) throw new WorkerError("lock-not-held");
    } catch {
        throw new WorkerError("lock-not-held");
    }
}
