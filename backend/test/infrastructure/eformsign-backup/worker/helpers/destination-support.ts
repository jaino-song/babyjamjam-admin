import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import { FS_TYPE_EXT4, type FsProbe, type StatfsInfo } from "infrastructure/eformsign-backup/worker/fs-probe";
import {
    LocalDestination, type ArtifactPublishInput, type LocalDestinationOptions,
} from "infrastructure/eformsign-backup/worker/local-destination";

export const TEST_ARCHIVE_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_INSTALLATION_ID = "install-synthetic-1";
export const TEST_RESERVE_BYTES = 1024 * 1024;
export const TEST_RESERVE_INODES = 100;

/** Every filesystem test root lives under the home directory: the archive primitive rejects /tmp ancestors. */
export async function makeTestBase(): Promise<string> {
    return fs.mkdtemp(path.join(homedir(), "bjj455-destination-"));
}

export function installationMarkerBytes(archiveId = TEST_ARCHIVE_ID): Buffer {
    return Buffer.from(JSON.stringify({
        schemaVersion: 1, installationId: TEST_INSTALLATION_ID, archiveId, createdAt: "2026-10-19T00:00:00.000Z",
    }) + "\n");
}

export interface ArchiveFixture { root: string; dev: number; ino: number }

export async function makeArchive(base: string, options: { name?: string; marker?: false | string } = {}): Promise<ArchiveFixture> {
    const root = path.join(base, options.name ?? "archive");
    await fs.mkdir(root, { mode: 0o700 });
    if (options.marker !== false) {
        await fs.mkdir(path.join(root, ".bjj-backup"), { mode: 0o700 });
        await fs.writeFile(path.join(root, ".bjj-backup", "installation.json"),
            installationMarkerBytes(options.marker ?? TEST_ARCHIVE_ID), { mode: 0o600 });
    }
    const stat = await fs.lstat(root);
    return { root, dev: stat.dev, ino: stat.ino };
}

export function probeFor(overrides: Partial<StatfsInfo> = {}, locks = ""): FsProbe {
    return {
        statfs: async () => ({ type: FS_TYPE_EXT4, bavail: 1_000_000, bsize: 4096, ffree: 1_000_000, ...overrides }),
        readProcLocks: async () => locks,
    };
}

export function destinationOptions(fixture: ArchiveFixture, overrides: Partial<LocalDestinationOptions> = {}): LocalDestinationOptions {
    return {
        archivePath: fixture.root, archiveId: TEST_ARCHIVE_ID, expectedDev: fixture.dev, expectedIno: fixture.ino,
        reserveBytes: TEST_RESERVE_BYTES, reserveInodes: TEST_RESERVE_INODES, requireMountPoint: false, ...overrides,
    };
}

export function makeDestination(
    fixture: ArchiveFixture,
    overrides: Partial<LocalDestinationOptions> = {},
    probe: FsProbe = probeFor(),
    fault?: (point: ArchiveFaultPoint) => void,
): LocalDestination {
    return new LocalDestination(destinationOptions(fixture, overrides), probe, fault);
}

export function sha256Of(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** The identity of a claim; an invalid id (rejected by the evidence rules) gets a placeholder so a test can still build the input. */
function identityOf(claim: Omit<ArtifactPublishInput, "artifactIdentity">): string {
    try {
        return artifactIdentity({
            companyId: claim.companyId, documentId: claim.documentId, artifactKind: claim.artifactType,
            contentSha256: claim.sha256, byteLength: claim.byteLength,
        });
    } catch {
        return "f".repeat(64);
    }
}

export function publishInput(bytes: Uint8Array, overrides: Partial<ArtifactPublishInput> = {}): ArtifactPublishInput {
    const base = {
        companyId: "C001", documentId: "D001", artifactType: "document" as const,
        sha256: sha256Of(bytes), byteLength: bytes.byteLength,
    };
    const merged = { ...base, ...overrides };
    return { ...merged, artifactIdentity: overrides.artifactIdentity ?? identityOf(merged) };
}

export async function* streamOf(bytes: Uint8Array, chunk = 7): AsyncIterable<Uint8Array> {
    for (let offset = 0; offset < bytes.byteLength; offset += chunk) yield bytes.subarray(offset, offset + chunk);
}

/** Recursive listing of everything under `dir` (relative path, kind, size, mode): equal listings mean nothing was written. */
export async function snapshotTree(dir: string): Promise<string[]> {
    const lines: string[] = [];
    async function walk(current: string): Promise<void> {
        for (const entry of (await fs.readdir(current)).sort()) {
            const full = path.join(current, entry);
            const stat = await fs.lstat(full);
            const kind = stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : "f";
            lines.push(`${path.relative(dir, full)}|${kind}|${kind === "f" ? stat.size : 0}|${(stat.mode & 0o777).toString(8)}`);
            if (stat.isDirectory()) await walk(full);
        }
    }
    await walk(dir);
    return lines;
}

export async function restoreDirectoryModes(dir: string): Promise<void> {
    try { await fs.chmod(dir, 0o700); } catch { /* removed already */ }
}
