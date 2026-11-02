import { createHash } from "node:crypto";

import {
    WorkerError, artifactKey, buildCompletion, classifyDriveFailure, completionSchema, destinationKey, driveMimeOf, driveNameOf, driveStateKey, isDriveDestinationIdentity,
    integrityErrorCount, integrityRetryDecision, parseManifestKey, runInventorySchema, runKey,
    type ArchiveArtifactType, type DestinationEntry, type Installation, type LedgerState, type RunCounts, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { readOutbox, writeOutbox } from "./drive-outbox";
import { DriveTransferError, type DriveFailure } from "./drive-client";
import type { DriveDestination, DriveNodeLedger, DriveStep } from "./drive-destination";
import type { LocalDestination, StagingRoot } from "./local-destination";
import { parseManifestBytes } from "./restore";
import { DestinationLedger, TRANSIENT_STOP, assertLedgerRoom, isTerminalReason, ledgerDriveNodes, nowIso } from "./runner-common";
import type { RunnerDependencies } from "./runner-types";

/** One artifact the run works on, as `runner-run.ts` holds it (structurally the same shape). */
export interface DriveJob {
    documentId: string;
    artifactType: ArchiveArtifactType;
    fileType: "document" | "audit_trail";
    artifactIdentity: string;
    sha256: string;
    byteLength: number;
    relativeKey: string;
}
export interface DriveCandidate {
    documentId: string;
    metadataRevision: string;
    artifacts: DriveJob[];
}

/** A record of the run, ready to publish: its archive key, canonical bytes and sha256. */
export interface DriveBuiltRecord {
    key: string;
    bytes: Uint8Array;
    sha256: string;
}

/** What the completion of this run's snapshot is built from when the archive cannot give a local one. */
export interface DriveCompletionContext {
    companyId: string;
    runId: string;
    sequence: number;
    snapshotId: string;
    scopeRevision: string;
    policyRevision: string;
    localIdentity: string;
    localRevision: string;
    stateGaps: ReadonlyArray<{ documentId: string; reasonCode: WorkerReasonCode }>;
    blockedDocuments: ReadonlyMap<string, WorkerReasonCode>;
    emptyDocuments: ReadonlySet<string>;
}

/** What the Drive phase needs from the run that owns it. */
export interface DriveRunHost {
    archiveOk(): boolean;
    archiveLost(): void;
    /** The manifest bytes the local side publishes for this candidate. */
    manifestOf(candidate: DriveCandidate): DriveBuiltRecord;
    /** The staged copy of the artifact exists with the recorded size. */
    stagedUsable(job: DriveJob): Promise<boolean>;
    setStagingAside(job: DriveJob): Promise<void>;
    /** Stages the bytes of `source` as the artifact's staged copy, through the same checks as a download. */
    restage(job: DriveJob, source: AsyncIterable<Uint8Array>): Promise<{ ok: true } | { ok: false; reasonCode: WorkerReasonCode }>;
    /** Whether the local side published this record (manifest, completion) to the archive in this run. */
    locallyPublished(relativeKey: string): boolean;
    /** The completion the local side built for this snapshot, `null` when it built none (archive lost, nothing to say). */
    localCompletion(): DriveBuiltRecord | null;
    completionContext(): DriveCompletionContext | null;
}

/**
 * What staging a copy again from Drive came to: `true` staged; `false` Drive answered there is no usable copy (or holds none verified);
 * `{ unavailable }` Drive could not be asked, so nothing is known about its copy (the reason is an existing, non-terminal code).
 */
export type DriveHeal = boolean | { unavailable: WorkerReasonCode };

const TRANSIENT_REASONS: ReadonlySet<WorkerReasonCode> = new Set(["network-timeout", "drive-unavailable", "rate-limited"]);
/** Failures that concern the whole account: nothing else in this run can succeed, so the phase stops. */
const HALTING_REASONS: ReadonlySet<WorkerReasonCode> = new Set(["drive-token-invalid", "drive-permission", "drive-quota"]);
const COMPLETION_KEY = /\/completions\/\d{12}-[0-9a-f]{64}\.json$/;

function sha256Of(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** An entry that still has work to do on Drive: the same set the local carry-over takes. */
function open(entry: DestinationEntry): boolean {
    switch (entry.state) {
        case "integrity_error":
        case "retry_wait":
        case "pending":
            return true;
        case "blocked":
            return entry.reasonCode !== "integrity-repeated";
        default:
            return false;
    }
}

/** A failed Drive body must not look like a failed export or a failed control write to the code that stages it. */
async function* guardTransfer(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    try {
        yield* source;
    } catch (error) {
        if (error instanceof DriveTransferError) throw new WorkerError("network-timeout");
        throw error;
    }
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
    yield bytes;
}

/**
 * The Drive destination with control readiness enforced immediately before every operation that reaches Drive (V08): below the
 * ledger's reserve the call is not made and the run stops with `control-space`, like any other ledger write would. Every Drive
 * call this phase makes goes through this wrapper, so no call site has to remember.
 */
function guardedByControlSpace(deps: RunnerDependencies, inner: DriveDestination): DriveDestination {
    const room = (): Promise<void> => assertLedgerRoom(deps);
    const guarded = {
        checkRoot: async (...args: Parameters<DriveDestination["checkRoot"]>) => { await room(); return inner.checkRoot(...args); },
        ensureFolderChain: async (...args: Parameters<DriveDestination["ensureFolderChain"]>) => { await room(); return inner.ensureFolderChain(...args); },
        uploadArtifact: async (...args: Parameters<DriveDestination["uploadArtifact"]>) => { await room(); return inner.uploadArtifact(...args); },
        verifyRemote: async (...args: Parameters<DriveDestination["verifyRemote"]>) => { await room(); return inner.verifyRemote(...args); },
        publishJson: async (...args: Parameters<DriveDestination["publishJson"]>) => { await room(); return inner.publishJson(...args); },
        download: async (...args: Parameters<DriveDestination["download"]>) => { await room(); return inner.download(...args); },
    };
    return guarded as unknown as DriveDestination;
}

/**
 * The Google Drive destination of one `run` (BJJ-456 design 7.1-7.3). It is a second, independent destination: it works from
 * the staged bytes and from what the ledger and the archive hold, never depends on the archive being up, and whatever goes
 * wrong here makes the run `partial` and never ends it. Every id is reserved in the ledger before Drive sees it (the destination
 * adapter does that), every state change is a validated transition of the Drive revision's own entry, and nothing is deleted.
 */
export class DriveRunPhase {
    private readonly dl: DestinationLedger;
    private readonly revision: string;
    private gate: "unchecked" | "open" | "closed" = "unchecked";
    /** Why the phase as a whole did not run to its end; `null` while nothing stopped it. */
    phaseFailure: WorkerReasonCode | null = null;
    private closedAs: { code: WorkerReasonCode; blocked: boolean } | null = null;
    private halted: { code: WorkerReasonCode; blocked: boolean } | null = null;
    private streak = 0;
    private readonly failureReasons = new Set<WorkerReasonCode>();
    private readonly manifestFailures = new Map<string, WorkerReasonCode>();
    private work: readonly DriveCandidate[] = [];

    /** `null` when the run has no Drive part: no `drive` block in the config, or no `ready` binding to work for. */
    static forRun(
        deps: RunnerDependencies, installation: Installation, archive: LocalDestination, staging: StagingRoot, host: DriveRunHost,
    ): DriveRunPhase | null {
        if (deps.drive === null) return null;
        const binding = installation.drive;
        if (binding === null || binding.status !== "ready") return null;
        return new DriveRunPhase(deps, installation, archive, staging, host);
    }

    private readonly destination: DriveDestination | null;

    private constructor(
        private readonly deps: RunnerDependencies, private readonly installation: Installation,
        private readonly archive: LocalDestination, private readonly staging: StagingRoot, private readonly host: DriveRunHost,
    ) {
        const binding = installation.drive!;
        this.revision = binding.destinationRevision;
        this.dl = new DestinationLedger(deps, installation, binding);
        if (deps.drive !== null && deps.drive.kind === "unavailable") {
            // A8: the Drive secret files cannot be used. No Drive work at all; the run reports why.
            this.destination = null;
            this.gate = "closed";
            this.phaseFailure = deps.drive.reason;
        } else {
            this.destination = guardedByControlSpace(deps, deps.createDriveDestination({
                rootFolderId: binding.rootFolderId, rootName: binding.rootName, rootParentId: binding.rootParentId, bindingId: binding.bindingId,
                installationId: installation.installationId, archiveId: installation.archiveId,
            }));
        }
    }

    private get state(): LedgerState { return this.deps.ledger.state; }
    private now(): string { return nowIso(this.deps); }

    // ---- the gate ----------------------------------------------------------------------------------------------------

    /**
     * Once per run, before the first Drive call that matters: the token works and the root still is the folder this binding
     * made. A token the server rejects, a changed root, an unreachable Drive all close the gate for the whole run.
     */
    private async ensureGate(): Promise<boolean> {
        if (this.gate !== "unchecked") return this.gate === "open";
        this.gate = "closed";
        const root = await this.destination!.checkRoot();
        if (!root.ok) {
            if ("conflict" in root) this.closeGate("drive-root-changed", true);
            else {
                const failure = this.classify(root.failure, 1);
                this.closeGate(failure.reasonCode, !failure.retry);
            }
            return false;
        }
        if (root.value === "changed") {
            this.closeGate("drive-root-changed", true);
            return false;
        }
        this.gate = "open";
        return true;
    }

    private closeGate(code: WorkerReasonCode, blocked: boolean): void {
        this.closedAs = { code, blocked };
        this.phaseFailure ??= code;
    }

    private halt(code: WorkerReasonCode, blocked: boolean): void {
        this.halted ??= { code, blocked };
        this.phaseFailure ??= code;
    }

    /** The gate is open and nothing stopped the phase: Drive may be called. */
    private async ready(): Promise<boolean> {
        return this.destination !== null && this.halted === null && await this.ensureGate();
    }

    private classify(failure: DriveFailure, attempts: number): { reasonCode: WorkerReasonCode; retry: boolean; nextRetryAt: string | null } {
        const action = classifyDriveFailure(failure, attempts, this.deps.clock.now());
        if (action.kind === "retry_wait") return { reasonCode: action.reasonCode, retry: true, nextRetryAt: action.nextRetryAt };
        if (action.kind === "blocked") return { reasonCode: action.reasonCode, retry: false, nextRetryAt: null };
        return { reasonCode: "drive-conflict", retry: false, nextRetryAt: null };
    }

    private nodes(): DriveNodeLedger {
        const base = ledgerDriveNodes(this.deps, this.revision);
        return {
            current: (nodeKey) => base.current(nodeKey),
            reserve: async (kind, nodeKey, fileId, parentFileId) => {
                await base.reserve(kind, nodeKey, fileId, parentFileId);
                await this.deps.runnerFault?.("drive-after-reserved-before-create");
            },
            created: (nodeKey, fileId) => base.created(nodeKey, fileId),
        };
    }

    // ---- hook 1: entries a crash left in flight ----------------------------------------------------------------------

    private entries(): DestinationEntry[] {
        return [...this.state.destinations.values()].filter((entry) => entry.destinationIdentity === this.dl.destinationIdentity
            && entry.destinationRevision === this.revision);
    }

    /** `transferring` / `verifying` Drive entries: ask Drive what is there under the reserved id and settle them from that. */
    async recoverInterrupted(): Promise<void> {
        const stuck = this.entries().filter((entry) => entry.state === "transferring" || entry.state === "verifying");
        if (stuck.length === 0 || !(await this.ready())) return;
        for (const entry of stuck) {
            if (this.halted !== null) return;
            await this.recoverEntry(entry);
        }
    }

    private async recoverEntry(entry: DestinationEntry): Promise<void> {
        const id = entry.artifactIdentity;
        const info = this.state.artifacts.get(id);
        let relativeKey = entry.relativeKey;
        if (relativeKey === null && info !== undefined) {
            try {
                relativeKey = artifactKey({ companyId: this.deps.config.companyId, documentId: info.documentId, artifactType: info.artifactType, sha256: info.sha256 });
            } catch { relativeKey = null; }
        }
        const node = relativeKey === null ? undefined : this.state.driveNodes.get(driveStateKey(this.revision, relativeKey));
        let found: "ok" | "missing" | "mismatch" = "missing";
        const length = relativeKey !== null && info !== undefined && node !== undefined && node.kind === "file"
            ? await this.resolveLength(id, info, relativeKey)
            : null;
        if (relativeKey !== null && info !== undefined && length !== null && node !== undefined && node.kind === "file") {
            const checked = await this.destination!.verifyRemote(node.fileId, {
                name: driveNameOf(relativeKey), parentFileId: node.parentFileId, sha256: info.sha256, byteLength: length, mimeType: driveMimeOf(relativeKey),
            });
            if (!checked.ok) {
                if ("failure" in checked) await this.applyFailure({ artifactIdentity: id, relativeKey }, checked.failure);
                else await this.recordIntegrityError({ artifactIdentity: id, relativeKey });
                return;
            }
            found = checked.value;
        }
        if (found === "ok") {
            if (entry.state === "transferring") await this.dl.transition(id, "verifying", { relativeKey });
            await this.dl.transition(id, "verified", { relativeKey });
        } else if (found === "mismatch") {
            await this.recordIntegrityError({ artifactIdentity: id, relativeKey });
        } else {
            await this.dl.transition(id, "retry_wait", { reasonCode: "crashed", nextRetryAt: this.now(), attempts: entry.attempts + 1, relativeKey });
            await this.dl.transition(id, "pending");
        }
    }

    // ---- hook 3: artifacts ---------------------------------------------------------------------------------------------

    /** Every artifact of this run's snapshot, then the Drive entries of artifacts no snapshot offers any more. */
    async processWork(work: readonly DriveCandidate[]): Promise<void> {
        this.work = work;
        const inSnapshot = new Set<string>();
        for (const candidate of work) {
            for (const job of candidate.artifacts) {
                inSnapshot.add(job.artifactIdentity);
                await this.processJob(job);
            }
        }
        for (const entry of this.entries()) {
            if (!open(entry) || inSnapshot.has(entry.artifactIdentity)) continue;
            const info = this.state.artifacts.get(entry.artifactIdentity);
            if (info === undefined) continue;
            let relativeKey: string;
            try {
                relativeKey = entry.relativeKey ?? artifactKey({ companyId: this.deps.config.companyId, documentId: info.documentId, artifactType: info.artifactType, sha256: info.sha256 });
            } catch { continue; }
            const byteLength = await this.resolveLength(entry.artifactIdentity, info, relativeKey);
            if (byteLength === null) continue;
            await this.processJob({
                documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
                artifactIdentity: entry.artifactIdentity,
                sha256: info.sha256, byteLength, relativeKey,
            });
        }
        await this.processHistorical(inSnapshot);
    }

    /**
     * Artifacts this Drive revision has no entry for at all (everything a rebind starts without, and anything no snapshot offers any
     * more) that still have verified bytes to upload from, and so become Drive work like any other, before their records. Two kinds:
     * what the local destination holds verified (uploaded from staging, else the local archive after a hash check), and what only
     * staging holds: the local entry is not verified and not terminal, or an earlier Drive revision had an entry for it (it reached
     * Drive during an archive outage, and the local side never verified it). The latter is selected only when a staged copy on record
     * passes the length and hash checks right here, so an artifact without verifiable bytes never reaches `processJob`. One pass over
     * the ledger per run.
     */
    private async processHistorical(inSnapshot: ReadonlySet<string>): Promise<void> {
        const local = this.installation;
        const verifiedLocally = new Set<string>();
        const stagedOnly = new Set<string>();
        for (const entry of this.state.destinations.values()) {
            const id = entry.artifactIdentity;
            if (inSnapshot.has(id) || this.dl.entryOf(id) !== undefined) continue;
            if (entry.destinationIdentity === local.destinationIdentity && entry.destinationRevision === local.destinationRevision) {
                if (entry.state === "verified") verifiedLocally.add(id);
                else if (!isTerminalReason(entry.reasonCode)) stagedOnly.add(id);
            } else if (isDriveDestinationIdentity(entry.destinationIdentity) && entry.destinationRevision !== this.revision) {
                stagedOnly.add(id);
            }
        }
        for (const identity of [...new Set([...verifiedLocally, ...stagedOnly])].sort()) {
            if (this.halted !== null) return;
            const info = this.state.artifacts.get(identity);
            if (info === undefined) continue;
            let relativeKey: string;
            try {
                relativeKey = artifactKey({ companyId: this.deps.config.companyId, documentId: info.documentId, artifactType: info.artifactType, sha256: info.sha256 });
            } catch { continue; }
            const byteLength = verifiedLocally.has(identity)
                ? await this.resolveLength(identity, info, relativeKey)
                : await this.stagedLength(identity, info, relativeKey);
            if (byteLength === null) continue;
            await this.processJob({
                documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
                artifactIdentity: identity, sha256: info.sha256, byteLength, relativeKey,
            });
        }
    }

    /**
     * The length of an artifact's staged copy when that copy is on record for exactly this artifact, agrees with the ledger's length
     * when it has one, is on disk with the recorded size and hashes to the recorded sha256; otherwise `null`. Nothing is changed.
     */
    private async stagedLength(identity: string, info: NonNullable<ReturnType<LedgerState["artifacts"]["get"]>>, relativeKey: string): Promise<number | null> {
        const staged = this.state.staged.get(identity);
        if (staged === undefined || staged.sha256 !== info.sha256) return null;
        if (info.byteLength !== null && staged.byteLength !== info.byteLength) return null;
        const job: DriveJob = {
            documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
            artifactIdentity: identity, sha256: info.sha256, byteLength: staged.byteLength, relativeKey,
        };
        try {
            return await this.host.stagedUsable(job) && await this.stagedHashOk(job) ? staged.byteLength : null;
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            return null;
        }
    }

    private async processJob(job: DriveJob): Promise<void> {
        const id = job.artifactIdentity;
        if (this.destination === null) return;
        const entry = this.dl.entryOf(id);
        if (entry?.state === "verified" || entry?.state === "transferring" || entry?.state === "verifying") return;
        if (entry?.state === "retry_wait" && Date.parse(entry.nextRetryAt ?? "") > this.deps.clock.now().getTime()) return;
        if (entry?.state === "blocked" && entry.reasonCode === "integrity-repeated") return;
        if (entry?.state === "integrity_error" && integrityRetryDecision(integrityErrorCount(entry)).to === "blocked") {
            await this.dl.transition(id, "blocked", { reasonCode: "integrity-repeated", relativeKey: job.relativeKey });
            return;
        }
        if (this.halted !== null) {
            if (this.halted.blocked) await this.markBlocked(job, this.halted.code);
            return;
        }
        if (!(await this.stagedForUpload(job))) return;
        if (!(await this.ready())) {
            if (this.closedAs?.blocked === true && this.destination !== null) await this.markBlocked(job, this.closedAs.code);
            return;
        }
        await this.upload(job, entry?.state === "integrity_error");
    }

    /** A blocked record for an artifact the phase could not even try, so `inspect` and the run counts show it. */
    private async markBlocked(job: DriveJob, reasonCode: WorkerReasonCode): Promise<void> {
        const entry = this.dl.entryOf(job.artifactIdentity);
        if (entry?.state === "verified" || entry?.state === "transferring" || entry?.state === "verifying") return;
        if (entry?.state === "blocked" && entry.reasonCode === reasonCode) return;
        if (entry?.state === "retry_wait" && Date.parse(entry.nextRetryAt ?? "") > this.deps.clock.now().getTime()) return;
        await this.dl.transition(job.artifactIdentity, "blocked", { reasonCode, relativeKey: job.relativeKey });
    }

    /**
     * The one place an artifact's length is settled for Drive work. `recover` records an artifact it adopted from the archive without a
     * length, and a Drive entry of it may be carried over, settled after a crash or uploaded later, so every such path asks here:
     * the ledger's length; else the length of a staged copy that is on record for this artifact AND hashes to the recorded sha256;
     * else the length of the archive's copy when its bytes hash to it. `null` (nothing proves a length): the artifact is skipped.
     */
    private async resolveLength(identity: string, info: NonNullable<ReturnType<LedgerState["artifacts"]["get"]>>, relativeKey: string): Promise<number | null> {
        if (info.byteLength !== null) return info.byteLength;
        const staged = this.state.staged.get(identity);
        if (staged !== undefined && staged.sha256 === info.sha256) {
            const job: DriveJob = {
                documentId: info.documentId, artifactType: info.artifactType, fileType: info.artifactType === "audit-trail" ? "audit_trail" : "document",
                artifactIdentity: identity, sha256: info.sha256, byteLength: staged.byteLength, relativeKey,
            };
            if (await this.host.stagedUsable(job) && await this.stagedHashOk(job)) return staged.byteLength;
        }
        return this.archiveLengthOf(relativeKey, info.sha256);
    }

    /** The length of the archive's copy of an artifact whose ledger record has none, when that copy hashes to `sha256`; otherwise `null`. */
    private async archiveLengthOf(relativeKey: string, sha256: string): Promise<number | null> {
        if (!this.host.archiveOk()) return null;
        let bytes: Buffer | null;
        try {
            bytes = await this.archive.readArchiveFile(relativeKey);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.host.archiveLost();
            return null;
        }
        return bytes !== null && sha256Of(bytes) === sha256 ? bytes.byteLength : null;
    }

    private async stagedHashOk(job: DriveJob): Promise<boolean> {
        const hash = createHash("sha256");
        let seen = 0;
        for await (const chunk of this.archive.openStaged(this.staging, job.artifactIdentity)) {
            hash.update(chunk);
            seen += chunk.byteLength;
        }
        return seen === job.byteLength && hash.digest("hex") === job.sha256;
    }

    /**
     * The bytes to upload: the staged copy if it is there and is the artifact; otherwise (V10) the artifact's verified copy in the
     * local archive is staged again, through the same checks as a download. `false`: there is nothing to upload from.
     */
    private async stagedForUpload(job: DriveJob): Promise<boolean> {
        if (await this.host.stagedUsable(job)) {
            if (await this.stagedHashOk(job)) return true;
            // The staged copy is not the artifact: it is set aside and never uploaded.
            await this.host.setStagingAside(job);
        }
        return this.restageFromLocal(job);
    }

    private async restageFromLocal(job: DriveJob): Promise<boolean> {
        // Design (BJJ-456 U5-P1, note 4): a copy is restaged only from the other destination's verified bytes. With the archive down, a
        // locally verified artifact whose staging copy is missing and that Drive does not hold yet is therefore NOT fetched from the
        // export again in this run; it stays unuploaded (reported as pending) and the first run after the archive returns heals it here.
        if (!this.host.archiveOk()) return false;
        const local = this.state.destinations.get(destinationKey(job.artifactIdentity, this.installation.destinationIdentity, this.installation.destinationRevision));
        if (local?.state !== "verified") return false;
        let bytes: Buffer | null;
        try {
            if (await this.archive.reverify(job.relativeKey, job.sha256, job.byteLength) !== "ok") return false;
            bytes = await this.archive.readArchiveFile(job.relativeKey);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            this.host.archiveLost();
            return false;
        }
        if (bytes === null) return false;
        return (await this.host.restage(job, once(bytes))).ok;
    }

    private async upload(job: DriveJob, fresh: boolean): Promise<void> {
        const id = job.artifactIdentity;
        const destination = this.destination!;
        await assertLedgerRoom(this.deps);
        if (this.dl.entryOf(id)?.state !== "pending") await this.dl.transition(id, "pending");
        await this.dl.transition(id, "transferring", { relativeKey: job.relativeKey });
        const nodes = this.nodes();
        const archive = this.archive;
        const staging = this.staging;
        const open = (offset: number): AsyncIterable<Uint8Array> => (async function* (): AsyncGenerator<Uint8Array> {
            let position = 0;
            for await (const chunk of archive.openStaged(staging, id)) {
                const end = position + chunk.byteLength;
                if (end > offset) yield position >= offset ? chunk : chunk.subarray(offset - position);
                position = end;
            }
        })();
        let result: DriveStep<{ fileId: string }>;
        try {
            const parent = await destination.ensureFolderChain(job.relativeKey, nodes);
            result = parent.ok
                ? await destination.uploadArtifact({
                    relativeKey: job.relativeKey, sha256: job.sha256, byteLength: job.byteLength, artifactIdentity: id, freshId: fresh,
                }, parent.value, nodes, open)
                : parent;
        } catch (error) {
            if (!(error instanceof WorkerError) || error.reasonCode !== "artifact-integrity") throw error;
            // The staged source failed its own check while it was being sent: the damage is local, the copy is set aside.
            await this.host.setStagingAside(job);
            const attempts = (this.dl.entryOf(id)?.attempts ?? 0) + 1;
            await this.dl.transition(id, "retry_wait", { reasonCode: "artifact-integrity", nextRetryAt: this.now(), attempts, relativeKey: job.relativeKey });
            return;
        }
        if (!result.ok) {
            if ("failure" in result) await this.applyFailure(job, result.failure);
            else await this.recordIntegrityError(job);
            return;
        }
        this.streak = 0;
        await this.deps.runnerFault?.("drive-after-upload-before-verifying");
        await this.dl.transition(id, "verifying", { relativeKey: job.relativeKey });
        await this.dl.transition(id, "verified", { relativeKey: job.relativeKey });
        await this.deps.runnerFault?.("drive-after-verified");
    }

    /** `transferring -> verifying -> integrity_error` (the table allows it only from verifying); the next try takes a fresh id. */
    private async recordIntegrityError(job: { artifactIdentity: string; relativeKey: string | null }): Promise<void> {
        const id = job.artifactIdentity;
        if (this.dl.entryOf(id)?.state === "transferring") await this.dl.transition(id, "verifying", { relativeKey: job.relativeKey });
        await this.dl.transition(id, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: job.relativeKey });
    }

    /** A Drive call failed: transient failures wait with the contract's backoff, the rest block; account-wide ones stop the phase. */
    private async applyFailure(job: { artifactIdentity: string; relativeKey: string | null }, failure: DriveFailure): Promise<void> {
        const id = job.artifactIdentity;
        const attempts = (this.dl.entryOf(id)?.attempts ?? 0) + 1;
        const classified = this.classify(failure, attempts);
        if (classified.retry) {
            await this.dl.transition(id, "retry_wait", { reasonCode: classified.reasonCode, nextRetryAt: classified.nextRetryAt, attempts, relativeKey: job.relativeKey });
            if (TRANSIENT_REASONS.has(classified.reasonCode)) {
                this.streak += 1;
                if (this.streak >= TRANSIENT_STOP) this.halt(classified.reasonCode, false);
            }
        } else {
            await this.dl.transition(id, "blocked", { reasonCode: classified.reasonCode, relativeKey: job.relativeKey });
            if (HALTING_REASONS.has(classified.reasonCode)) this.halt(classified.reasonCode, true);
        }
    }

    // ---- V10: the other destination's copy ---------------------------------------------------------------------------

    /** Whether Drive holds this artifact as verified for the current revision. */
    driveVerified(artifactIdentity: string): boolean {
        return this.dl.entryOf(artifactIdentity)?.state === "verified";
    }

    /**
     * The local side lost the staged bytes of an artifact Drive holds verified: stage it again from Drive, through the same checks as a
     * download (hash, size, PDF shape), before anything is downloaded or given up. A Drive copy that fails them is an integrity error
     * of the Drive entry.
     */
    async restageFromDrive(job: DriveJob): Promise<DriveHeal> {
        if (!this.driveVerified(job.artifactIdentity)) return false;
        const node = this.state.driveNodes.get(driveStateKey(this.revision, job.relativeKey));
        if (node === undefined || node.kind !== "file") return false;
        // From here on the ledger says Drive holds a verified copy: anything but Drive's own answer ("no usable copy") means it could not be
        // asked, including a phase with no usable destination at all (unreadable secret files, A8).
        const destination = this.destination;
        if (destination === null || !(await this.ready())) return { unavailable: this.halted?.code ?? this.closedAs?.code ?? this.phaseFailure ?? "drive-unavailable" };
        const got = await destination.download(node.fileId);
        if (!got.ok) {
            if (!("failure" in got)) return { unavailable: "drive-conflict" };
            if (this.classifyAbsent(got.failure)) {
                await this.dl.transition(job.artifactIdentity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: job.relativeKey });
                return false;
            }
            return { unavailable: this.classify(got.failure, 1).reasonCode };
        }
        const staged = await this.host.restage(job, guardTransfer(got.value));
        if (staged.ok) return true;
        if (staged.reasonCode === "artifact-integrity" || staged.reasonCode === "pdf-shape") {
            await this.dl.transition(job.artifactIdentity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: job.relativeKey });
            return false;
        }
        return { unavailable: staged.reasonCode };
    }

    private classifyAbsent(failure: DriveFailure): boolean {
        return classifyDriveFailure(failure, 1, this.deps.clock.now()).kind === "absent";
    }

    // ---- hook 5: records -----------------------------------------------------------------------------------------------

    private onDrive(relativeKey: string, sha256: string): boolean {
        return this.state.driveRecords.get(driveStateKey(this.revision, relativeKey))?.sha256 === sha256;
    }

    /** The manifest at `key` parses as that document's manifest and every artifact it names is Drive-verified on the current revision. */
    private manifestArtifactsVerified(key: string, bytes: Buffer): boolean {
        const parts = parseManifestKey(key);
        if (parts === null || parts.companyId !== this.deps.config.companyId) return false;
        try {
            const { manifest } = parseManifestBytes(bytes, key, { companyId: parts.companyId, documentId: parts.documentId, metadataRevision: parts.metadataRevision });
            return this.allVerified(manifest.artifacts);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            return false;
        }
    }

    private allVerified(artifacts: ReadonlyArray<{ artifactIdentity: string }>): boolean {
        return artifacts.every((artifact) => this.dl.entryOf(artifact.artifactIdentity)?.state === "verified");
    }

    /** A completion may only go to Drive when every manifest it names is there, byte for byte (the digest it records). */
    private completionReady(bytes: Uint8Array): boolean {
        let value: unknown;
        try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return false; }
        const parsed = completionSchema.safeParse(value);
        if (!parsed.success) return false;
        return parsed.data.entries.every((entry) => this.onDrive(entry.manifestKey, entry.manifestSha256));
    }

    /**
     * Makes the record durable before Drive is asked: the bytes go to the outbox and the ledger learns the record is pending (A3.2).
     * Nothing is written when the record is already on Drive or already pending with these bytes.
     */
    private async queue(relativeKey: string, bytes: Uint8Array): Promise<void> {
        const sha256 = sha256Of(bytes);
        const key = driveStateKey(this.revision, relativeKey);
        if (this.onDrive(relativeKey, sha256) || this.state.driveRecordsPending.get(key) === sha256) return;
        await assertLedgerRoom(this.deps);
        await writeOutbox(this.deps.config.control.path, bytes);
        await this.deps.ledger.append("drive_record_pending", { destinationRevision: this.revision, relativeKey, sha256 }, this.now());
    }

    /** One record to Drive. `queued`: its bytes live in the outbox, so a failure here is retried by a later run. */
    private async push(relativeKey: string, bytes: Uint8Array, queued: boolean): Promise<{ ok: true } | { ok: false; reasonCode: WorkerReasonCode }> {
        if (queued) await this.queue(relativeKey, bytes);
        if (!(await this.ready())) return { ok: false, reasonCode: this.phaseFailure ?? "drive-unavailable" };
        const published = await this.destination!.publishJson(relativeKey, bytes, this.nodes());
        if (!published.ok) {
            const reasonCode = await this.recordFailure(published);
            return { ok: false, reasonCode };
        }
        this.streak = 0;
        await this.deps.ledger.append("drive_record_published", {
            destinationRevision: this.revision, relativeKey, sha256: published.value.sha256, fileId: published.value.fileId,
        }, this.now());
        return { ok: true };
    }

    /** The failure of a call that is not about one artifact: the reason joins the run's, the phase stops when it must. */
    private async recordFailure(step: Exclude<DriveStep<unknown>, { ok: true }>): Promise<WorkerReasonCode> {
        const classified = "failure" in step ? this.classify(step.failure, 1) : { reasonCode: "drive-conflict" as WorkerReasonCode, retry: false, nextRetryAt: null };
        this.failureReasons.add(classified.reasonCode);
        if (classified.retry) {
            if (TRANSIENT_REASONS.has(classified.reasonCode)) {
                this.streak += 1;
                if (this.streak >= TRANSIENT_STOP) this.halt(classified.reasonCode, false);
            }
        } else if (HALTING_REASONS.has(classified.reasonCode)) {
            this.halt(classified.reasonCode, true);
        }
        return classified.reasonCode;
    }

    /**
     * Manifests, then the completion, then (after the caller built it) the run inventory, each only once what it names is on Drive.
     * Records the archive published are caught up from the archive's own bytes; records it did not (archive down, a refusal) are
     * queued in the outbox first and published from there, in this run or a later one. Nothing is rebuilt from anything but the
     * bytes that were built or published once.
     */
    async publishRecords(): Promise<void> {
        if (this.destination === null) return;
        const { config } = this.deps;
        const handled = new Set<string>();

        // 0. After a rebind: records an earlier revision still had queued are queued for this one too, from the same outbox bytes.
        await this.requeueFromEarlierRevisions();

        // 1. Records that wait in the outbox from an earlier run.
        const prefix = `${this.revision}|`;
        // Manifests first, then completions (which name them), then everything else, whatever order they were queued in.
        const kindRank = (key: string): number => (parseManifestKey(key) !== null ? 0 : COMPLETION_KEY.test(key) ? 1 : 2);
        const waiting = [...this.state.driveRecordsPending]
            .filter(([stateKey]) => stateKey.startsWith(prefix))
            .sort(([a], [b]) => kindRank(a.slice(prefix.length)) - kindRank(b.slice(prefix.length)));
        for (const [stateKey, sha256] of waiting) {
            const relativeKey = stateKey.slice(prefix.length);
            handled.add(relativeKey);
            if (!(await this.ready())) break;
            let bytes: Buffer | null;
            try {
                bytes = await readOutbox(config.control.path, sha256);
            } catch (error) {
                if (!(error instanceof WorkerError) || error.reasonCode !== "artifact-integrity") throw error;
                bytes = null;
            }
            if (bytes === null) {
                // Missing or damaged: the record stays pending and the run says so.
                this.failureReasons.add("artifact-integrity");
                continue;
            }
            if (COMPLETION_KEY.test(relativeKey) && !this.completionReady(bytes)) continue;
            // A manifest is only as good as the artifacts it names: they must be verified on THIS revision (a queued manifest may
            // come from an earlier revision), whatever route the manifest took here. Until then it stays pending.
            if (parseManifestKey(relativeKey) !== null && !this.manifestArtifactsVerified(relativeKey, bytes)) continue;
            await this.push(relativeKey, bytes, false);
        }

        // 2. The manifests this run built for documents whose artifacts are all on Drive.
        for (const candidate of this.work) {
            if (!this.allVerified(candidate.artifacts)) continue;
            const manifest = this.host.manifestOf(candidate);
            handled.add(manifest.key);
            if (this.onDrive(manifest.key, manifest.sha256) || this.state.driveRecordsPending.get(driveStateKey(this.revision, manifest.key)) === manifest.sha256) continue;
            const local = this.host.locallyPublished(manifest.key);
            if (local && this.host.archiveOk()) { handled.delete(manifest.key); continue; } // the archive's own file is caught up below
            const pushed = await this.push(manifest.key, manifest.bytes, !local);
            if (!pushed.ok) this.manifestFailures.set(candidate.documentId, pushed.reasonCode);
        }

        // 3. Manifests the archive published and Drive does not have yet, from the archive's bytes.
        if (this.host.archiveOk()) {
            for (const [key, acknowledged] of this.state.manifests) {
                if (handled.has(key) || this.onDrive(key, acknowledged.sha256)) continue;
                const parts = parseManifestKey(key);
                if (parts === null || parts.companyId !== config.companyId) continue;
                let bytes: Buffer | null;
                try {
                    bytes = await this.archive.readArchiveFile(key);
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    this.host.archiveLost();
                    break;
                }
                if (bytes === null || sha256Of(bytes) !== acknowledged.sha256) continue;
                if (!this.manifestArtifactsVerified(key, bytes)) continue;
                const pushed = await this.push(key, bytes, false);
                if (!pushed.ok) this.manifestFailures.set(parts.documentId, pushed.reasonCode);
                if (this.halted !== null) break;
            }
        }

        // 4. The completion of this run's snapshot. Bytes the archive did not publish are queued first (they exist nowhere else) and
        // go out only when every manifest they name is on Drive; a completion is built once and never rebuilt to leave a document out.
        const local = this.host.localCompletion();
        if (local !== null) {
            const locallyPublished = this.host.locallyPublished(local.key);
            if (!(locallyPublished && this.host.archiveOk())) {
                handled.add(local.key);
                if (!locallyPublished) await this.queue(local.key, local.bytes);
                if (this.completionReady(local.bytes)) await this.push(local.key, local.bytes, false);
            }
        } else if (!this.host.archiveOk()) {
            const context = this.host.completionContext();
            const built = context === null ? null : this.driveOnlyCompletion(context);
            if (built !== null) {
                handled.add(built.key);
                await this.queue(built.key, built.bytes);
                if (this.completionReady(built.bytes)) await this.push(built.key, built.bytes, false);
            }
        }

        // 5. Completions the archive published and Drive does not have yet, from the archive's bytes.
        if (this.host.archiveOk()) {
            for (const [key, acknowledged] of this.state.completions) {
                if (handled.has(key) || this.onDrive(key, acknowledged.sha256)) continue;
                let bytes: Buffer | null;
                try {
                    bytes = await this.archive.readArchiveFile(key);
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    this.host.archiveLost();
                    break;
                }
                if (bytes === null || sha256Of(bytes) !== acknowledged.sha256 || !this.completionReady(bytes)) continue;
                await this.push(key, bytes, false);
                if (this.halted !== null) break;
            }
        }

        // 6. Run inventories the archive published and Drive does not have yet (an earlier run's refused upload, or every earlier run
        // after a rebind), from the archive's own bytes. The ledger keeps no hash for them, so the bytes must be a run inventory of
        // exactly that run; a run that never published one has no file and costs one failed lookup.
        if (this.host.archiveOk()) {
            for (const runId of [...this.state.runs.keys()]) {
                if (this.halted !== null) break;
                const key = runKey({ companyId: config.companyId, runId });
                if (handled.has(key) || this.state.driveRecords.has(driveStateKey(this.revision, key))) continue;
                let bytes: Buffer | null;
                try {
                    bytes = await this.archive.readArchiveFile(key);
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                    this.host.archiveLost();
                    break;
                }
                if (bytes === null || !this.isInventoryOf(bytes, runId)) continue;
                handled.add(key);
                await this.push(key, bytes, false);
            }
        }
    }

    private isInventoryOf(bytes: Uint8Array, runId: string): boolean {
        try {
            const parsed = runInventorySchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
            return parsed.success && parsed.data.runId === runId;
        } catch {
            return false;
        }
    }

    /**
     * A rebind starts a new revision with nothing pending and nothing published. Records an earlier revision queued, or published from
     * the outbox, still have their original bytes there (the outbox keeps every file). Each one that is valid, and that this revision
     * neither has nor has pending, is queued again for this revision from those bytes, so the steps after this one publish it under the
     * new root, behind the same guards as every record (a manifest needs its artifacts verified here, a completion its manifests).
     */
    private async requeueFromEarlierRevisions(): Promise<void> {
        const prefix = `${this.revision}|`;
        const earlier = new Map<string, string>();
        const note = (stateKey: string, sha256: string): void => {
            if (stateKey.startsWith(prefix)) return;
            earlier.set(`${stateKey.slice(stateKey.indexOf("|") + 1)}|${sha256}`, sha256);
        };
        for (const [stateKey, sha256] of this.state.driveRecordsPending) note(stateKey, sha256);
        for (const [stateKey, record] of this.state.driveRecords) note(stateKey, record.sha256);
        for (const [mapKey, sha256] of [...earlier].sort(([a], [b]) => (a < b ? -1 : 1))) {
            const relativeKey = mapKey.slice(0, mapKey.lastIndexOf("|"));
            if (this.state.driveRecordsPending.has(driveStateKey(this.revision, relativeKey)) || this.state.driveRecords.has(driveStateKey(this.revision, relativeKey))) continue;
            let bytes: Buffer | null;
            try {
                bytes = await readOutbox(this.deps.config.control.path, sha256);
            } catch (error) {
                if (!(error instanceof WorkerError) || error.reasonCode !== "artifact-integrity") throw error;
                bytes = null;
            }
            if (bytes !== null && this.isRecordShape(relativeKey, bytes)) await this.queue(relativeKey, bytes);
        }
    }

    /** The bytes are a manifest, completion or run inventory that belongs under `relativeKey` (nothing else is ever queued). */
    private isRecordShape(relativeKey: string, bytes: Buffer): boolean {
        const manifest = parseManifestKey(relativeKey);
        if (manifest !== null) {
            if (manifest.companyId !== this.deps.config.companyId) return false;
            try {
                parseManifestBytes(bytes, relativeKey, { companyId: manifest.companyId, documentId: manifest.documentId, metadataRevision: manifest.metadataRevision });
                return true;
            } catch (error) {
                if (!(error instanceof WorkerError)) throw error;
                return false;
            }
        }
        if (COMPLETION_KEY.test(relativeKey)) {
            try { return completionSchema.safeParse(JSON.parse(bytes.toString("utf8"))).success; } catch { return false; }
        }
        const run = /\/runs\/([0-9a-f-]{36})\.json$/.exec(relativeKey);
        return run !== null && this.isInventoryOf(bytes, run[1]!);
    }

    /**
     * The completion of a snapshot whose local one could not be written: the documents whose artifacts are all on Drive (their manifests are
     * published first, and the completion is withheld until they are), and a gap with its reason for every other document the snapshot includes (the local rules). `null` when there is
     * nothing to say.
     */
    private driveOnlyCompletion(context: DriveCompletionContext): DriveBuiltRecord | null {
        const entries: Array<{ documentId: string; metadataRevision: string; manifestSha256: string; manifestKey: string }> = [];
        for (const candidate of this.work) {
            if (!this.allVerified(candidate.artifacts)) continue;
            const manifest = this.host.manifestOf(candidate);
            entries.push({ documentId: candidate.documentId, metadataRevision: candidate.metadataRevision, manifestSha256: manifest.sha256, manifestKey: manifest.key });
        }
        const present = new Set(entries.map((entry) => entry.documentId));
        const omissions: Array<{ documentId: string; reasonCode: WorkerReasonCode }> = [];
        for (const [documentId, reasonCode] of context.blockedDocuments) omissions.push({ documentId, reasonCode });
        for (const documentId of context.emptyDocuments) if (!present.has(documentId)) omissions.push({ documentId, reasonCode: "artifact-pending" });
        for (const candidate of this.work) {
            if (present.has(candidate.documentId)) continue;
            omissions.push({ documentId: candidate.documentId, reasonCode: this.pendingReason(candidate) });
        }
        if (entries.length === 0 && omissions.length === 0) return null;
        const completion = buildCompletion({
            companyId: context.companyId, sequence: context.sequence, snapshotId: context.snapshotId, runId: context.runId,
            scopeRevision: context.scopeRevision, policyRevision: context.policyRevision,
            destinationIdentity: context.localIdentity, destinationRevision: context.localRevision,
            entries, gaps: [...context.stateGaps, ...omissions],
        });
        return { key: completion.relativeKey, bytes: completion.bytes, sha256: completion.sha256 };
    }

    /** What the Drive ledger says about the first artifact of the candidate that is not verified, else why its manifest is not there. */
    private pendingReason(candidate: DriveCandidate): WorkerReasonCode {
        for (const job of candidate.artifacts) {
            const entry = this.dl.entryOf(job.artifactIdentity);
            if (entry?.state === "verified") continue;
            return entry?.reasonCode ?? (entry?.state === "integrity_error" ? "artifact-integrity" : "artifact-pending");
        }
        return this.manifestFailures.get(candidate.documentId) ?? "artifact-pending";
    }

    /** The run inventory: queued first when the archive did not publish it, then sent; a failure here changes nothing the run reports. */
    async publishInventory(inventory: DriveBuiltRecord, locallyPublished: boolean): Promise<void> {
        // Archive down: these bytes exist nowhere else, so they are made durable before Drive is asked. Archive up: the archive's file
        // is the durable copy, and only a refusal queues the bytes (a crash in between is caught up from the archive next run).
        // Either way an unusable Drive (no destination, closed gate, refusal) leaves the record pending for the next run.
        if (!locallyPublished) await this.queue(inventory.key, inventory.bytes);
        const pushed = this.destination === null ? { ok: false as const } : await this.push(inventory.key, inventory.bytes, false);
        if (locallyPublished && !pushed.ok) await this.queue(inventory.key, inventory.bytes);
    }

    // ---- hook 6: what the run reports ------------------------------------------------------------------------------------

    /** The Drive entries the run reports on: this run's artifacts, and every other current-revision entry that still has work to do. */
    private reported(): Array<{ entry: DestinationEntry; inWork: boolean }> {
        const inWork = new Set(this.work.flatMap((candidate) => candidate.artifacts.map((job) => job.artifactIdentity)));
        const seen = new Set<string>();
        const reported: Array<{ entry: DestinationEntry; inWork: boolean }> = [];
        for (const candidate of this.work) {
            for (const job of candidate.artifacts) {
                const entry = this.dl.entryOf(job.artifactIdentity);
                if (entry === undefined || seen.has(job.artifactIdentity)) continue;
                seen.add(job.artifactIdentity);
                reported.push({ entry, inWork: true });
            }
        }
        for (const entry of this.entries()) {
            if (seen.has(entry.artifactIdentity) || !(open(entry) || entry.state === "integrity_error")) continue;
            reported.push({ entry, inWork: inWork.has(entry.artifactIdentity) });
        }
        return reported;
    }

    counts(): Pick<RunCounts, "driveVerified" | "driveBlocked" | "driveRetryWait" | "driveIntegrityError"> {
        const counts = { driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 };
        for (const { entry, inWork } of this.reported()) {
            if (entry.state === "verified") { if (inWork) counts.driveVerified += 1; }
            else if (entry.state === "blocked") counts.driveBlocked += 1;
            else if (entry.state === "retry_wait") counts.driveRetryWait += 1;
            else if (entry.state === "integrity_error") counts.driveIntegrityError += 1;
        }
        return counts;
    }

    /** The reason codes of the Drive entries that ended blocked, waiting or in error, and of the records that could not be published. */
    entryReasons(): WorkerReasonCode[] {
        const reasons = new Set<WorkerReasonCode>(this.failureReasons);
        for (const { entry } of this.reported()) {
            if ((entry.state === "blocked" || entry.state === "retry_wait" || entry.state === "integrity_error") && entry.reasonCode !== null) reasons.add(entry.reasonCode);
        }
        return [...reasons].sort();
    }
}
