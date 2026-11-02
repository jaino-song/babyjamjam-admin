import { promises as fs } from "node:fs";

import { FS_TYPE_EXT4, type FsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";

import type { DriveHarness } from "./drive-support";
import { COMPANY, lockedProbe, readLedgerRecords, withWorker, type Harness } from "./runner-support";

export const MIB = 1024 * 1024;

/** Binds the Drive root in-process (what `drive-setup` does), against the fakes. */
export async function bindDrive(h: Harness, rebind = false): Promise<void> {
    await withWorker(h, "drive-setup", (worker) => worker.runner.driveSetup({ rebind }));
}

/** The root folder id of the latest `drive_bound` record. */
export async function currentRootId(h: Harness): Promise<string> {
    const bound = (await readLedgerRecords(h.control)).filter((record) => record.type === "drive_bound");
    return bound[bound.length - 1]!.body["rootFolderId"] as string;
}

/** Every file under the bound root, keyed by its archive-relative path (Drive names are the path segments). */
export async function driveTree(h: Harness, fakes: DriveHarness): Promise<Map<string, Buffer>> {
    const tree = new Map<string, Buffer>();
    const walk = (id: string, prefix: string): void => {
        for (const node of fakes.drive.children(id)) {
            if (node.trashed) continue;
            if (node.bytes !== null) tree.set(`${prefix}${node.name}`, node.bytes);
            else walk(node.id, `${prefix}${node.name}/`);
        }
    };
    walk(await currentRootId(h), "");
    return tree;
}

export const driveKeys = (tree: Map<string, Buffer>, pattern: RegExp): string[] => [...tree.keys()].filter((key) => pattern.test(key)).sort();
export const PDF_KEY = /\/artifacts\/[^/]+\/[0-9a-f]{64}\.pdf$/;
export const MANIFEST_KEY = /\/manifests\//;
export const COMPLETION_KEY = /\/completions\//;
export const RUN_KEY = /\/runs\//;
export const JSON_KEY = /\.json$/;

/** Every (parent, name) pair on the fake Drive, counting live non-root nodes: duplicates show as a count above one. */
export function duplicateNodes(fakes: DriveHarness): string[] {
    const seen = new Map<string, number>();
    for (const node of fakes.drive.nodes()) {
        if (node.id === fakes.drive.myDriveId) continue;
        const key = `${node.parents.join(",")}|${node.name}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

export async function swapArchive(h: Harness): Promise<string> {
    const away = `${h.archive}.away`;
    await fs.rename(h.archive, away);
    await fs.mkdir(h.archive, { mode: 0o700 });
    return away;
}
export async function swapBack(h: Harness, away: string): Promise<void> {
    await fs.rename(h.archive, `${h.archive}.new`);
    await fs.rename(away, h.archive);
}

/** Free space per volume: the control path gets `controlFreeBytes`, everything else is roomy. */
export function probeWith(h: Harness, controlFreeBytes: number, archiveFreeBytes = 4 * 1024 * MIB): FsProbe {
    const locks = lockedProbe(h.lockPath);
    return {
        readProcLocks: locks.readProcLocks,
        statfs: async (target) => ({
            type: FS_TYPE_EXT4, bsize: 4096, ffree: 1_000_000,
            bavail: Math.floor((target.startsWith(h.control) ? controlFreeBytes : archiveFreeBytes) / 4096),
        }),
    };
}

export const completionPrefix = `eformsign/${COMPANY}/completions/`;
