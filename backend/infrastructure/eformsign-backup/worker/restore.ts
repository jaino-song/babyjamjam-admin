import { promises as fs } from "node:fs";
import path from "node:path";

import {
    WorkerError, isPathIdentifier, manifestSchema, selectCompletion,
    type ArchiveArtifactType, type Completion, type Manifest, type QuarantinedEntry,
} from "domain/eformsign-backup/worker";
import { createRealFsProbe } from "./fs-probe";
import { LocalDestination } from "./local-destination";
import { sha256Hex } from "./runner-common";

export interface RestoreOptions {
    archivePath: string;
    companyId: string;
    selector: { latest: true } | { snapshotId: string };
    outDir: string;
    /** Restore from manifests when no completion exists (never combined with a snapshot id). */
    allowIncomplete?: boolean;
}

export interface RestoredArtifact {
    artifactType: ArchiveArtifactType;
    sha256: string;
    byteLength: number;
    file: string;
}
export interface RestoredDocument {
    documentId: string;
    metadataRevision: string;
    consistency: "unverified" | "incomplete";
    artifacts: RestoredArtifact[];
}
/** The report never says "complete": the archive proves its own bytes, not that nothing is missing (contract, `unverified`). */
export interface RestoreReport {
    schemaVersion: 1;
    status: "unverified-archive" | "incomplete-archive";
    companyId: string;
    snapshotId: string | null;
    sequence: number | null;
    completion: string | null;
    documents: RestoredDocument[];
    gaps: Array<{ documentId: string; reasonCode: string }>;
    quarantined: QuarantinedEntry[];
}

const REPORT_NAME = "restore-report.json";
const MANIFEST_NAME = /^([0-9a-f]{64})\.json$/;

function isNormalAbsolute(candidate: string): boolean {
    return typeof candidate === "string" && path.isAbsolute(candidate) && candidate !== "/"
        && candidate.split("/").slice(1).every((part) => part !== "" && part !== "." && part !== "..");
}

function inside(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`);
}

/** The output directory must be new or empty, a real directory, and unrelated to the archive (restore never writes into its source). */
async function checkOutput(outDir: string, archivePath: string): Promise<{ exists: boolean }> {
    const invalid = (): WorkerError => new WorkerError("restore-output-invalid");
    if (!isNormalAbsolute(outDir)) throw invalid();
    let archiveReal: string;
    try {
        archiveReal = await fs.realpath(archivePath);
    } catch {
        throw new WorkerError("archive-unavailable");
    }
    let stat;
    try {
        stat = await fs.lstat(outDir);
    } catch (error) {
        if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw invalid();
        stat = null;
    }
    let resolved: string;
    if (stat === null) {
        let parent: string;
        try {
            parent = await fs.realpath(path.dirname(outDir));
        } catch {
            throw invalid();
        }
        resolved = path.join(parent, path.basename(outDir));
    } else {
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid();
        try {
            if ((await fs.readdir(outDir)).length !== 0) throw invalid();
            resolved = await fs.realpath(outDir);
        } catch (error) {
            throw error instanceof WorkerError ? error : invalid();
        }
    }
    if (inside(archiveReal, resolved) || inside(resolved, archiveReal)) throw invalid();
    return { exists: stat !== null };
}

interface PlannedDocument {
    documentId: string;
    manifest: Manifest;
}

function artifactSetOf(manifest: Manifest): string {
    return manifest.artifacts.map((artifact) => `${artifact.artifactType}:${artifact.sha256}`).sort().join("|");
}

async function readManifest(
    archive: LocalDestination, key: string, expect: { companyId: string; documentId: string; metadataRevision: string; sha256?: string },
): Promise<Manifest> {
    const bytes = await archive.readArchiveFile(key);
    if (bytes === null) throw new WorkerError("artifact-integrity");
    if (expect.sha256 !== undefined && sha256Hex(bytes) !== expect.sha256) throw new WorkerError("artifact-integrity");
    let parsed;
    try {
        parsed = manifestSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    } catch {
        throw new WorkerError("artifact-integrity");
    }
    if (!parsed.success || parsed.data.companyId !== expect.companyId || parsed.data.documentId !== expect.documentId
        || parsed.data.metadataRevision !== expect.metadataRevision) throw new WorkerError("artifact-integrity");
    return parsed.data;
}

async function planFromCompletion(archive: LocalDestination, completion: Completion): Promise<PlannedDocument[]> {
    const planned: PlannedDocument[] = [];
    for (const entry of completion.entries) {
        const manifest = await readManifest(archive, entry.manifestKey, {
            companyId: completion.companyId, documentId: entry.documentId, metadataRevision: entry.metadataRevision, sha256: entry.manifestSha256,
        });
        planned.push({ documentId: entry.documentId, manifest });
    }
    return planned;
}

/** No completion: every document with a manifest. Two manifests of one document that disagree on the bytes are a conflict, not a guess. */
async function planFromManifests(archive: LocalDestination, archivePath: string, companyId: string): Promise<PlannedDocument[]> {
    const root = `${archivePath}/eformsign/${companyId}`;
    let names: string[];
    try {
        names = (await fs.readdir(root)).sort();
    } catch {
        return [];
    }
    const planned: PlannedDocument[] = [];
    for (const documentId of names) {
        if (!isPathIdentifier(documentId)) continue;
        const stat = await fs.lstat(`${root}/${documentId}`);
        if (stat.isSymbolicLink()) throw new WorkerError("archive-unsafe-path");
        if (!stat.isDirectory()) continue;
        let files: string[];
        try {
            files = (await fs.readdir(`${root}/${documentId}/manifests`)).filter((name) => MANIFEST_NAME.test(name)).sort();
        } catch {
            continue;
        }
        const manifests: Manifest[] = [];
        for (const name of files) {
            const metadataRevision = MANIFEST_NAME.exec(name)![1]!;
            manifests.push(await readManifest(archive, `eformsign/${companyId}/${documentId}/manifests/${name}`, { companyId, documentId, metadataRevision }));
        }
        if (manifests.length === 0) continue;
        if (new Set(manifests.map(artifactSetOf)).size > 1) throw new WorkerError("restore-conflict");
        planned.push({ documentId, manifest: manifests[0]! });
    }
    return planned;
}

/**
 * Restores one backup from the archive alone (contract section 6, V13). Everything is verified against the manifests
 * and the PDF check before the first byte is written; nothing is written into the archive; the result is always
 * reported as unverified because the archive cannot prove it holds every document.
 */
export async function restoreFromArchive(options: RestoreOptions): Promise<RestoreReport> {
    const { archivePath, companyId, selector, outDir } = options;
    if (!isNormalAbsolute(archivePath) || !isPathIdentifier(companyId)) throw new WorkerError("config-invalid");
    let root;
    try {
        root = await fs.lstat(archivePath);
    } catch {
        throw new WorkerError("archive-unavailable");
    }
    const outcome = await checkOutput(outDir, archivePath);
    const archive = new LocalDestination({
        archivePath, archiveId: "restore-reader", expectedDev: root.dev, expectedIno: root.ino, reserveBytes: 0, reserveInodes: 0,
        requireMountPoint: false,
    }, createRealFsProbe());

    const selection = selectCompletion(await archive.listCompletions(companyId), { companyId, ...selector });
    if (selection.kind === "conflict") throw new WorkerError("restore-conflict");
    let planned: PlannedDocument[];
    let report: Omit<RestoreReport, "documents">;
    if (selection.kind === "selected") {
        const completion = selection.entry.completion;
        planned = await planFromCompletion(archive, completion);
        report = {
            schemaVersion: 1, status: "unverified-archive", companyId, snapshotId: completion.snapshotId, sequence: completion.sequence,
            completion: selection.entry.name, gaps: completion.gaps.map((gap) => ({ documentId: gap.documentId, reasonCode: gap.reasonCode })),
            quarantined: selection.quarantined,
        };
    } else {
        if (options.allowIncomplete !== true || "snapshotId" in selector) throw new WorkerError("not-initialized");
        planned = await planFromManifests(archive, archivePath, companyId);
        report = {
            schemaVersion: 1, status: "incomplete-archive", companyId, snapshotId: null, sequence: null, completion: null, gaps: [],
            quarantined: selection.quarantined,
        };
    }

    // Pass 1: nothing is written until every artifact has been found again with the right hash.
    for (const doc of planned) {
        for (const artifact of doc.manifest.artifacts) {
            if (await archive.reverify(artifact.relativeKey, artifact.sha256, artifact.byteLength) !== "ok") throw new WorkerError("artifact-integrity");
        }
    }

    // Pass 2: write.
    if (!outcome.exists) await fs.mkdir(outDir, { mode: 0o700 });
    const documents: RestoredDocument[] = [];
    for (const doc of planned) {
        await fs.mkdir(`${outDir}/${doc.documentId}`, { mode: 0o700 });
        const restored: RestoredArtifact[] = [];
        for (const artifact of doc.manifest.artifacts) {
            const bytes = await archive.readArchiveFile(artifact.relativeKey);
            if (bytes === null || bytes.length !== artifact.byteLength || sha256Hex(bytes) !== artifact.sha256) throw new WorkerError("artifact-integrity");
            const file = `${doc.documentId}/${artifact.artifactType}.pdf`;
            await writeNew(`${outDir}/${file}`, bytes);
            restored.push({ artifactType: artifact.artifactType, sha256: artifact.sha256, byteLength: artifact.byteLength, file });
        }
        documents.push({ documentId: doc.documentId, metadataRevision: doc.manifest.metadataRevision, consistency: doc.manifest.consistency, artifacts: restored });
    }
    const full: RestoreReport = { ...report, documents };
    await writeNew(`${outDir}/${REPORT_NAME}`, Buffer.from(`${JSON.stringify(full, null, 2)}\n`, "utf8"));
    return full;
}

async function writeNew(target: string, bytes: Uint8Array): Promise<void> {
    const handle = await fs.open(target, "wx", 0o600);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
}
