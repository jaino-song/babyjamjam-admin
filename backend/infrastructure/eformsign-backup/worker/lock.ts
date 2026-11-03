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

/** The lock file as it was when the worker verified it: the device and inode every later re-check must still find at the path. */
export interface HeldLock {
    dev: number;
    ino: number;
}

function holdsLock(entries: ProcLockEntry[], held: HeldLock, pid: number): boolean {
    const { major, minor } = decodeDevice(held.dev);
    return entries.some((entry) => entry.pid === pid && entry.major === major && entry.minor === minor && entry.inode === held.ino);
}

/**
 * Contract W3: the process must itself hold an exclusive flock on the lock file (`flock -F` leaves the lock with node).
 * Anything else, including an unreadable `/proc/locks`, is `lock-not-held`; the cause never reaches the error.
 * Resolves with the device and inode that was verified, for `lockGuard`.
 */
export async function verifyLockHeld(lockPath: string, probe: FsProbe, pid: number = process.pid): Promise<HeldLock> {
    try {
        const stat = await fs.lstat(lockPath);
        if (!stat.isFile()) throw new WorkerError("lock-not-held");
        const held: HeldLock = { dev: stat.dev, ino: stat.ino };
        if (!holdsLock(parseProcLocks(await probe.readProcLocks()), held, pid)) throw new WorkerError("lock-not-held");
        return held;
    } catch {
        throw new WorkerError("lock-not-held");
    }
}

export async function assertLockHeld(lockPath: string, probe: FsProbe, pid: number = process.pid): Promise<void> {
    await verifyLockHeld(lockPath, probe, pid);
}

/**
 * A re-check for the moment just before a write. The lock path must still resolve to the inode that was verified at start
 * (a deleted or replaced lock file lets a second worker lock a new inode while this one still holds the old one), and
 * `/proc/locks` must still list this pid on that inode. Any failure is `lock-not-held`.
 */
export function lockGuard(lockPath: string, probe: FsProbe, held: HeldLock, pid: number = process.pid): () => Promise<void> {
    return async () => {
        try {
            const stat = await fs.lstat(lockPath);
            if (!stat.isFile() || stat.dev !== held.dev || stat.ino !== held.ino) throw new WorkerError("lock-not-held");
            if (!holdsLock(parseProcLocks(await probe.readProcLocks()), held, pid)) throw new WorkerError("lock-not-held");
        } catch {
            throw new WorkerError("lock-not-held");
        }
    };
}
