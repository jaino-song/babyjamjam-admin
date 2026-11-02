import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import { EXPORT_ARTIFACT_MAX_BYTES } from "domain/eformsign-backup/export/constants";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import {
    WorkerError, actionForExportError, artifactKey, buildCompletion, buildManifest, buildRunInventory, completionContentDigest,
    completionSchema, integrityErrorCount, integrityRetryDecision, judgeHistoricalCoverage, judgeSnapshotStatus, manifestKey,
    nextRetryAt, nextSnapshotSequence, parseCompletionName, parseManifestKey, runKey, toArchiveArtifactType,
    type ArchiveArtifactType, type DestinationEntry, type ExportAction, type Manifest, type RunCounts, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { DEFAULT_COMPACTION_THRESHOLD } from "./ledger-store";
import { artifactIdentityDerives, listManifestFiles, parseManifestBytes, type ManifestFile } from "./restore";
import { readManifestHistory, type ManifestHistory, type ManifestSource } from "./runner-manifest-sources";
import {
    ExportFailure, type CandidatePageView, type CandidateView, type SnapshotView,
} from "./export-client";
import type { LocalDestination, StagingRoot } from "./local-destination";
import {
    DestinationLedger, SNAPSHOT_POLL_LIMIT, SNAPSHOT_POLL_MS, TRANSIENT_STOP, assertLedgerRoom, assertSameInstallation,
    controlHasStagingRoom, countOrphanTemps, isArchiveSide, isTerminalReason, nowIso, requireInstallation,
} from "./runner-common";
import { DriveRunPhase, type DriveBuiltRecord, type DriveCompletionContext, type DriveRunHost } from "./runner-drive";
import { type RunSummary, type RunnerDependencies } from "./runner-types";

const OPAQUE_ID = /^[^\u0000-\u001f\u007f]{1,512}$/u;

/**
 * The raw-manifest digests that valid completions bind to each manifest key, read with recovery's own rules: a completion
 * counts only when its name, company, sequence and content digest agree with its content.
 */
export function completionBindings(
    files: ReadonlyArray<{ name: string; content: unknown }>, companyId: string,
): Map<string, Set<string>> {
    const digests = new Map<string, Set<string>>();
    for (const file of files) {
        const name = parseCompletionName(file.name);
        if (name === null) continue;
        const content = completionSchema.safeParse(file.content);
        if (!content.success || content.data.companyId !== companyId || content.data.sequence !== name.sequence
            || completionContentDigest(content.data) !== name.contentDigest) continue;
        for (const entry of content.data.entries) {
            const known = digests.get(entry.manifestKey) ?? new Set<string>();
            known.add(entry.manifestSha256);
            digests.set(entry.manifestKey, known);
        }
    }
    return digests;
}

/**
 * `verify --all`: how many bound manifests (acknowledged by the ledger or named by a valid completion) are missing from the
 * archive, are no valid manifest of their document, or have another digest than the ledger or a completion binds. Each is
 * read once; nothing is repaired or written. An archive-side refusal is rethrown: the archive itself is not usable, which
 * is not the file's fault. Plain `verify` (no `--all`) does not run this check, so its scope stays PDF-only.
 */
export async function countDamagedBoundManifests(deps: RunnerDependencies, archive: LocalDestination): Promise<number> {
    const { companyId } = deps.config;
    const bound = new Map<string, Set<string>>();
    const bind = (key: string, sha256: string): void => {
        bound.set(key, (bound.get(key) ?? new Set<string>()).add(sha256));
    };
    for (const [key, acknowledged] of deps.ledger.state.manifests) bind(key, acknowledged.sha256);
    for (const [key, digests] of completionBindings(await archive.listCompletions(companyId), companyId)) for (const sha256 of digests) bind(key, sha256);
    let damaged = 0;
    for (const [key, digests] of bound) {
        const parts = parseManifestKey(key);
        if (parts === null || parts.companyId !== companyId) continue;
        try {
            const bytes = await archive.readArchiveFile(key);
            if (bytes === null) throw new WorkerError("artifact-integrity");
            const { sha256 } = parseManifestBytes(bytes, key, { companyId, documentId: parts.documentId, metadataRevision: parts.metadataRevision });
            if ([...digests].some((expected) => expected !== sha256)) throw new WorkerError("artifact-integrity");
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            if (isArchiveSide(error.reasonCode)) throw error;
            damaged += 1;
        }
    }
    return damaged;
}

/**
 * The failure a run ends with after everything else has been done and recorded (`ledger-inconsistent`, `archive-conflict`).
 * It carries the run's summary, so the command line can still print the run's own lines before it exits.
 */
export class RunEndedWithFailure extends WorkerError {
    constructor(reasonCode: WorkerReasonCode, readonly summary: RunSummary) {
        super(reasonCode);
        this.name = "RunEndedWithFailure";
    }
}

/** A run that cannot get a usable snapshot ends as `failed` with this reason; it is an outcome, not an error. */
class StageFailure extends Error {
    constructor(readonly reasonCode: WorkerReasonCode) {
        super(reasonCode);
        this.name = "StageFailure";
    }
}

interface ArtifactJob {
    documentId: string;
    artifactType: ArchiveArtifactType;
    fileType: "document" | "audit_trail";
    artifactIdentity: string;
    sha256: string;
    byteLength: number;
    relativeKey: string;
}
interface WorkCandidate {
    documentId: string;
    metadataRevision: string;
    artifacts: ArtifactJob[];
}

function sortedUnique(codes: Iterable<WorkerReasonCode>): WorkerReasonCode[] {
    return [...new Set(codes)].sort();
}

/** An entry that still has work to do: not verified, not in flight, and not blocked for good (terminal or integrity-repeated). */
function carryable(entry: DestinationEntry): boolean {
    switch (entry.state) {
        case "integrity_error":
        case "retry_wait":
        case "pending":
            return true;
        case "blocked":
            return !isTerminalReason(entry.reasonCode) && entry.reasonCode !== "integrity-repeated";
        default:
            return false;
    }
}

/**
 * One `run` (contract section 3, steps 1-11). The class holds only the facts of this run; everything durable goes through
 * the ledger first. A failure of the control side (ledger, staging) is thrown and stops everything: the run stays open
 * in the ledger and the next start finishes it as crashed.
 */
class RunExecution {
    private readonly dl: DestinationLedger;
    private runId = "";
    private startedAt = "";
    private snapshotId: string | null = null;
    private archiveOk = true;
    private stopDownloads = false;
    private transientStreak = 0;
    private blockRun: WorkerReasonCode | null = null;
    private snapshotFailure: WorkerReasonCode | null = null;
    private readonly reasons = new Set<WorkerReasonCode>();
    private readonly blockedCandidates: WorkerReasonCode[] = [];
    private readonly work: WorkCandidate[] = [];
    /** Manifest sources rebuilt from the retained journals once per run, before anything of this run is written. */
    private history: ManifestHistory | null = null;
    /** Verified artifacts whose indexing cannot be proven from the ledger's own evidence (no source, contradictory records). */
    private readonly ledgerEvidenceFailures = new Set<string>();
    /** Verified artifacts a manifest on the archive contradicts: the file is left as it is and the run ends visibly. */
    private readonly indexConflicts = new Set<string>();
    /** Included documents whose manifest could not be written (the refusal), and included candidates the checks blocked: both stay out of the completion. */
    private readonly manifestRefusals = new Map<string, WorkerReasonCode>();
    private readonly blockedDocuments = new Map<string, WorkerReasonCode>();
    /** Included candidates that arrived with no artifacts at all: nothing to download, so nothing to list; the completion says so. */
    private readonly emptyDocuments = new Set<string>();
    /** The completion listing of this run, before this run writes any completion. */
    private completionListing: Awaited<ReturnType<LocalDestination["listCompletions"]>> | null = null;
    /** The archive's manifest files, listed once per run: the bound-manifest existence check and the index verdicts share it. */
    private manifestListing: ManifestFile[] | null = null;
    private totalCandidates = 0;
    private includedCandidates = 0;
    /** The Google Drive destination of this run; `null` without a `drive` block or a ready binding (the run is then exactly the local one). */
    private readonly drive: DriveRunPhase | null;
    /** The archive keys (manifests, completion) this run wrote locally, and the completion it built; the Drive phase reads them (A2.6). */
    private readonly localPublished = new Set<string>();
    private localCompletion: DriveBuiltRecord | null = null;
    /** A recovered artifact's (no ledger length) manifest, validated on the archive: it stands in for the manifest-first step of its carry. */
    private readonly recoveredManifests = new Map<string, { key: string; sha256: string }>();

    constructor(
        private readonly deps: RunnerDependencies,
        private readonly archive: LocalDestination,
        private readonly staging: StagingRoot,
        private readonly scheduledFor: string | null,
    ) {
        this.dl = new DestinationLedger(deps, requireInstallation(deps));
        this.drive = DriveRunPhase.forRun(deps, this.dl.installation, archive, staging, this.driveHost());
    }

    private get state() { return this.deps.ledger.state; }
    private get companyId(): string { return this.deps.config.companyId; }
    private now(): string { return nowIso(this.deps); }
    private async fault(point: Parameters<NonNullable<RunnerDependencies["runnerFault"]>>[0]): Promise<void> {
        await this.deps.runnerFault?.(point);
    }
    private archiveLost(): void {
        this.archiveOk = false;
        this.reasons.add("archive-unavailable");
    }

    async execute(): Promise<RunSummary> {
        this.history = await readManifestHistory(this.deps.config.control.path, this.state.lastSeq, this.dl.installation);
        const check = await this.archive.checkArchive(0);
        if (!check.ok) this.archiveLost();
        this.runId = this.deps.uuid();
        await this.recoverInterrupted();
        await this.drive?.recoverInterrupted();
        await this.finishOpenRuns();
        this.startedAt = this.now();
        await this.deps.ledger.append("run_started", { runId: this.runId, scheduledFor: this.scheduledFor, startedAt: this.startedAt }, this.startedAt);
        try {
            await this.snapshotStage();
            await this.processCandidates();
            await this.drive?.processWork(this.work);
            await this.publishRecords();
        } catch (error) {
            if (!(error instanceof StageFailure)) throw error;
            this.snapshotFailure = error.reasonCode;
        }
        const summary = await this.finish();
        // Everything else has been done and recorded; the operator must still see that recovery would lose these artifacts.
        if (this.ledgerEvidenceFailures.size > 0) throw new RunEndedWithFailure("ledger-inconsistent", summary);
        if (this.indexConflicts.size > 0) throw new RunEndedWithFailure("archive-conflict", summary);
        return summary;
    }

    // ---- step 4a: crash recovery ---------------------------------------------------------------------------------

    private async recoverInterrupted(): Promise<void> {
        for (const entry of [...this.state.destinations.values()]) {
            if (entry.destinationIdentity !== this.dl.destinationIdentity || entry.destinationRevision !== this.dl.destinationRevision) continue;
            if (entry.state === "transferring" || entry.state === "verifying") await this.recoverEntry(entry);
        }
    }

    private async recoverEntry(entry: DestinationEntry): Promise<void> {
        const id = entry.artifactIdentity;
        if (!this.archiveOk) {
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey: entry.relativeKey });
            return;
        }
        const info = this.state.artifacts.get(id);
        let relativeKey = entry.relativeKey;
        if (relativeKey === null && info !== undefined) {
            try {
                relativeKey = artifactKey({ companyId: this.companyId, documentId: info.documentId, artifactType: info.artifactType, sha256: info.sha256 });
            } catch { relativeKey = null; }
        }
        let found: "ok" | "missing" | "mismatch" = "missing";
        if (relativeKey !== null && info !== undefined && info.byteLength !== null) {
            try {
                found = await this.archive.reverify(relativeKey, info.sha256, info.byteLength);
            } catch (error) {
                if (!(error instanceof WorkerError)) throw error;
                this.archiveLost();
                await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey });
                return;
            }
        }
        if (found === "ok") {
            // The file is there; before it counts as verified, recovery must be able to find it again through a manifest.
            if (!(await this.manifestFirst(id, relativeKey))) return;
            if (entry.state === "transferring") await this.dl.transition(id, "verifying", { relativeKey });
            await this.dl.transition(id, "verified", { relativeKey });
            return;
        }
        if (found === "mismatch" && relativeKey !== null) {
            if (!(await this.quarantine(relativeKey))) {
                await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey });
                return;
            }
            if (entry.state === "transferring") await this.dl.transition(id, "verifying", { relativeKey });
            await this.dl.transition(id, "integrity_error", { reasonCode: "artifact-integrity", relativeKey });
            return;
        }
        await this.dl.transition(id, "retry_wait", {
            reasonCode: "crashed", nextRetryAt: this.now(), attempts: entry.attempts + 1, relativeKey: entry.relativeKey,
        });
        await this.dl.transition(id, "pending");
    }

    /** Renames a damaged final file aside. `false` means the archive could not be used for it. */
    private async quarantine(relativeKey: string): Promise<boolean> {
        try {
            await this.archive.quarantineCorrupt(relativeKey, this.runId);
            return true;
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return false;
        }
    }

    private async finishOpenRuns(): Promise<void> {
        for (const run of [...this.state.runs.values()]) {
            if (run.status !== "open") continue;
            const at = this.now();
            await this.deps.ledger.append("run_finished", {
                runId: run.runId, finishedAt: at, snapshotStatus: "failed", historicalCoverage: judgeHistoricalCoverage(this.state),
                reasonCodes: ["crashed"], counts: { candidates: 0, included: 0, verified: 0, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0,
                    driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 },
            }, at);
        }
    }

    // ---- steps 6-7: snapshot and candidates ----------------------------------------------------------------------

    /** Retries a call that answers SNAPSHOT_NOT_READY, 5 s apart, at most 3 times (contract step 6). */
    private async stageCall<T>(call: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await call();
            } catch (error) {
                if (error instanceof StageFailure) throw error;
                if (error instanceof ExportFailure) {
                    const action = actionForExportError({ httpStatus: error.httpStatus, code: error.code, stage: "snapshot" });
                    if (action.runAction === "poll_snapshot") {
                        if (attempt >= SNAPSHOT_POLL_LIMIT) throw new StageFailure("snapshot-not-ready");
                        await this.deps.sleep(SNAPSHOT_POLL_MS);
                        continue;
                    }
                    throw new StageFailure(action.reasonCode);
                }
                if (error instanceof WorkerError && error.reasonCode === "export-response-invalid") throw new StageFailure("export-response-invalid");
                throw error;
            }
        }
    }

    private async snapshotStage(): Promise<void> {
        const client = this.deps.exportClient;
        if (client === null) throw new WorkerError("internal");
        let view: SnapshotView = await this.stageCall(() => client.createSnapshot(this.runId));
        let reads = 0;
        while (view.status === "building") {
            if (reads >= SNAPSHOT_POLL_LIMIT) throw new StageFailure("snapshot-not-ready");
            await this.deps.sleep(SNAPSHOT_POLL_MS);
            const snapshotId = view.snapshotId;
            view = await this.stageCall(() => client.getSnapshot(snapshotId));
            reads += 1;
        }
        if (view.status === "failed") throw new StageFailure("export-unavailable");

        const known = this.state.snapshots.get(view.snapshotId);
        const sequence = known !== undefined ? known.sequence : nextSnapshotSequence(this.state, await this.archiveMaxSequence());
        try {
            await this.deps.ledger.append("snapshot_bound", {
                runId: this.runId, snapshotId: view.snapshotId, sequence, scopeRevision: view.scopeRevision,
                policyRevision: view.policyRevision, counts: { ...view.counts },
            }, this.now());
        } catch (error) {
            if (error instanceof WorkerError && error.reasonCode === "ledger-schema") throw new StageFailure("export-response-invalid");
            throw error;
        }
        this.snapshotId = view.snapshotId;

        const seen = new Set<string>();
        let cursor: string | null = null;
        do {
            if (cursor !== null) {
                if (seen.has(cursor)) throw new StageFailure("export-response-invalid");
                seen.add(cursor);
            }
            const after: string | null = cursor;
            const page: CandidatePageView = await this.stageCall(() => client.listCandidates(view.snapshotId, after));
            for (const item of page.items) await this.observe(view.snapshotId, item);
            cursor = page.nextCursor;
        } while (cursor !== null);
    }

    /**
     * The archive's completion files, listed once per run. Only this run's own publishRecords writes a completion and it
     * does so after both readers (the sequence at the snapshot stage, the manifest digests in the backfill), and the
     * flock keeps any other writer out, so the first listing is still what the archive holds when the second reader asks.
     */
    private async completionFiles(): Promise<Awaited<ReturnType<LocalDestination["listCompletions"]>>> {
        this.completionListing ??= await this.archive.listCompletions(this.companyId);
        return this.completionListing;
    }

    /** Highest sequence in the names of the archive's completion files (never a clock). */
    private async archiveMaxSequence(): Promise<number> {
        if (!this.archiveOk) return 0;
        try {
            let max = 0;
            for (const file of await this.completionFiles()) {
                max = Math.max(max, parseCompletionName(file.name)?.sequence ?? 0);
            }
            return max;
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return 0;
        }
    }

    /** Recomputes every key and path from the candidate's own fields before the server's values may become either. */
    private validate(item: CandidateView): { ok: true; artifacts: ArtifactJob[] } | { ok: false; reasonCode: WorkerReasonCode } {
        const jobs: ArtifactJob[] = [];
        const kinds = new Set<string>();
        for (const artifact of item.artifacts) {
            const artifactType = toArchiveArtifactType(artifact.fileType);
            if (kinds.has(artifactType)) return { ok: false, reasonCode: "export-response-invalid" };
            kinds.add(artifactType);
            let relativeKey: string;
            try {
                relativeKey = artifactKey({ companyId: this.companyId, documentId: item.documentId, artifactType, sha256: artifact.sha256 });
            } catch {
                return { ok: false, reasonCode: "invalid-path-segment" };
            }
            if (artifact.byteSize > EXPORT_ARTIFACT_MAX_BYTES) return { ok: false, reasonCode: "artifact-too-large" };
            let expected: string;
            try {
                expected = artifactIdentity({
                    companyId: this.companyId, documentId: item.documentId, artifactKind: artifactType,
                    contentSha256: artifact.sha256, byteLength: artifact.byteSize,
                });
            } catch {
                return { ok: false, reasonCode: "export-response-invalid" };
            }
            if (expected !== artifact.artifactIdentity) return { ok: false, reasonCode: "export-response-invalid" };
            jobs.push({
                documentId: item.documentId, artifactType, fileType: artifact.fileType, artifactIdentity: artifact.artifactIdentity,
                sha256: artifact.sha256, byteLength: artifact.byteSize, relativeKey,
            });
        }
        return { ok: true, artifacts: jobs };
    }

    private async observe(snapshotId: string, item: CandidateView): Promise<void> {
        this.totalCandidates += 1;
        const included = item.classification === "included";
        if (included) this.includedCandidates += 1;
        let jobs: ArtifactJob[] = [];
        let blocked: WorkerReasonCode | null = null;
        if (included && item.artifacts.length > 0) {
            const checked = this.validate(item);
            if (checked.ok) jobs = checked.artifacts;
            else blocked = checked.reasonCode;
        }
        if (!OPAQUE_ID.test(item.documentId)) {
            // Only an included candidate can change the status; an excluded one with an unusable id is just not recorded.
            if (included) blocked = "invalid-path-segment";
        } else {
            await this.deps.ledger.append("candidate_observed", {
                snapshotId, ordinal: item.ordinal, documentId: item.documentId, classification: item.classification,
                metadataRevision: item.metadataRevision,
                artifacts: blocked === null ? jobs.map((job) => ({
                    artifactType: job.artifactType, artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength,
                })) : [],
            }, this.now());
        }
        if (blocked !== null) {
            this.blockedCandidates.push(blocked);
            this.reasons.add(blocked);
            if (included && OPAQUE_ID.test(item.documentId)) this.blockedDocuments.set(item.documentId, blocked);
        } else if (included && item.artifacts.length === 0) {
            this.emptyDocuments.add(item.documentId);
        } else if (jobs.length > 0) {
            this.work.push({ documentId: item.documentId, metadataRevision: item.metadataRevision, artifacts: jobs });
        }
    }

    // ---- step 8: artifacts ---------------------------------------------------------------------------------------

    private async processCandidates(): Promise<void> {
        for (const candidate of this.work) {
            for (const job of candidate.artifacts) await this.processArtifact(job, "snapshot");
        }
        await this.carryOver();
    }

    /**
     * Non-terminal entries (integrity_error, retry_wait, pending, blocked for a reason that is neither terminal nor
     * integrity-repeated) whose artifact is not in this snapshot: re-publish from staging or record the gap (V10).
     * A staged retry_wait that is not yet due is left as it is: processArtifact returns on it and it is picked up once due.
     */
    private async carryOver(): Promise<void> {
        const inSnapshot = new Set(this.work.flatMap((candidate) => candidate.artifacts.map((job) => job.artifactIdentity)));
        for (const entry of [...this.state.destinations.values()]) {
            if (entry.destinationIdentity !== this.dl.destinationIdentity || entry.destinationRevision !== this.dl.destinationRevision) continue;
            if (!carryable(entry) || inSnapshot.has(entry.artifactIdentity)) continue;
            const info = this.state.artifacts.get(entry.artifactIdentity);
            if (info === undefined) {
                await this.dl.transition(entry.artifactIdentity, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey: entry.relativeKey });
                continue;
            }
            let relativeKey: string;
            try {
                relativeKey = entry.relativeKey ?? artifactKey({ companyId: this.companyId, documentId: info.documentId, artifactType: info.artifactType, sha256: info.sha256 });
            } catch {
                await this.dl.transition(entry.artifactIdentity, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey: entry.relativeKey });
                continue;
            }
            // `recover` records an artifact without a length. Its length then comes from a manifest on the archive that lists it, never a guess.
            const lookup = info.byteLength === null ? await this.recoveredManifestFor(entry.artifactIdentity, info, relativeKey) : null;
            if (lookup !== null && lookup.status === "archive-unavailable") {
                // A temporary archive outage is not proof that no manifest exists: stay retryable (never the terminal exact-bytes-unavailable).
                await this.dl.transition(entry.artifactIdentity, "blocked", { reasonCode: "archive-unavailable", relativeKey });
                continue;
            }
            const recovered = lookup !== null && lookup.status === "found" ? lookup : null;
            const byteLength = info.byteLength ?? recovered?.byteLength ?? null;
            if (byteLength === null) {
                await this.dl.transition(entry.artifactIdentity, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey });
                continue;
            }
            const job: ArtifactJob = {
                documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
                artifactIdentity: entry.artifactIdentity, sha256: info.sha256, byteLength, relativeKey,
            };
            if (entry.state === "integrity_error" && integrityRetryDecision(integrityErrorCount(entry)).to === "blocked") {
                await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: "integrity-repeated", relativeKey });
            } else if (recovered === null ? await this.stagedUsable(job) || await this.healFromDrive(job) : await this.recoveredBytesStaged(job)) {
                if (recovered !== null) this.recoveredManifests.set(job.artifactIdentity, { key: recovered.key, sha256: recovered.sha256 });
                await this.processArtifact(job, "carry");
            } else if (!this.archiveOk) {
                // The archive is down, so the verified Drive copy cannot be used (or went away while it was being staged): retry later, never terminal.
                await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: "archive-unavailable", relativeKey });
            } else {
                await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey });
            }
        }
    }

    /**
     * The archive manifest that proves a recovered artifact's length: one that parses as a manifest of its document, is not contradicted by
     * the ledger's or a valid completion's digest for its key, and lists this artifact with the recorded sha256, type and key. All such
     * manifests must agree on one length; none, or a disagreement, is `none` (nothing is built or guessed). An archive that is not available
     * (before the lookup, or lost during it) is `archive-unavailable`, not `none`: it says nothing about the manifests. Listed afresh: the
     * run's shared listing is taken later, after this run's own manifests exist.
     */
    private async recoveredManifestFor(
        artifactIdentity: string, info: { documentId: string; artifactType: ArchiveArtifactType; sha256: string }, relativeKey: string,
    ): Promise<{ status: "found"; key: string; sha256: string; byteLength: number } | { status: "none" } | { status: "archive-unavailable" }> {
        if (!this.archiveOk) return { status: "archive-unavailable" };
        const found: Array<{ key: string; sha256: string; byteLength: number }> = [];
        try {
            const completions = await this.completionDigests();
            for (const file of (await listManifestFiles(this.deps.config.archive.path, this.companyId)).filter((candidate) => candidate.documentId === info.documentId)) {
                let bytes: Buffer | null;
                try {
                    bytes = await this.archive.readArchiveFile(file.key);
                } catch (error) {
                    if (error instanceof WorkerError && !isArchiveSide(error.reasonCode)) continue; // not a readable manifest: it lists nothing
                    throw error;
                }
                if (bytes === null) continue;
                let parsed: { manifest: Manifest; sha256: string };
                try {
                    parsed = parseManifestBytes(bytes, file.key, { companyId: this.companyId, documentId: file.documentId, metadataRevision: file.metadataRevision });
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    continue;
                }
                const acknowledged = this.state.manifests.get(file.key);
                if ((acknowledged !== undefined && acknowledged.sha256 !== parsed.sha256)
                    || [...(completions.get(file.key) ?? [])].some((expected) => expected !== parsed.sha256)) continue;
                for (const artifact of parsed.manifest.artifacts) {
                    if (artifact.artifactIdentity !== artifactIdentity || artifact.sha256 !== info.sha256 || artifact.artifactType !== info.artifactType) continue;
                    let derived: string;
                    try {
                        derived = artifactKey({ companyId: this.companyId, documentId: info.documentId, artifactType: artifact.artifactType, sha256: artifact.sha256 });
                    } catch {
                        continue;
                    }
                    if (derived === relativeKey) found.push({ key: file.key, sha256: parsed.sha256, byteLength: artifact.byteLength });
                }
            }
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return { status: "archive-unavailable" };
        }
        if (found.length === 0 || new Set(found.map((candidate) => candidate.byteLength)).size !== 1) return { status: "none" };
        return { status: "found", ...found[0]! };
    }

    /**
     * A recovered artifact's bytes, staged, with the length its archive manifest names: a staged copy on record that hashes to the artifact
     * (one that does not is set aside), else the verified Drive copy, which `restage` proves again by hash and size.
     */
    private async recoveredBytesStaged(job: ArtifactJob): Promise<boolean> {
        if (await this.stagedUsable(job)) {
            if (await this.stagedHashes(job)) return true;
            await this.setStagingAside(job);
        }
        return this.healFromDrive(job);
    }

    private async stagedHashes(job: ArtifactJob): Promise<boolean> {
        const hash = createHash("sha256");
        let seen = 0;
        for await (const chunk of this.archive.openStaged(this.staging, job.artifactIdentity)) {
            hash.update(chunk);
            seen += chunk.byteLength;
        }
        return seen === job.byteLength && hash.digest("hex") === job.sha256;
    }

    private async stagedUsable(job: ArtifactJob): Promise<boolean> {
        const staged = this.state.staged.get(job.artifactIdentity);
        if (staged === undefined || staged.sha256 !== job.sha256 || staged.byteLength !== job.byteLength) return false;
        try {
            const stat = await fs.lstat(`${this.staging.path}/${job.artifactIdentity}.bin`);
            return stat.isFile() && stat.size === job.byteLength;
        } catch {
            return false;
        }
    }

    private async ensurePending(job: ArtifactJob): Promise<void> {
        if (this.dl.entryOf(job.artifactIdentity)?.state !== "pending") await this.dl.transition(job.artifactIdentity, "pending");
    }

    private async processArtifact(job: ArtifactJob, mode: "snapshot" | "carry"): Promise<void> {
        const id = job.artifactIdentity;
        if (this.state.terminalUnavailable.has(id)) return;
        let entry = this.dl.entryOf(id);
        if (entry?.state === "verified") {
            await this.reuseVerified(job, entry);
            entry = this.dl.entryOf(id);
            if (entry?.state === "verified") return;
        }
        const state = entry?.state ?? null;
        if (entry !== undefined && state === "retry_wait" && Date.parse(entry.nextRetryAt ?? "") > this.deps.clock.now().getTime()) return;
        if (entry !== undefined && state === "integrity_error"
            && integrityRetryDecision(integrityErrorCount(entry)).to === "blocked") {
            await this.dl.transition(id, "blocked", { reasonCode: "integrity-repeated", relativeKey: job.relativeKey });
            return;
        }
        let staged = await this.stagedUsable(job);
        if (entry !== undefined && state === "blocked" && !(await this.blockedMayRetry(entry, job, staged))) return;
        if (state === "transferring" || state === "verifying") return;
        // V10: a copy Drive holds verified is staged again before anything is downloaded or given up.
        if (!staged) staged = await this.healFromDrive(job);

        if (!staged) {
            if (mode === "carry" || this.stopDownloads) return;
            if (!(await controlHasStagingRoom(this.deps, job.byteLength))) {
                if (!this.archiveOk) {
                    this.reasons.add("archive-unavailable");
                    return;
                }
                await this.ensurePending(job);
                await this.dl.transition(id, "blocked", { reasonCode: "control-space" });
                this.reasons.add("control-space");
                return;
            }
        } else if (!this.archiveOk) {
            await this.ensurePending(job);
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable" });
            return;
        }

        // A carried artifact is no longer in any snapshot, so no later run writes its manifest: it goes first.
        if (mode === "carry" && !(await this.manifestFirst(id, job.relativeKey))) return;
        if ((await this.transfer(job, !staged)) !== "staging-corrupt") return;
        // The staged copy did not match its own hash: it is set aside, so this artifact is now simply not staged.
        if (mode === "carry") {
            await this.dl.transition(id, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey: job.relativeKey });
            return;
        }
        if (this.stopDownloads || !(await controlHasStagingRoom(this.deps, job.byteLength))) return;
        await this.transfer(job, true);
    }

    /** pending -> transferring -> (download) -> publish. `staging-corrupt`: the staged bytes failed their hash, the artifact waits in retry_wait. */
    private async transfer(job: ArtifactJob, needDownload: boolean): Promise<"done" | "stopped" | "staging-corrupt"> {
        await assertLedgerRoom(this.deps);
        await this.ensurePending(job);
        await this.dl.transition(job.artifactIdentity, "transferring", { relativeKey: job.relativeKey });
        await this.fault("after-transferring");
        if (needDownload && !(await this.download(job))) return "stopped";
        return this.publish(job);
    }

    /**
     * Renames a staged file aside as `<id>.bin.corrupt-<runId>[-n]` in the same directory. Never removes it and never
     * replaces an earlier one; the operator decides when it goes (README).
     */
    private async setStagingAside(job: ArtifactJob): Promise<void> {
        const source = `${this.staging.path}/${job.artifactIdentity}.bin`;
        let target = `${source}.corrupt-${this.runId}`;
        for (let n = 2; await fs.lstat(target).then(() => true, () => false); n++) target = `${source}.corrupt-${this.runId}-${n}`;
        try {
            await fs.rename(source, target);
            const dir = await fs.open(this.staging.path, "r");
            try { await dir.sync(); } finally { await dir.close(); }
        } catch (error) {
            if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
            throw new WorkerError("control-unavailable");
        }
    }

    private async blockedMayRetry(entry: DestinationEntry, job: ArtifactJob, staged: boolean): Promise<boolean> {
        const code = entry.reasonCode;
        if (code === "integrity-repeated" || code === "source-removed") return false;
        if (code === "archive-unavailable" && !this.archiveOk) return false;
        if (code === "control-space" && !staged && !(await controlHasStagingRoom(this.deps, job.byteLength))) return false;
        return true;
    }

    /** A verified entry is only reused after the file is found again with the right hash (contract step 8). */
    private async reuseVerified(job: ArtifactJob, entry: DestinationEntry): Promise<void> {
        if (!this.archiveOk) return;
        const relativeKey = entry.relativeKey ?? job.relativeKey;
        let found: "ok" | "missing" | "mismatch";
        try {
            found = await this.archive.reverify(relativeKey, job.sha256, job.byteLength);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return;
        }
        if (found === "ok") return;
        if (found === "mismatch" && !(await this.quarantine(relativeKey))) return;
        await this.dl.transition(job.artifactIdentity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey });
    }

    private input(job: ArtifactJob) {
        return {
            companyId: this.companyId, documentId: job.documentId, artifactType: job.artifactType, sha256: job.sha256,
            byteLength: job.byteLength, artifactIdentity: job.artifactIdentity,
        };
    }

    /** Downloads into staging. `false` when the artifact ended in another state (the caller stops with it). */
    private async download(job: ArtifactJob): Promise<boolean> {
        const client = this.deps.exportClient;
        if (client === null || this.snapshotId === null) throw new WorkerError("internal");
        // A staged file that is not usable (wrong size, or no record of it) would make the staging name conflict.
        const leftover = await fs.lstat(`${this.staging.path}/${job.artifactIdentity}.bin`).catch(() => null);
        if (leftover !== null && (!leftover.isFile() || leftover.size !== job.byteLength)) await this.setStagingAside(job);
        let staged: Awaited<ReturnType<LocalDestination["stageArtifact"]>> | null = null;
        for (let attempt = 0; staged === null || (!staged.ok && staged.reasonCode === "archive-conflict" && attempt < 2); attempt++) {
            if (staged !== null) await this.setStagingAside(job); // same size, other bytes: set aside and ask once more
            let stream: AsyncIterable<Uint8Array>;
            try {
                stream = await client.openArtifact(this.snapshotId, { artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength });
            } catch (error) {
                await this.onDownloadError(job, error);
                return false;
            }
            staged = await this.archive.stageArtifact(this.staging, this.input(job), stream);
        }
        if (staged === null || !staged.ok) {
            if (staged === null) throw new WorkerError("internal");
            await this.onStageFailure(job, staged.reasonCode);
            return false;
        }
        await this.fault("after-staged-before-staging_verified");
        await this.deps.ledger.append("staging_verified", { artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength }, this.now());
        this.transientStreak = 0;
        return true;
    }

    private async onDownloadError(job: ArtifactJob, error: unknown): Promise<void> {
        if (error instanceof ExportFailure) {
            await this.applyAction(job, actionForExportError({ httpStatus: error.httpStatus, code: error.code, stage: "download" }), error.retryAfterSeconds);
            return;
        }
        if (error instanceof WorkerError) {
            await this.onStageFailure(job, error.reasonCode);
            return;
        }
        throw new WorkerError("internal");
    }

    private async onStageFailure(job: ArtifactJob, code: WorkerReasonCode): Promise<void> {
        if (code === "network-timeout") {
            await this.applyAction(job, actionForExportError({ httpStatus: 0, code: "NETWORK" }), null);
        } else if (code === "artifact-integrity" || code === "pdf-shape") {
            await this.recordIntegrityError(job);
        } else if (code === "control-unavailable" || code === "control-space") {
            throw new WorkerError(code);
        } else {
            await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: code, relativeKey: job.relativeKey });
        }
    }

    /** U1: a download that does not match is recorded `transferring -> verifying -> integrity_error` (the table allows it only from verifying). */
    private async recordIntegrityError(job: ArtifactJob): Promise<void> {
        const id = job.artifactIdentity;
        if (this.dl.entryOf(id)?.state === "transferring") await this.dl.transition(id, "verifying", { relativeKey: job.relativeKey });
        await this.dl.transition(id, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: job.relativeKey });
    }

    private async park(job: ArtifactJob, reasonCode: WorkerReasonCode, retryAfterSeconds: number | null, immediate: boolean): Promise<void> {
        const attempts = (this.dl.entryOf(job.artifactIdentity)?.attempts ?? 0) + 1;
        const due = immediate ? this.now() : nextRetryAt(this.deps.clock.now(), attempts, retryAfterSeconds);
        await this.dl.transition(job.artifactIdentity, "retry_wait", { reasonCode, nextRetryAt: due, attempts, relativeKey: job.relativeKey });
    }

    private async applyAction(job: ArtifactJob, action: ExportAction, retryAfterSeconds: number | null): Promise<void> {
        const id = job.artifactIdentity;
        switch (action.destinationAction) {
            case "retry_wait":
                await this.park(job, action.reasonCode, retryAfterSeconds, false);
                break;
            case "blocked":
                await this.dl.transition(id, "blocked", { reasonCode: action.reasonCode, relativeKey: job.relativeKey });
                break;
            case "terminal_unless_held":
                await this.dl.transition(id, "blocked", { reasonCode: "source-removed", relativeKey: job.relativeKey });
                break;
            case "integrity_error":
                await this.recordIntegrityError(job);
                break;
            case "unchanged":
                // Nothing is wrong with the artifact; it goes back to the queue, due again at once.
                await this.park(job, action.reasonCode, null, true);
                break;
        }
        switch (action.runAction) {
            case "stop_downloads":
                this.stopDownloads = true;
                this.reasons.add(action.reasonCode);
                break;
            case "stop_downloads_after_3_consecutive":
                this.transientStreak += 1;
                if (this.transientStreak >= TRANSIENT_STOP) this.stopDownloads = true;
                break;
            case "fail_run":
                this.snapshotFailure ??= action.reasonCode;
                this.stopDownloads = true;
                break;
            case "block_run":
                this.blockRun ??= action.reasonCode;
                this.stopDownloads = true;
                break;
            default:
                break;
        }
    }

    private async publish(job: ArtifactJob): Promise<"done" | "staging-corrupt"> {
        const id = job.artifactIdentity;
        if (!this.archiveOk) {
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey: job.relativeKey });
            return "done";
        }
        const result = await this.archive.publishArtifact(this.input(job), this.archive.openStaged(this.staging, id));
        if (!result.ok) return this.onPublishFailure(job, result.reasonCode);
        const relativeKey = result.relativeKey;
        await this.fault("after-publish-before-verifying");
        await this.dl.transition(id, "verifying", { relativeKey });
        let found: "ok" | "missing" | "mismatch";
        try {
            found = await this.archive.reverify(relativeKey, job.sha256, job.byteLength);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey });
            return "done";
        }
        if (found === "ok") {
            await this.fault("after-verifying-before-verified");
            await this.dl.transition(id, "verified", { relativeKey });
            await this.fault("after-verified");
            return "done";
        }
        if (found === "mismatch") await this.quarantine(relativeKey);
        await this.dl.transition(id, "integrity_error", { reasonCode: "artifact-integrity", relativeKey });
        return "done";
    }

    private async onPublishFailure(job: ArtifactJob, code: WorkerReasonCode): Promise<"done" | "staging-corrupt"> {
        const id = job.artifactIdentity;
        if (isArchiveSide(code)) {
            this.archiveLost();
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey: job.relativeKey });
        } else if (code === "artifact-integrity" || code === "pdf-shape") {
            // The source of a publish is the staged copy, which was verified when it was written: if it no longer
            // matches, the damage is local. It is set aside and does not count against the export's integrity budget.
            await this.setStagingAside(job);
            await this.park(job, "artifact-integrity", null, true);
            return "staging-corrupt";
        } else if (code === "archive-conflict") {
            // Other bytes already sit at the final name: move them aside, never overwrite, and let the next run publish again.
            await this.quarantine(job.relativeKey);
            await this.recordIntegrityError(job);
        } else if (code === "control-unavailable" || code === "control-space") {
            throw new WorkerError(code);
        } else {
            await this.dl.transition(id, "blocked", { reasonCode: code, relativeKey: job.relativeKey });
        }
        return "done";
    }

    // ---- Google Drive seams (BJJ-456) ------------------------------------------------------------------------------

    /** V10: the artifact's staged bytes are gone and Drive holds it verified: stage it again from there, before downloading. */
    private async healFromDrive(job: ArtifactJob): Promise<boolean> {
        return this.drive !== null && this.archiveOk && this.drive.driveVerified(job.artifactIdentity) && await this.drive.restageFromDrive(job);
    }

    /**
     * Stages `source` as the artifact's staged copy through the checks every staged file gets (hash, size, PDF shape), for a copy that
     * comes from the other destination instead of the export. A control failure is thrown; any other failure is the reason it returns.
     */
    private async restage(job: ArtifactJob, source: AsyncIterable<Uint8Array>): Promise<{ ok: true } | { ok: false; reasonCode: WorkerReasonCode }> {
        if (!(await controlHasStagingRoom(this.deps, job.byteLength))) return { ok: false, reasonCode: "control-space" };
        // A staged file that is still there is not usable (otherwise nothing would be staged again): it would make the name conflict.
        const leftover = await fs.lstat(`${this.staging.path}/${job.artifactIdentity}.bin`).catch(() => null);
        if (leftover !== null) await this.setStagingAside(job);
        const staged = await this.archive.stageArtifact(this.staging, this.input(job), source);
        if (!staged.ok) {
            if (staged.reasonCode === "control-unavailable" || staged.reasonCode === "control-space") throw new WorkerError(staged.reasonCode);
            return { ok: false, reasonCode: staged.reasonCode };
        }
        await this.deps.ledger.append("staging_verified", { artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength }, this.now());
        return { ok: true };
    }

    private driveHost(): DriveRunHost {
        return {
            archiveOk: () => this.archiveOk,
            archiveLost: () => this.archiveLost(),
            manifestOf: (candidate) => {
                const { manifest, key } = this.manifestOf(candidate);
                return { key, bytes: manifest.bytes, sha256: manifest.sha256 };
            },
            stagedUsable: (job) => this.stagedUsable(job),
            setStagingAside: (job) => this.setStagingAside(job),
            restage: (job, source) => this.restage(job, source),
            locallyPublished: (relativeKey) => this.localPublished.has(relativeKey),
            localCompletion: () => this.localCompletion,
            completionContext: (): DriveCompletionContext | null => {
                const binding = this.snapshotId === null ? undefined : this.state.snapshots.get(this.snapshotId);
                if (binding === undefined) return null;
                return {
                    companyId: this.companyId, runId: this.runId, sequence: binding.sequence, snapshotId: binding.snapshotId,
                    scopeRevision: binding.scopeRevision, policyRevision: binding.policyRevision,
                    localIdentity: this.dl.destinationIdentity, localRevision: this.dl.destinationRevision,
                    stateGaps: this.state.gaps.map((gap) => ({ documentId: gap.documentId, reasonCode: gap.reasonCode })),
                    blockedDocuments: this.blockedDocuments, emptyDocuments: this.emptyDocuments,
                };
            },
        };
    }

    // ---- steps 9-10: manifests and the completion ------------------------------------------------------------------

    /** The manifest of one observed artifact set and the content-versioned key it is published under. */
    private manifestOf(source: ManifestSource): { manifest: ReturnType<typeof buildManifest>; key: string } {
        const manifest = buildManifest({
            companyId: this.companyId, documentId: source.documentId, metadataRevision: source.metadataRevision,
            artifacts: source.artifacts.map((artifact) => ({
                artifactType: artifact.artifactType, artifactIdentity: artifact.artifactIdentity, sha256: artifact.sha256, byteLength: artifact.byteLength,
            })),
        });
        const key = manifestKey({
            companyId: this.companyId, documentId: source.documentId, metadataRevision: source.metadataRevision, manifestSha256: manifest.sha256,
        });
        return { manifest, key };
    }

    /**
     * Builds and publishes (no-clobber, idempotent: an identical file is accepted) the manifest of one observed artifact
     * set. The name carries the manifest's own digest, so a later snapshot that advertises other bytes under the same
     * metadata revision gets a file of its own instead of colliding with this one.
     */
    private async writeManifest(source: ManifestSource): Promise<{ ok: true; key: string; sha256: string } | { ok: false; reasonCode: WorkerReasonCode }> {
        const { manifest, key } = this.manifestOf(source);
        const published = await this.archive.publishJson(key, manifest.bytes);
        return published.ok ? { ok: true, key, sha256: manifest.sha256 } : { ok: false, reasonCode: published.reasonCode };
    }

    /** An archive-side refusal marks the archive lost; any other is recorded against the run. */
    private refuseManifest(reasonCode: WorkerReasonCode): void {
        if (isArchiveSide(reasonCode)) this.archiveLost();
        else {
            this.blockedCandidates.push(reasonCode);
            this.reasons.add(reasonCode);
        }
    }

    private async recordManifest(written: { key: string; sha256: string }): Promise<void> {
        this.localPublished.add(written.key);
        if (!this.state.manifests.has(written.key)) {
            await this.deps.ledger.append("manifest_published", { relativeKey: written.key, sha256: written.sha256 }, this.now());
        }
    }

    /**
     * The source of the manifest an artifact belongs to: the latest revision the ledger ever observed it in, checked
     * against what the state holds for it. History that is unreadable, broken, in conflict, or silent about an artifact the
     * ledger has a destination entry for is a ledger failure; nothing is guessed, and no bytes are published on it.
     */
    private manifestSourceFor(artifactIdentity: string): ManifestSource {
        const found = this.history?.find(artifactIdentity) ?? "invalid";
        if (found === "invalid" || found === null) throw new WorkerError("ledger-inconsistent");
        const info = this.state.artifacts.get(artifactIdentity);
        const artifact = found.artifacts.find((candidate) => candidate.artifactIdentity === artifactIdentity);
        if (info === undefined || artifact === undefined || info.documentId !== found.documentId || info.artifactType !== artifact.artifactType
            || info.sha256 !== artifact.sha256 || info.byteLength !== artifact.byteLength) throw new WorkerError("ledger-inconsistent");
        return found;
    }

    /**
     * Manifest before bytes: the manifest of the artifact's document revision (the whole artifact set it was observed
     * with, siblings or not) is on the archive and recorded before the artifact is published or promoted to verified. If
     * it cannot be written the artifact is blocked and nothing is published for it. `false`: the caller stops.
     */
    private async manifestFirst(artifactIdentity: string, relativeKey: string | null): Promise<boolean> {
        // A recovered artifact has no observed source: the manifest already on the archive, validated, is the one that lists it.
        const recovered = this.recoveredManifests.get(artifactIdentity);
        if (recovered !== undefined) {
            await this.fault("after-manifest-first-before-record");
            await this.recordManifest(recovered);
            return true;
        }
        const source = this.manifestSourceFor(artifactIdentity);
        const written = await this.writeManifest(source);
        if (!written.ok) {
            this.refuseManifest(written.reasonCode);
            const reasonCode = isArchiveSide(written.reasonCode) ? "archive-unavailable" : written.reasonCode;
            await this.dl.transition(artifactIdentity, "blocked", { reasonCode, relativeKey });
            return false;
        }
        await this.fault("after-manifest-first-before-record");
        await this.recordManifest(written);
        return true;
    }

    private failLedgerEvidence(artifactIdentity: string): void {
        this.ledgerEvidenceFailures.add(artifactIdentity);
        this.reasons.add("ledger-inconsistent");
    }

    /** `subject`: the artifact identity a verdict is about, or the key of a bound manifest file that is damaged. */
    private failIndexConflict(subject: string): void {
        this.indexConflicts.add(subject);
        this.reasons.add("archive-conflict");
    }

    /** Raw-manifest digests that valid completions bind to each manifest key, read with recovery's own rules. */
    private async completionDigests(): Promise<Map<string, Set<string>>> {
        return completionBindings(await this.completionFiles(), this.companyId);
    }

    /** The one manifest listing of the run. Taken after this run's own manifests were written, so they are in it. */
    private async manifestFiles(): Promise<ManifestFile[]> {
        this.manifestListing ??= await listManifestFiles(this.deps.config.archive.path, this.companyId);
        return this.manifestListing;
    }

    /**
     * Whether a manifest file, as a whole, is what the evidence says it must be. `bad`: another file than the evidence
     * establishes. `unproven`: the evidence contradicts itself, so nothing can be established. The file is matched to
     * the artifact set it was built from by its digest: this snapshot's candidate or any set the retained journals saw for
     * exactly this revision, never "the latest" source.
     */
    private manifestLevel(key: string, manifest: Manifest, digest: string, completions: Map<string, Set<string>>): "ok" | "bad" | "unproven" | "variant" {
        const named = completions.get(key);
        if (named !== undefined && [...named].some((expected) => expected !== digest)) return "bad";
        const builtDigest = (source: ManifestSource): string => this.manifestOf(source).manifest.sha256;
        const current = this.work.find((candidate) => candidate.documentId === manifest.documentId && candidate.metadataRevision === manifest.metadataRevision);
        const observed = this.history?.forRevision(manifest.documentId, manifest.metadataRevision) ?? "unavailable";
        const currentMatch = current !== undefined && builtDigest(current) === digest;
        if (observed === "conflict" && !currentMatch) return "unproven";
        const variants = observed === "unavailable" || observed === "conflict" ? [] : observed;
        const matched = currentMatch || variants.some((variant) => builtDigest(variant) === digest);
        const acknowledged = this.state.manifests.get(key);
        if (acknowledged !== undefined && acknowledged.sha256 !== digest) return matched ? "unproven" : "bad";
        if (matched) return "ok";
        if (acknowledged !== undefined && (current !== undefined || variants.length > 0)) return "unproven";
        // Not the current candidate's file and not a set the retained journals saw: another variant, e.g. one published before an
        // archive-only recovery. It is no contradiction of the current candidate (only the file whose digest it is can be compared
        // with it); the retained evidence for its artifacts decides (variantLevel). A legacy name carries no digest, so it is
        // judged the same way, by the digest of its raw bytes.
        return "variant";
    }

    /**
     * A variant no retained observation matches is `bad` when any artifact the ledger knows contradicts it (digest, type,
     * keys, identity, length), whether or not that artifact is one the caller wants; artifacts the ledger never saw (an
     * audit trail that was gone at the source) neither confirm nor contradict it.
     */
    private async variantLevel(manifest: Manifest, sizes: Map<string, number | null>): Promise<"ok" | "bad"> {
        for (const artifact of manifest.artifacts) {
            // Never skipped, whatever the ledger knows: an identity its own claims do not derive is false (the shared validator
            // already refuses such a file; this keeps the variant judgement sound on its own).
            if (!artifactIdentityDerives(this.companyId, manifest.documentId, artifact)) return "bad";
            if (!this.state.artifacts.has(artifact.artifactIdentity)) continue;
            if (await this.artifactFacts(manifest, artifact, sizes) === "bad") return "bad";
        }
        return "ok";
    }

    /** One artifact entry of a manifest against what the ledger retained for it. Length comes from the ledger, else from the stored file's size. */
    private async artifactFacts(
        manifest: Manifest, artifact: Manifest["artifacts"][number], sizes: Map<string, number | null>,
    ): Promise<"ok" | "bad" | "unproven"> {
        const info = this.state.artifacts.get(artifact.artifactIdentity);
        if (info === undefined) return "unproven";
        if (info.documentId !== manifest.documentId || info.artifactType !== artifact.artifactType || info.sha256 !== artifact.sha256) return "bad";
        try {
            const derived = artifactKey({ companyId: this.companyId, documentId: manifest.documentId, artifactType: artifact.artifactType, sha256: artifact.sha256 });
            if (artifact.relativeKey !== derived) return "bad";
            const recorded = this.dl.entryOf(artifact.artifactIdentity)?.relativeKey ?? null;
            if (recorded !== null && recorded !== artifact.relativeKey) return "bad";
            // The length is not part of the identity; recomputing it only rejects an identity moved between claims.
            const identity = artifactIdentity({
                companyId: this.companyId, documentId: manifest.documentId, artifactKind: artifact.artifactType,
                contentSha256: artifact.sha256, byteLength: artifact.byteLength,
            });
            if (identity !== artifact.artifactIdentity) return "bad";
        } catch {
            return "bad";
        }
        if (info.byteLength !== null) return info.byteLength === artifact.byteLength ? "ok" : "bad";
        let size = sizes.get(artifact.relativeKey);
        if (size === undefined) {
            size = await this.archive.artifactSize(artifact.relativeKey);
            sizes.set(artifact.relativeKey, size);
        }
        if (size === null) return "unproven";
        return size === artifact.byteLength ? "ok" : "bad";
    }

    /**
     * What the archive's own manifests say about each of the wanted artifacts: a verdict per identity over every manifest
     * of the given documents that lists it. A single contradicting listing is enough to lose the artifact in recovery
     * (it meets the first listing and does not look at the next), so `bad` outweighs `ok`. `null`: the archive is lost.
     */
    private async indexVerdicts(
        documents: ReadonlySet<string>, wanted: ReadonlySet<string>, invalidDocuments: Set<string>,
    ): Promise<Map<string, { ok: boolean; bad: boolean; unproven: boolean }> | null> {
        const verdicts = new Map<string, { ok: boolean; bad: boolean; unproven: boolean }>();
        const note = (identity: string, verdict: "ok" | "bad" | "unproven"): void => {
            const known = verdicts.get(identity) ?? { ok: false, bad: false, unproven: false };
            if (verdict === "ok") known.ok = true;
            else if (verdict === "bad") known.bad = true;
            else known.unproven = true;
            verdicts.set(identity, known);
        };
        const sizes = new Map<string, number | null>();
        try {
            const completions = await this.completionDigests();
            /**
             * A file the ledger acknowledged or a valid completion names is bound: damage to it is a conflict of its own, whatever
             * other manifest covers its artifacts. An invalid file nobody bound lists nothing (valid coverage is enough).
             */
            const bound = (key: string): boolean => this.state.manifests.has(key) || completions.has(key);
            const contradicts = (key: string, sha256: string): boolean => {
                const acknowledged = this.state.manifests.get(key);
                return (acknowledged !== undefined && acknowledged.sha256 !== sha256)
                    || [...(completions.get(key) ?? [])].some((expected) => expected !== sha256);
            };
            const files: ManifestFile[] = (await this.manifestFiles()).filter((file) => documents.has(file.documentId));
            for (const file of files) {
                let bytes: Buffer | null;
                try {
                    bytes = await this.archive.readArchiveFile(file.key);
                } catch (error) {
                    if (error instanceof WorkerError && !isArchiveSide(error.reasonCode)) { // not a readable manifest: it lists nothing
                        invalidDocuments.add(file.documentId);
                        if (bound(file.key)) this.failIndexConflict(file.key);
                        continue;
                    }
                    throw error;
                }
                if (bytes === null) continue;
                // A file recovery would refuse to read lists nothing and shadows nothing, but it is not a manifest of this document either.
                let parsed: { manifest: Manifest; sha256: string };
                try {
                    parsed = parseManifestBytes(bytes, file.key, { companyId: this.companyId, documentId: file.documentId, metadataRevision: file.metadataRevision });
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    invalidDocuments.add(file.documentId);
                    if (bound(file.key)) this.failIndexConflict(file.key);
                    continue;
                }
                if (contradicts(file.key, parsed.sha256)) this.failIndexConflict(file.key);
                const judged = this.manifestLevel(file.key, parsed.manifest, parsed.sha256, completions);
                const level = judged === "variant" ? await this.variantLevel(parsed.manifest, sizes) : judged;
                for (const artifact of parsed.manifest.artifacts) {
                    if (!wanted.has(artifact.artifactIdentity)) continue;
                    note(artifact.artifactIdentity, level === "ok" ? await this.artifactFacts(parsed.manifest, artifact, sizes) : level);
                }
            }
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return null;
        }
        return verdicts;
    }

    /**
     * A manifest the ledger acknowledged or a valid completion names is bound: it must still be on the archive. The check
     * is the existence of its name in the run's one manifest listing (no read of any manifest, whichever documents are in
     * this snapshot). A missing one is republished at its own key when its exact bytes can be rebuilt (this snapshot's
     * candidate, or a set the retained journals saw for exactly its revision, whose manifest digest is the bound digest);
     * otherwise nothing is written and the run ends in `archive-conflict` after the independent work. Bytes are never
     * invented and no completion is repointed. Damage to a bound manifest that is present is `verify --all`'s to report.
     */
    private async republishMissingBound(): Promise<void> {
        if (!this.archiveOk) return;
        const bound = new Map<string, Set<string>>();
        const bind = (key: string, sha256: string): void => {
            bound.set(key, (bound.get(key) ?? new Set<string>()).add(sha256));
        };
        let present: Set<string>;
        try {
            for (const [key, acknowledged] of this.state.manifests) bind(key, acknowledged.sha256);
            for (const [key, digests] of await this.completionDigests()) for (const sha256 of digests) bind(key, sha256);
            present = new Set((await this.manifestFiles()).map((file) => file.key));
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.archiveLost();
            return;
        }
        for (const [key, digests] of bound) {
            if (!this.archiveOk) break;
            if (present.has(key)) continue;
            const parts = parseManifestKey(key);
            if (parts === null || parts.companyId !== this.companyId) continue;
            const bytes = digests.size === 1 ? this.rebuiltBytes(key, parts, [...digests][0]!) : null;
            if (bytes === null) {
                this.failIndexConflict(key);
                continue;
            }
            // An additive write the ledger does not make itself: held to the same ownership check, so a stale owner stops here.
            await this.deps.ledger.guardExternalWrite();
            const published = await this.archive.publishJson(key, bytes);
            if (!published.ok) {
                this.refuseManifest(published.reasonCode);
                if (!isArchiveSide(published.reasonCode)) this.failIndexConflict(key);
                continue;
            }
            await this.recordManifest({ key, sha256: [...digests][0]! });
        }
    }

    /** The bytes of a bound manifest, from a source whose manifest has exactly the bound digest; `null` when none does. */
    private rebuiltBytes(key: string, parts: { documentId: string; metadataRevision: string; manifestSha256: string | null }, digest: string): Uint8Array | null {
        const current = this.work.find((candidate) => candidate.documentId === parts.documentId && candidate.metadataRevision === parts.metadataRevision);
        const observed = this.history?.forRevision(parts.documentId, parts.metadataRevision) ?? "unavailable";
        const sources = [...(current === undefined ? [] : [current]), ...(Array.isArray(observed) ? observed : [])];
        for (const source of sources) {
            const built = this.manifestOf(source);
            // A legacy name carries no digest; a content-versioned one is exactly the key this source would be published under.
            if (built.manifest.sha256 === digest && (parts.manifestSha256 === null || built.key === key)) return built.manifest.bytes;
        }
        return null;
    }

    /**
     * Every verified artifact outside this run's published manifests must be listed by manifests that really are on the
     * archive and agree with the ledger's evidence (bytes, digest, length, owner, keys): the files are read, the ledger's
     * word for them is not enough. One that no manifest lists gets one again, built from this run's candidate or the
     * history of exactly its revision, and published idempotently. The destination entries are never touched. Anything
     * that cannot be proven or contradicts the archive does not stop the other work; the run ends afterwards with
     * `ledger-inconsistent` (evidence missing) or `archive-conflict` (a file contradicts it), and the files stay as they are.
     */
    private async backfillManifests(publishedNow: ReadonlySet<string>): Promise<void> {
        if (!this.archiveOk) return;
        const outside: Array<{ id: string; documentId: string }> = [];
        for (const entry of this.state.destinations.values()) {
            if (entry.destinationIdentity !== this.dl.destinationIdentity || entry.destinationRevision !== this.dl.destinationRevision) continue;
            if (entry.state !== "verified" || publishedNow.has(entry.artifactIdentity)) continue;
            const info = this.state.artifacts.get(entry.artifactIdentity);
            if (info === undefined) this.failLedgerEvidence(entry.artifactIdentity);
            else outside.push({ id: entry.artifactIdentity, documentId: info.documentId });
        }
        if (outside.length === 0) return;
        const invalidDocuments = new Set<string>();
        const verdicts = await this.indexVerdicts(new Set(outside.map((artifact) => artifact.documentId)), new Set(outside.map((artifact) => artifact.id)), invalidDocuments);
        if (verdicts === null) return;
        const attempts = new Map<string, boolean>();
        for (const artifact of outside) {
            if (!this.archiveOk) break;
            const verdict = verdicts.get(artifact.id);
            if (verdict?.bad === true) {
                this.failIndexConflict(artifact.id);
                continue;
            }
            // One listing that cannot be proven outweighs another that can: recovery meets whichever it reads first.
            if (verdict?.unproven === true) {
                this.failLedgerEvidence(artifact.id);
                continue;
            }
            if (verdict?.ok === true) continue;
            // Listed nowhere: write the manifest again.
            let source: ManifestSource;
            const current = this.work.find((candidate) => candidate.artifacts.some((job) => job.artifactIdentity === artifact.id));
            // A sibling that is only late (retry, damaged and about to be republished) does not hold the verified half back:
            // the manifest is the full set of the candidate, and the sibling's own publication later finds it byte for byte.
            if (current !== undefined) source = current;
            else {
                try {
                    source = this.manifestSourceFor(artifact.id);
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    // Nothing to rebuild it from; a file of its own document that is no manifest is the sharper finding.
                    if (invalidDocuments.has(artifact.documentId)) this.failIndexConflict(artifact.id);
                    else this.failLedgerEvidence(artifact.id);
                    continue;
                }
            }
            const { key } = this.manifestOf(source);
            const known = attempts.get(key);
            if (known !== undefined) {
                if (!known) this.failIndexConflict(artifact.id);
                continue;
            }
            const written = await this.writeManifest(source);
            attempts.set(key, written.ok);
            if (!written.ok) {
                this.refuseManifest(written.reasonCode);
                if (!isArchiveSide(written.reasonCode)) this.failIndexConflict(artifact.id);
                continue;
            }
            await this.recordManifest(written);
        }
    }

    /**
     * Every document this snapshot includes but the completion does not list is a gap of that completion, with the reason it
     * is missing, so a restore from it never leaves a document out silently: a manifest or index conflict, a manifest that
     * could not be written, a candidate the checks blocked, or (the pair is not complete) the reason the ledger holds for
     * its first artifact that is not verified. Reason codes are the existing ones; nothing is invented.
     */
    private omissionGaps(listed: ReadonlyArray<{ documentId: string }>): Array<{ documentId: string; reasonCode: WorkerReasonCode }> {
        const present = new Set(listed.map((entry) => entry.documentId));
        const documentOf = (subject: string): string | undefined => parseManifestKey(subject)?.documentId ?? this.state.artifacts.get(subject)?.documentId;
        const conflicted = new Set([...this.indexConflicts].map(documentOf));
        const unproven = new Set([...this.ledgerEvidenceFailures].map(documentOf));
        const gaps: Array<{ documentId: string; reasonCode: WorkerReasonCode }> = [];
        for (const [documentId, reasonCode] of this.blockedDocuments) gaps.push({ documentId, reasonCode });
        // The source offers the document but no file for it yet: the existing ARTIFACT_PENDING reason fits, and a later run can resolve it.
        for (const documentId of this.emptyDocuments) if (!present.has(documentId)) gaps.push({ documentId, reasonCode: "artifact-pending" });
        for (const candidate of this.work) {
            if (present.has(candidate.documentId)) continue;
            const reasonCode = conflicted.has(candidate.documentId) ? "archive-conflict"
                : unproven.has(candidate.documentId) ? "ledger-inconsistent"
                    : this.manifestRefusals.get(candidate.documentId) ?? this.pendingReason(candidate);
            if (reasonCode !== null) gaps.push({ documentId: candidate.documentId, reasonCode });
        }
        return gaps;
    }

    /** What the ledger says about the first artifact of the candidate that is not verified; `null` when all are. */
    private pendingReason(candidate: WorkCandidate): WorkerReasonCode | null {
        for (const job of candidate.artifacts) {
            const entry = this.dl.entryOf(job.artifactIdentity);
            if (entry?.state === "verified") continue;
            return entry?.reasonCode ?? (entry?.state === "integrity_error" ? "artifact-integrity" : "artifact-pending");
        }
        return null;
    }

    private async publishRecords(): Promise<void> {
        if (this.snapshotId === null) return;
        const entries: Array<{ documentId: string; metadataRevision: string; manifestSha256: string; manifestKey: string }> = [];
        const publishedNow = new Set<string>();
        for (const candidate of this.work) {
            if (!this.archiveOk) break;
            const verified = candidate.artifacts.every((job) => this.dl.entryOf(job.artifactIdentity)?.state === "verified");
            if (!verified) continue;
            const written = await this.writeManifest(candidate);
            if (!written.ok) {
                this.refuseManifest(written.reasonCode);
                this.manifestRefusals.set(candidate.documentId, written.reasonCode);
                continue;
            }
            await this.fault("after-manifest-before-record");
            await this.recordManifest(written);
            entries.push({ documentId: candidate.documentId, metadataRevision: candidate.metadataRevision, manifestSha256: written.sha256, manifestKey: written.key });
            for (const job of candidate.artifacts) publishedNow.add(job.artifactIdentity);
        }
        await this.republishMissingBound();
        await this.backfillManifests(publishedNow);
        // A snapshot whose included documents were all omitted still gets a (gap-only) completion: restore --latest must see it.
        const omissions = this.omissionGaps(entries);
        if (!this.archiveOk || (entries.length === 0 && omissions.length === 0)) return;
        const binding = this.state.snapshots.get(this.snapshotId);
        if (binding === undefined) throw new WorkerError("ledger-inconsistent");
        const completion = buildCompletion({
            companyId: this.companyId, sequence: binding.sequence, snapshotId: binding.snapshotId, runId: this.runId,
            scopeRevision: binding.scopeRevision, policyRevision: binding.policyRevision,
            destinationIdentity: this.dl.destinationIdentity, destinationRevision: this.dl.destinationRevision,
            entries, gaps: [...this.state.gaps.map((gap) => ({ documentId: gap.documentId, reasonCode: gap.reasonCode })), ...omissions],
        });
        this.localCompletion = { key: completion.relativeKey, bytes: completion.bytes, sha256: completion.sha256 };
        const published = await this.archive.publishJson(completion.relativeKey, completion.bytes);
        if (!published.ok) {
            if (isArchiveSide(published.reasonCode)) this.archiveLost();
            else this.reasons.add(published.reasonCode);
            return;
        }
        this.localPublished.add(completion.relativeKey);
        await this.fault("after-completion-before-record");
        await this.deps.ledger.append("completion_published", {
            relativeKey: completion.relativeKey, sha256: completion.sha256, sequence: binding.sequence,
        }, this.now());
    }

    // ---- step 11: inventory and finish -----------------------------------------------------------------------------

    private counts(orphanTemps: number): { counts: RunCounts; entries: Array<{ state: DestinationEntry["state"]; reasonCode: WorkerReasonCode | null }> } {
        const jobs = this.work.flatMap((candidate) => candidate.artifacts);
        const seen = new Set<string>();
        const entries: Array<{ state: DestinationEntry["state"]; reasonCode: WorkerReasonCode | null }> = [];
        let verified = 0, blocked = this.blockedCandidates.length, retryWait = 0, integrityError = 0;
        const consider = (entry: DestinationEntry | undefined): void => {
            if (entry === undefined || seen.has(entry.artifactIdentity)) return;
            seen.add(entry.artifactIdentity);
            if (entry.state === "verified") verified += 1;
            else if (entry.state === "retry_wait") retryWait += 1;
            else if (entry.state === "integrity_error") integrityError += 1;
            else if (entry.state === "blocked" && !isTerminalReason(entry.reasonCode)) blocked += 1;
            if (!(entry.state === "blocked" && isTerminalReason(entry.reasonCode))) entries.push({ state: entry.state, reasonCode: entry.reasonCode });
        };
        for (const job of jobs) consider(this.dl.entryOf(job.artifactIdentity));
        let terminalUnavailable = 0;
        for (const entry of this.state.destinations.values()) {
            if (entry.destinationIdentity !== this.dl.destinationIdentity) continue;
            if (entry.state === "blocked" && isTerminalReason(entry.reasonCode)) terminalUnavailable += 1;
            else if (entry.state === "integrity_error") consider(entry);
        }
        return {
            counts: {
                candidates: this.totalCandidates, included: this.includedCandidates, verified, blocked, retryWait, integrityError,
                terminalUnavailable, orphanTemps, driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0,
                ...(this.drive === null ? {} : this.drive.counts()),
            },
            entries,
        };
    }

    private async finish(): Promise<RunSummary> {
        // The Drive copies of the manifests and the completion go first: what they could not do is part of what the run reports.
        await this.drive?.publishRecords();
        const { counts, entries } = this.counts(await countOrphanTemps(this.staging.path));
        const localEntries = [
            ...entries,
            ...this.blockedCandidates.map((reasonCode) => ({ state: "blocked" as const, reasonCode })),
        ];
        const driveReasons = this.drive?.entryReasons() ?? [];
        const judged = judgeSnapshotStatus({
            snapshotFailure: this.snapshotFailure,
            controlFailure: this.blockRun ?? (this.archiveOk ? null : "archive-unavailable"),
            localEntries,
            ...(this.drive === null ? {} : { drive: { bound: true, phaseFailure: this.drive.phaseFailure, entryReasons: driveReasons } }),
        });
        const extras = new Set<WorkerReasonCode>(this.reasons);
        for (const code of driveReasons) extras.add(code);
        if (this.drive?.phaseFailure != null) extras.add(this.drive.phaseFailure);
        for (const entry of entries) if (entry.state === "retry_wait" && entry.reasonCode !== null) extras.add(entry.reasonCode);
        for (const entry of this.state.destinations.values()) {
            if (entry.state === "blocked" && isTerminalReason(entry.reasonCode) && entry.reasonCode !== null) extras.add(entry.reasonCode);
        }
        const reasonCodes = this.snapshotFailure !== null ? judged.reasonCodes : sortedUnique([...judged.reasonCodes, ...extras]);
        const historicalCoverage = judgeHistoricalCoverage(this.state);
        const finishedAt = this.now();
        const binding = this.snapshotId === null ? undefined : this.state.snapshots.get(this.snapshotId);
        if (this.archiveOk || this.drive !== null) {
            const inventory = buildRunInventory({
                runId: this.runId, scheduledFor: this.scheduledFor, startedAt: this.startedAt, finishedAt,
                snapshotId: this.snapshotId, sequence: binding?.sequence ?? null, snapshotStatus: judged.snapshotStatus,
                historicalCoverage, reasonCodes, counts,
            });
            const key = runKey({ companyId: this.companyId, runId: this.runId });
            // The inventory is a convenience copy; a refusal leaves the ledger record below as the only one.
            const local = this.archiveOk ? (await this.archive.publishJson(key, inventory.bytes)).ok : false;
            await this.drive?.publishInventory({ key, bytes: inventory.bytes, sha256: inventory.sha256 }, local);
        }
        // What the inventory upload itself ran into is known only now: it is reported, but the inventory (already written) keeps the reasons it had.
        const reported = this.snapshotFailure !== null ? reasonCodes : sortedUnique([...reasonCodes, ...(this.drive?.entryReasons() ?? []), ...(this.drive?.phaseFailure == null ? [] : [this.drive.phaseFailure])]);
        await this.deps.ledger.append("run_finished", {
            runId: this.runId, finishedAt, snapshotStatus: judged.snapshotStatus, historicalCoverage, reasonCodes: reported, counts,
        }, finishedAt);
        return {
            outcome: "finished", runId: this.runId, snapshotId: this.snapshotId, sequence: binding?.sequence ?? null,
            snapshotStatus: judged.snapshotStatus, historicalCoverage, reasonCodes: reported, counts,
        };
    }
}

/** `run` (contract section 3). Anything that is not the control side's fault ends as a recorded outcome, never a throw. */
export async function executeRun(deps: RunnerDependencies, options: { scheduledFor?: string | null }): Promise<RunSummary> {
    const installation = requireInstallation(deps);
    const archive = deps.createDestination({ dev: installation.archiveDev, ino: installation.archiveIno });
    await assertSameInstallation(archive, installation);
    await assertLedgerRoom(deps);
    await deps.ledger.compactIfNeeded(deps.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD);
    const staging = await archive.ensureStaging(deps.config.control.path);
    if (!staging.ok) throw new WorkerError(staging.reasonCode);
    return new RunExecution(deps, archive, staging.root, options.scheduledFor ?? null).execute();
}
