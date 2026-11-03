import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import { artifactKey, applyLedgerRecord, buildCompletion, buildManifest, destinationKey, emptyLedgerState, manifestKey } from "domain/eformsign-backup/worker";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { FS_TYPE_EXT4, type FsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";
import { DriveRunPhase } from "infrastructure/eformsign-backup/worker/runner-drive";

import type { DriveHarness } from "./drive-support";
import { COMPANY, lockedProbe, makeBase, readLedgerRecords, withWorker, type Harness } from "./runner-support";

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

// ---- a DriveRunPhase with stubbed collaborators (record publication and rebind cases) -----------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- the rig stubs structural collaborators of the phase */
const NOW = "2026-11-02T00:00:00.000Z";
export const rigUuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const hashOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const METADATA_REVISION = "a".repeat(64);

export interface RigDoc {
    documentId: string;
    pdf: Buffer;
    job: { documentId: string; artifactType: "document"; fileType: "document"; sha256: string; byteLength: number; artifactIdentity: string; relativeKey: string };
    manifest: { bytes: Uint8Array; sha256: string };
    manifestKey: string;
    candidate: { documentId: string; metadataRevision: string; artifacts: any[] };
}

export function rigDoc(documentId: string): RigDoc {
    const pdf = Buffer.from(`%PDF-1.4\n${documentId}\n%%EOF\n`);
    const base = { documentId, artifactType: "document" as const, fileType: "document" as const, sha256: hashOf(pdf), byteLength: pdf.length };
    const identity = artifactIdentity({ companyId: "C001", documentId, artifactKind: "document", contentSha256: base.sha256, byteLength: base.byteLength });
    const job = { ...base, artifactIdentity: identity, relativeKey: artifactKey({ companyId: "C001", ...base }) };
    const manifest = buildManifest({ companyId: "C001", documentId, metadataRevision: METADATA_REVISION, artifacts: [job] } as never);
    const key = manifestKey({ companyId: "C001", documentId, metadataRevision: METADATA_REVISION, manifestSha256: manifest.sha256 });
    return { documentId, pdf, job, manifest, manifestKey: key, candidate: { documentId, metadataRevision: METADATA_REVISION, artifacts: [job] } };
}

export interface PhaseRig {
    dir: string;
    state: () => any;
    deps: any;
    phase: DriveRunPhase;
    host: any;
    destination: any;
    calls: string[];
    artifactUploads: string[];
    recordUploads: Array<{ key: string; bytes: Buffer }>;
    ledgerRecords: Array<{ type: string; body: any }>;
    archiveFiles: Map<string, Buffer>;
    controlFree: { bytes: number };
    revision: string;
    driveIdentity: string;
    setEntry: (doc: RigDoc, identity: string, revision: string, state: string) => void;
    knowArtifact: (doc: RigDoc) => void;
    completionOf: (doc: RigDoc, sequence?: number) => ReturnType<typeof buildCompletion>;
    completionContext: () => any;
    /** A fresh phase over the same ledger, archive stubs and Drive stub: the next run. */
    newPhase: () => DriveRunPhase;
    cleanup: () => Promise<void>;
}

export async function makePhaseRig(options: { archiveOk?: boolean } = {}): Promise<PhaseRig> {
    const dir = await makeBase("bjj456-rig-");
    let archiveOk = options.archiveOk ?? true;
    let state: any = emptyLedgerState();
    const revision = `drive-layout-v1:${rigUuid(3)}`;
    const driveIdentity = "drive:rootFolder002";
    const binding = {
        status: "ready", rootFolderId: "rootFolder002", rootName: "backup", rootParentId: "myDrive00001", bindingId: rigUuid(3),
        destinationIdentity: driveIdentity, destinationRevision: revision, accountId: "account-1",
    };
    state.lastSeq = 1;
    state.installation = {
        installationId: rigUuid(2), archiveId: rigUuid(1), archiveDev: 1, archiveIno: 1, destinationIdentity: `local:${rigUuid(1)}`,
        destinationRevision: "local-layout-v1", origin: "installed", priorLedgerName: null, drive: binding,
    };
    const calls: string[] = [];
    const artifactUploads: string[] = [];
    const recordUploads: Array<{ key: string; bytes: Buffer }> = [];
    const ledgerRecords: Array<{ type: string; body: any }> = [];
    const archiveFiles = new Map<string, Buffer>();
    const controlFree = { bytes: 4 * 1024 * 1024 * 1024 };
    const destination: any = {
        checkRoot: async () => { calls.push("checkRoot"); return { ok: true, value: "ok" }; },
        ensureFolderChain: async () => { calls.push("ensureFolderChain"); return { ok: true, value: "parent000001" }; },
        uploadArtifact: async (input: any) => { calls.push("uploadArtifact"); artifactUploads.push(input.relativeKey); return { ok: true, value: { fileId: "artifact00001" } }; },
        verifyRemote: async () => { calls.push("verifyRemote"); return { ok: true, value: "ok" }; },
        download: async () => { calls.push("download"); return { ok: false, failure: { kind: "http", httpStatus: 404, reason: null, retryAfterSeconds: null } }; },
        publishJson: async (key: string, bytes: Uint8Array) => {
            calls.push("publishJson");
            recordUploads.push({ key, bytes: Buffer.from(bytes) });
            return { ok: true, value: { fileId: "record000001", sha256: hashOf(bytes) } };
        },
    };
    const deps: any = {
        config: { companyId: "C001", control: { path: dir, reserveBytes: 64 * 1024 * 1024, reserveInodes: 1000 }, archive: { path: dir } },
        clock: { now: () => new Date(NOW) },
        probe: { statfs: async () => ({ type: 0xef53, bsize: 4096, bavail: Math.floor(controlFree.bytes / 4096), ffree: 1_000_000 }) },
        drive: { kind: "ready" },
        createDriveDestination: () => destination,
        ledger: {
            get state() { return state; },
            append: async (type: string, body: any, at: string) => {
                ledgerRecords.push({ type, body });
                state = applyLedgerRecord(state, { v: 1, seq: state.lastSeq + 1, type, body, at } as never);
            },
        },
    };
    const host: any = {
        archiveOk: () => archiveOk,
        archiveLost: () => { archiveOk = false; },
        manifestOf: (candidate: any) => { const doc = rigDocs.get(candidate.documentId)!; return { key: doc.manifestKey, bytes: doc.manifest.bytes, sha256: doc.manifest.sha256 }; },
        stagedUsable: async () => true,
        setStagingAside: async () => undefined,
        restage: async () => ({ ok: true }),
        locallyPublished: () => false,
        localCompletion: () => null,
        completionContext: () => null,
    };
    const rigDocs = new Map<string, RigDoc>();
    const archive: any = {
        readArchiveFile: async (key: string) => archiveFiles.get(key) ?? null,
        openStaged: (_root: unknown, identity: string) => (async function* () { yield [...rigDocs.values()].find((doc) => doc.job.artifactIdentity === identity)!.pdf; })(),
        reverify: async () => "ok",
    };
    const phase = DriveRunPhase.forRun(deps, state.installation, archive, { path: dir } as never, host)!;
    const entry = (doc: RigDoc, identity: string, rev: string, status: string): any => ({
        artifactIdentity: doc.job.artifactIdentity, destinationIdentity: identity, destinationRevision: rev, state: status, attempts: 0,
        nextRetryAt: null, reasonCode: null, relativeKey: doc.job.relativeKey, lastVerifiedAt: NOW, history: [],
    });
    const rig: PhaseRig = {
        dir, state: () => state, deps, phase, host, destination, calls, artifactUploads, recordUploads, ledgerRecords, archiveFiles, controlFree, revision, driveIdentity,
        setEntry: (doc, identity, rev, status) => {
            rigDocs.set(doc.documentId, doc);
            state.destinations.set(destinationKey(doc.job.artifactIdentity, identity, rev), entry(doc, identity, rev, status));
        },
        knowArtifact: (doc) => {
            rigDocs.set(doc.documentId, doc);
            state.artifacts.set(doc.job.artifactIdentity, { documentId: doc.documentId, artifactType: doc.job.artifactType, sha256: doc.job.sha256, byteLength: doc.job.byteLength });
        },
        completionOf: (doc, sequence = 1) => buildCompletion({
            companyId: "C001", sequence, snapshotId: "snapshot-1", runId: rigUuid(10), scopeRevision: "scope-v1", policyRevision: "policy-v1",
            destinationIdentity: `local:${rigUuid(1)}`, destinationRevision: "local-layout-v1",
            entries: [{ documentId: doc.documentId, metadataRevision: doc.candidate.metadataRevision, manifestSha256: doc.manifest.sha256, manifestKey: doc.manifestKey }], gaps: [],
        } as never),
        completionContext: () => ({
            companyId: "C001", runId: rigUuid(10), sequence: 1, snapshotId: "snapshot-1", scopeRevision: "scope-v1", policyRevision: "policy-v1",
            localIdentity: state.installation.destinationIdentity, localRevision: state.installation.destinationRevision,
            stateGaps: [], blockedDocuments: new Map(), emptyDocuments: new Set(),
        }),
        newPhase: () => DriveRunPhase.forRun(deps, state.installation, archive, { path: dir } as never, host)!,
        cleanup: async () => { await fs.rm(dir, { recursive: true, force: true }); },
    };
    return rig;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
