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

/**
 * A document revision's metadata does not bind its artifact bytes (the export's metadata revision leaves hashes and
 * lengths out), so different snapshots may advertise different artifact sets under one revision. Each distinct set seen is
 * one variant. Two observations of one revision inside ONE snapshot that disagree contradict each other: the group is
 * `contradicted` and none of its variants is trusted.
 */
interface Group { contradicted: boolean; bySnapshot: Map<string, string> }
interface Variant { source: ManifestSource; signature: string; lastSeq: number; group: Group }

/**
 * The manifest sources of the current ledger lineage, rebuilt from the retained journal files. The state projection
 * keeps only the latest snapshot's observations (the reducer drops the rest), but every `candidate_observed` record is
 * still on disk, so nothing new has to be persisted. Read-only; used for lookup only, never as proof that a file exists.
 */
export class ManifestHistory {
    private constructor(
        private readonly byIdentity: Map<string, Variant[]> | null,
        private readonly byRevision: Map<string, { group: Group; variants: Variant[] }> | null,
        private readonly lengthConflicts: ReadonlySet<string>,
    ) {}

    static readonly unavailable = new ManifestHistory(null, null, new Set());

    static of(
        byIdentity: Map<string, Variant[]>, byRevision: Map<string, { group: Group; variants: Variant[] }>, lengthConflicts: ReadonlySet<string>,
    ): ManifestHistory {
        return new ManifestHistory(byIdentity, byRevision, lengthConflicts);
    }

    /**
     * Every artifact set the ledger observed for one document revision, oldest first (by document and revision, never by
     * "latest"). Empty: the history is sound and never saw the revision.
     */
    forRevision(documentId: string, metadataRevision: string): RevisionLookup {
        if (this.byRevision === null) return "unavailable";
        const known = this.byRevision.get(`${documentId}\u0000${metadataRevision}`);
        if (known === undefined) return [];
        return known.group.contradicted ? "conflict" : known.variants.map((variant) => variant.source);
    }

    /**
     * The latest sound observation that lists the artifact. `null`: the history is sound and never observed it.
     * `"invalid"`: the history cannot be trusted (unreadable, broken, every observation of it contradicts itself, or two
     * observations disagree on a length the identity does not bind).
     */
    find(artifactIdentity: string): ManifestSource | "invalid" | null {
        if (this.byIdentity === null || this.lengthConflicts.has(artifactIdentity)) return "invalid";
        const variants = this.byIdentity.get(artifactIdentity);
        if (variants === undefined) return null;
        for (let index = variants.length - 1; index >= 0; index -= 1) {
            if (!variants[index]!.group.contradicted) return variants[index]!.source;
        }
        return "invalid";
    }
}

/** A revision's observed artifact sets; `"unavailable"` when the history cannot be used, `"conflict"` when one snapshot's observations disagree. */
export type RevisionLookup = ManifestSource[] | "unavailable" | "conflict";

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

        const seen = new Map<string, { group: Group; variants: Map<string, Variant> }>();
        const lengths = new Map<string, number>();
        const lengthConflicts = new Set<string>();
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
                    let known = seen.get(key);
                    if (known === undefined) {
                        known = { group: { contradicted: false, bySnapshot: new Map() }, variants: new Map() };
                        seen.set(key, known);
                    }
                    let variant = known.variants.get(signature);
                    if (variant === undefined) {
                        variant = { source, signature, lastSeq: record.seq, group: known.group };
                        known.variants.set(signature, variant);
                    }
                    variant.lastSeq = record.seq;
                    const earlier = known.group.bySnapshot.get(record.body.snapshotId);
                    if (earlier === undefined) known.group.bySnapshot.set(record.body.snapshotId, signature);
                    else if (earlier !== signature) known.group.contradicted = true;
                    for (const artifact of source.artifacts) {
                        const length = lengths.get(artifact.artifactIdentity);
                        if (length === undefined) lengths.set(artifact.artifactIdentity, artifact.byteLength);
                        else if (length !== artifact.byteLength) lengthConflicts.add(artifact.artifactIdentity);
                    }
                }
                expected += 1;
            }
        }
        if (expected !== lastSeq + 1) return ManifestHistory.unavailable;

        const byIdentity = new Map<string, Variant[]>();
        const byRevision = new Map<string, { group: Group; variants: Variant[] }>();
        for (const [key, known] of seen) {
            const variants = [...known.variants.values()].sort((a, b) => a.lastSeq - b.lastSeq);
            byRevision.set(key, { group: known.group, variants });
            for (const variant of variants) {
                for (const artifact of variant.source.artifacts) {
                    byIdentity.set(artifact.artifactIdentity, [...(byIdentity.get(artifact.artifactIdentity) ?? []), variant]);
                }
            }
        }
        for (const variants of byIdentity.values()) variants.sort((a, b) => a.lastSeq - b.lastSeq);
        return ManifestHistory.of(byIdentity, byRevision, lengthConflicts);
    } catch {
        return ManifestHistory.unavailable;
    }
}
