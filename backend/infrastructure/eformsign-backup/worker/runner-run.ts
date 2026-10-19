import { promises as fs } from "node:fs";

import { EXPORT_ARTIFACT_MAX_BYTES } from "domain/eformsign-backup/export/constants";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import {
    WorkerError, actionForExportError, artifactKey, buildCompletion, buildManifest, buildRunInventory, integrityErrorCount,
    integrityRetryDecision, judgeHistoricalCoverage, judgeSnapshotStatus, manifestKey, nextRetryAt, nextSnapshotSequence,
    parseCompletionName, runKey, toArchiveArtifactType,
    type ArchiveArtifactType, type DestinationEntry, type ExportAction, type RunCounts, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { DEFAULT_COMPACTION_THRESHOLD } from "./ledger-store";
import {
    ExportFailure, type CandidatePageView, type CandidateView, type SnapshotView,
} from "./export-client";
import type { LocalDestination, StagingRoot } from "./local-destination";
import {
    DestinationLedger, SNAPSHOT_POLL_LIMIT, SNAPSHOT_POLL_MS, TRANSIENT_STOP, assertLedgerRoom, assertSameInstallation,
    controlHasStagingRoom, countOrphanTemps, isArchiveSide, isTerminalReason, nowIso, requireInstallation,
} from "./runner-common";
import { type RunSummary, type RunnerDependencies } from "./runner-types";

const OPAQUE_ID = /^[^\u0000-\u001f\u007f]{1,512}$/u;

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
    private totalCandidates = 0;
    private includedCandidates = 0;

    constructor(
        private readonly deps: RunnerDependencies,
        private readonly archive: LocalDestination,
        private readonly staging: StagingRoot,
        private readonly scheduledFor: string | null,
    ) {
        this.dl = new DestinationLedger(deps, requireInstallation(deps));
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
        const check = await this.archive.checkArchive(0);
        if (!check.ok) this.archiveLost();
        this.runId = this.deps.uuid();
        await this.recoverInterrupted();
        await this.finishOpenRuns();
        this.startedAt = this.now();
        await this.deps.ledger.append("run_started", { runId: this.runId, scheduledFor: this.scheduledFor, startedAt: this.startedAt }, this.startedAt);
        try {
            await this.snapshotStage();
            await this.processCandidates();
            await this.publishRecords();
        } catch (error) {
            if (!(error instanceof StageFailure)) throw error;
            this.snapshotFailure = error.reasonCode;
        }
        return this.finish();
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
                reasonCodes: ["crashed"], counts: { candidates: 0, included: 0, verified: 0, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 },
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

    /** Highest sequence in the names of the archive's completion files (never a clock). */
    private async archiveMaxSequence(): Promise<number> {
        if (!this.archiveOk) return 0;
        try {
            let max = 0;
            for (const file of await this.archive.listCompletions(this.companyId)) {
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
            blocked = "invalid-path-segment";
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

    /** Entries that failed their integrity check and are not in this snapshot: re-publish from staging or record the gap (V10). */
    private async carryOver(): Promise<void> {
        const inSnapshot = new Set(this.work.flatMap((candidate) => candidate.artifacts.map((job) => job.artifactIdentity)));
        for (const entry of [...this.state.destinations.values()]) {
            if (entry.destinationIdentity !== this.dl.destinationIdentity || entry.destinationRevision !== this.dl.destinationRevision) continue;
            if (entry.state !== "integrity_error" || inSnapshot.has(entry.artifactIdentity)) continue;
            const info = this.state.artifacts.get(entry.artifactIdentity);
            if (info === undefined || info.byteLength === null) {
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
            const job: ArtifactJob = {
                documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
                artifactIdentity: entry.artifactIdentity, sha256: info.sha256, byteLength: info.byteLength, relativeKey,
            };
            if (integrityRetryDecision(integrityErrorCount(entry)).to === "blocked") {
                await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: "integrity-repeated", relativeKey });
            } else if (await this.stagedUsable(job)) {
                await this.processArtifact(job, "carry");
            } else {
                await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode: "exact-bytes-unavailable", relativeKey });
            }
        }
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
        const staged = await this.stagedUsable(job);
        if (entry !== undefined && state === "blocked" && !(await this.blockedMayRetry(entry, job, staged))) return;
        if (state === "transferring" || state === "verifying") return;

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

        await assertLedgerRoom(this.deps);
        await this.ensurePending(job);
        await this.dl.transition(id, "transferring", { relativeKey: job.relativeKey });
        await this.fault("after-transferring");
        if (!staged && !(await this.download(job))) return;
        await this.publish(job);
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
        let stream: AsyncIterable<Uint8Array>;
        try {
            stream = await client.openArtifact(this.snapshotId, { artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength });
        } catch (error) {
            await this.onDownloadError(job, error);
            return false;
        }
        const staged = await this.archive.stageArtifact(this.staging, this.input(job), stream);
        if (!staged.ok) {
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

    private async publish(job: ArtifactJob): Promise<void> {
        const id = job.artifactIdentity;
        if (!this.archiveOk) {
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey: job.relativeKey });
            return;
        }
        const result = await this.archive.publishArtifact(this.input(job), this.archive.openStaged(this.staging, id));
        if (!result.ok) {
            await this.onPublishFailure(job, result.reasonCode);
            return;
        }
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
            return;
        }
        if (found === "ok") {
            await this.fault("after-verifying-before-verified");
            await this.dl.transition(id, "verified", { relativeKey });
            return;
        }
        if (found === "mismatch") await this.quarantine(relativeKey);
        await this.dl.transition(id, "integrity_error", { reasonCode: "artifact-integrity", relativeKey });
    }

    private async onPublishFailure(job: ArtifactJob, code: WorkerReasonCode): Promise<void> {
        const id = job.artifactIdentity;
        if (isArchiveSide(code)) {
            this.archiveLost();
            await this.dl.transition(id, "blocked", { reasonCode: "archive-unavailable", relativeKey: job.relativeKey });
        } else if (code === "artifact-integrity" || code === "pdf-shape") {
            await this.recordIntegrityError(job);
        } else if (code === "archive-conflict") {
            // Other bytes already sit at the final name: move them aside, never overwrite, and let the next run publish again.
            await this.quarantine(job.relativeKey);
            await this.recordIntegrityError(job);
        } else if (code === "control-unavailable" || code === "control-space") {
            throw new WorkerError(code);
        } else {
            await this.dl.transition(id, "blocked", { reasonCode: code, relativeKey: job.relativeKey });
        }
    }

    // ---- steps 9-10: manifests and the completion ------------------------------------------------------------------

    private async publishRecords(): Promise<void> {
        if (this.snapshotId === null) return;
        const entries: Array<{ documentId: string; metadataRevision: string; manifestSha256: string }> = [];
        for (const candidate of this.work) {
            if (!this.archiveOk) break;
            const verified = candidate.artifacts.every((job) => this.dl.entryOf(job.artifactIdentity)?.state === "verified");
            if (!verified) continue;
            const manifest = buildManifest({
                companyId: this.companyId, documentId: candidate.documentId, metadataRevision: candidate.metadataRevision,
                artifacts: candidate.artifacts.map((job) => ({
                    artifactType: job.artifactType, artifactIdentity: job.artifactIdentity, sha256: job.sha256, byteLength: job.byteLength,
                })),
            });
            const key = manifestKey({ companyId: this.companyId, documentId: candidate.documentId, metadataRevision: candidate.metadataRevision });
            const published = await this.archive.publishJson(key, manifest.bytes);
            if (!published.ok) {
                if (isArchiveSide(published.reasonCode)) this.archiveLost();
                else {
                    this.blockedCandidates.push(published.reasonCode);
                    this.reasons.add(published.reasonCode);
                }
                continue;
            }
            await this.fault("after-manifest-before-record");
            if (!this.state.manifests.has(key)) {
                await this.deps.ledger.append("manifest_published", { relativeKey: key, sha256: manifest.sha256 }, this.now());
            }
            entries.push({ documentId: candidate.documentId, metadataRevision: candidate.metadataRevision, manifestSha256: manifest.sha256 });
        }
        if (entries.length === 0 || !this.archiveOk) return;
        const binding = this.state.snapshots.get(this.snapshotId);
        if (binding === undefined) throw new WorkerError("ledger-inconsistent");
        const completion = buildCompletion({
            companyId: this.companyId, sequence: binding.sequence, snapshotId: binding.snapshotId, runId: this.runId,
            scopeRevision: binding.scopeRevision, policyRevision: binding.policyRevision,
            destinationIdentity: this.dl.destinationIdentity, destinationRevision: this.dl.destinationRevision,
            entries, gaps: this.state.gaps.map((gap) => ({ documentId: gap.documentId, reasonCode: gap.reasonCode })),
        });
        const published = await this.archive.publishJson(completion.relativeKey, completion.bytes);
        if (!published.ok) {
            if (isArchiveSide(published.reasonCode)) this.archiveLost();
            else this.reasons.add(published.reasonCode);
            return;
        }
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
                terminalUnavailable, orphanTemps,
            },
            entries,
        };
    }

    private async finish(): Promise<RunSummary> {
        const { counts, entries } = this.counts(await countOrphanTemps(this.staging.path));
        const localEntries = [
            ...entries,
            ...this.blockedCandidates.map((reasonCode) => ({ state: "blocked" as const, reasonCode })),
        ];
        const judged = judgeSnapshotStatus({
            snapshotFailure: this.snapshotFailure,
            controlFailure: this.blockRun ?? (this.archiveOk ? null : "archive-unavailable"),
            localEntries,
        });
        const extras = new Set<WorkerReasonCode>(this.reasons);
        for (const entry of entries) if (entry.state === "retry_wait" && entry.reasonCode !== null) extras.add(entry.reasonCode);
        for (const entry of this.state.destinations.values()) {
            if (entry.state === "blocked" && isTerminalReason(entry.reasonCode) && entry.reasonCode !== null) extras.add(entry.reasonCode);
        }
        const reasonCodes = this.snapshotFailure !== null ? judged.reasonCodes : sortedUnique([...judged.reasonCodes, ...extras]);
        const historicalCoverage = judgeHistoricalCoverage(this.state);
        const finishedAt = this.now();
        const binding = this.snapshotId === null ? undefined : this.state.snapshots.get(this.snapshotId);
        if (this.archiveOk) {
            const inventory = buildRunInventory({
                runId: this.runId, scheduledFor: this.scheduledFor, startedAt: this.startedAt, finishedAt,
                snapshotId: this.snapshotId, sequence: binding?.sequence ?? null, snapshotStatus: judged.snapshotStatus,
                historicalCoverage, reasonCodes, counts,
            });
            // The inventory is a convenience copy; a refusal leaves the ledger record below as the only one.
            await this.archive.publishJson(runKey({ companyId: this.companyId, runId: this.runId }), inventory.bytes);
        }
        await this.deps.ledger.append("run_finished", {
            runId: this.runId, finishedAt, snapshotStatus: judged.snapshotStatus, historicalCoverage, reasonCodes, counts,
        }, finishedAt);
        return {
            outcome: "finished", runId: this.runId, snapshotId: this.snapshotId, sequence: binding?.sequence ?? null,
            snapshotStatus: judged.snapshotStatus, historicalCoverage, reasonCodes, counts,
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
