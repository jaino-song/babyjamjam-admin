import path from "node:path";

import { decodeLedgerLine, type ArchiveArtifactType, type Installation } from "domain/eformsign-backup/worker";
import { REAL_LEDGER_FS, isPrivate, lstatOrNull, readRegularFile, type LedgerFs } from "./ledger-fs";
import { LEDGER_DIR_NAME } from "./ledger-replay";

const JOURNAL_PATTERN = /^journal-(\d{12})\.jsonl$/;

/** One document revision as the ledger observed it: everything a manifest is built from, and nothing else. */
export interface ManifestSource {
    documentId: string;
    metadataRevision: string;
    artifacts: ReadonlyArray<{ artifactType: ArchiveArtifactType; artifactIdentity: string; sha256: string; byteLength: number }>;
}

interface Observed { source: ManifestSource; signature: string; lastSeq: number; conflict: boolean }

/**
 * The manifest sources of the current ledger lineage, rebuilt from the retained journal files. The state projection
 * keeps only the latest snapshot's observations (the reducer drops the rest), but every `candidate_observed` record is
 * still on disk, so nothing new has to be persisted. Read-only; used for lookup only, never as proof that a file exists.
 */
export class ManifestHistory {
    private constructor(private readonly byIdentity: Map<string, Observed> | null) {}

    static readonly unavailable = new ManifestHistory(null);

    static of(byIdentity: Map<string, Observed>): ManifestHistory {
        return new ManifestHistory(byIdentity);
    }

    /**
     * The latest observed revision that lists the artifact. `null`: the history is sound and never observed it.
     * `"invalid"`: the history cannot be trusted (unreadable, broken, or two observations of one revision disagree).
     */
    find(artifactIdentity: string): ManifestSource | "invalid" | null {
        if (this.byIdentity === null) return "invalid";
        const observed = this.byIdentity.get(artifactIdentity);
        if (observed === undefined) return null;
        return observed.conflict ? "invalid" : observed.source;
    }
}

function signatureOf(source: ManifestSource): string {
    return JSON.stringify([...source.artifacts]
        .sort((a, b) => (a.artifactType < b.artifactType ? -1 : a.artifactType > b.artifactType ? 1 : 0))
        .map((artifact) => [artifact.artifactType, artifact.artifactIdentity, artifact.sha256, artifact.byteLength]));
}

/**
 * Reads `<control>/ledger/journal-*.jsonl` from record 1 up to `lastSeq`. Every line is checked (checksum, schema), the
 * sequence must run without a gap from 1 to `lastSeq`, and the first record must name this installation. Symlinks and
 * files other users can write are refused. Anything else yields `ManifestHistory.unavailable`; quarantined lineages
 * (`ledger.quarantine-*`) are never looked at.
 */
export async function readManifestHistory(
    controlPath: string, lastSeq: number, installation: Installation, fs: LedgerFs = REAL_LEDGER_FS,
): Promise<ManifestHistory> {
    try {
        const dir = path.join(controlPath, LEDGER_DIR_NAME);
        const stat = await lstatOrNull(fs, dir);
        if (stat === null || !stat.isDirectory() || !isPrivate(stat)) return ManifestHistory.unavailable;
        const journals: Array<{ name: string; base: number }> = [];
        for (const name of await fs.readdir(dir)) {
            if (!name.startsWith("journal-")) continue;
            const match = JOURNAL_PATTERN.exec(name);
            if (match === null) return ManifestHistory.unavailable;
            journals.push({ name, base: Number(match[1]) });
        }
        journals.sort((a, b) => a.base - b.base);

        const seen = new Map<string, Observed>();
        let expected = 1;
        for (const [index, journal] of journals.entries()) {
            if (expected > lastSeq) break;
            if (journal.base !== expected) return ManifestHistory.unavailable;
            const read = await readRegularFile(fs, path.join(dir, journal.name));
            if (read.kind !== "file") return ManifestHistory.unavailable;
            const end = read.bytes.lastIndexOf(0x0a) + 1;
            // Only the live (last) journal may end in a torn line; an earlier one must end on a newline.
            if (end < read.bytes.length && index !== journals.length - 1) return ManifestHistory.unavailable;
            const lines = end === 0 ? [] : read.bytes.subarray(0, end).toString("utf8").slice(0, -1).split("\n");
            for (const line of lines) {
                if (expected > lastSeq) break;
                const decoded = decodeLedgerLine(line);
                if (!decoded.ok || decoded.record.seq !== expected) return ManifestHistory.unavailable;
                const { record } = decoded;
                if (expected === 1) {
                    if ((record.type !== "installed" && record.type !== "recovery_started")
                        || record.body.installationId !== installation.installationId || record.body.archiveId !== installation.archiveId) {
                        return ManifestHistory.unavailable;
                    }
                }
                if (record.type === "candidate_observed" && record.body.classification === "included" && record.body.artifacts.length > 0) {
                    const source: ManifestSource = {
                        documentId: record.body.documentId, metadataRevision: record.body.metadataRevision,
                        artifacts: record.body.artifacts.map((artifact) => ({ ...artifact })),
                    };
                    const key = `${source.documentId}\u0000${source.metadataRevision}`;
                    const signature = signatureOf(source);
                    const known = seen.get(key);
                    if (known === undefined) seen.set(key, { source, signature, lastSeq: record.seq, conflict: false });
                    else {
                        known.lastSeq = record.seq;
                        if (known.signature !== signature) known.conflict = true;
                    }
                }
                expected += 1;
            }
        }
        if (expected !== lastSeq + 1) return ManifestHistory.unavailable;

        const byIdentity = new Map<string, Observed>();
        for (const observed of [...seen.values()].sort((a, b) => a.lastSeq - b.lastSeq)) {
            for (const artifact of observed.source.artifacts) byIdentity.set(artifact.artifactIdentity, observed);
        }
        return ManifestHistory.of(byIdentity);
    } catch {
        return ManifestHistory.unavailable;
    }
}
