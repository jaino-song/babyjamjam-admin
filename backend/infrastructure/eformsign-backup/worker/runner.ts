import { promises as fs } from "node:fs";

import { WorkerError, parseManifestKey } from "domain/eformsign-backup/worker";
import { executeRecover, executeVerify } from "./runner-recover";
import { parseManifestBytes } from "./restore";
import { controlMarkerWriter, isArchiveSide, readArchiveMarker, requireInstallation } from "./runner-common";
import { completionBindings, executeRun } from "./runner-run";
import {
    LOCAL_DESTINATION_REVISION, localDestinationIdentity,
    type InitSummary, type InspectSummary, type RecoverSummary, type RunSummary, type RunnerDependencies, type VerifySummary,
    type WorkerRunnerPort,
} from "./runner-types";

export { controlMarkerWriter };
export type { RunSummary };

/**
 * `verify --all`: every manifest the ledger acknowledged or a valid completion names must be on the archive, a valid
 * manifest of its document, and have the digest each of them binds. Read-only: nothing is repaired, quarantined or written,
 * and each bound manifest is read once. A missing, unreadable or mismatching one is an `archive-conflict` (exit 69
 * through the unchanged exit mapping); `run` republishes a missing one it can rebuild, damage to a present one is only
 * ever reported here. Without `--all` the check does not run: plain `verify` keeps its PDF-only scope.
 */
async function assertBoundManifests(deps: RunnerDependencies): Promise<void> {
    const installation = requireInstallation(deps);
    const archive = deps.createDestination({ dev: installation.archiveDev, ino: installation.archiveIno });
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
            if (isArchiveSide(error.reasonCode)) throw error; // the archive itself is not usable: not this file's fault
            damaged += 1;
        }
    }
    if (damaged > 0) throw new WorkerError("archive-conflict");
}

/** The worker's commands (contract section 3). Every one of them assumes the caller holds the worker lock. */
export class WorkerRunner implements WorkerRunnerPort {
    constructor(private readonly deps: RunnerDependencies) {}

    /** Writes the archive marker, then the control marker and the first ledger record. Refuses to touch an installed or half-installed system. */
    async init(): Promise<InitSummary> {
        const { deps } = this;
        const { ledger, config } = deps;
        if (ledger.status === "recovery_required") throw new WorkerError("recovery-required");
        if (ledger.status !== "not_initialized") throw new WorkerError("ledger-duplicate-install");
        let stat;
        try {
            stat = await fs.lstat(config.archive.path);
        } catch {
            throw new WorkerError("archive-unavailable");
        }
        const installationId = deps.uuid();
        const createdAt = deps.clock.now().toISOString();
        const destination = deps.createDestination({ dev: stat.dev, ino: stat.ino });
        const written = await destination.writeMarker({ schemaVersion: 1, installationId, archiveId: config.archive.archiveId, createdAt });
        if (!written.ok) throw new WorkerError(written.reasonCode);
        await ledger.initialize({
            installationId, archiveId: config.archive.archiveId, createdAt,
            installedBody: {
                archiveDev: stat.dev, archiveIno: stat.ino,
                destinationIdentity: localDestinationIdentity(config.archive.archiveId), destinationRevision: LOCAL_DESTINATION_REVISION,
            },
        });
        return { outcome: "finished", installationId };
    }

    async run(options: { scheduledFor?: string | null } = {}): Promise<RunSummary> {
        await this.refuseHalfInstalled();
        return executeRun(this.deps, options);
    }

    async verify(options: { all: boolean }): Promise<VerifySummary> {
        await this.refuseHalfInstalled();
        const summary = await executeVerify(this.deps, options);
        if (options.all && summary.outcome === "finished" && summary.archiveAvailable) await assertBoundManifests(this.deps);
        return summary;
    }

    async recover(options: { installationId: string }): Promise<RecoverSummary> {
        return executeRecover(this.deps, options);
    }

    inspect(): InspectSummary {
        const { ledger } = this.deps;
        const counts: Record<string, number> = {
            verified: 0, blocked: 0, retryWait: 0, integrityError: 0, pending: 0, transferring: 0, verifying: 0,
            terminalUnavailable: ledger.state.terminalUnavailable.size, runs: ledger.state.runs.size, openRuns: 0,
        };
        for (const entry of ledger.state.destinations.values()) {
            const key = entry.state === "retry_wait" ? "retryWait" : entry.state === "integrity_error" ? "integrityError" : entry.state;
            if (key in counts) counts[key] = (counts[key] ?? 0) + 1;
        }
        for (const run of ledger.state.runs.values()) if (run.status === "open") counts["openRuns"] = (counts["openRuns"] ?? 0) + 1;
        return { status: ledger.status, reasons: [...ledger.reasons], lastSeq: ledger.lastSeq, counts };
    }

    /** An archive that already carries a marker while this worker has no installation is half-installed: `recover` decides, not `run`. */
    private async refuseHalfInstalled(): Promise<void> {
        const { deps } = this;
        if (deps.ledger.status !== "not_initialized") return;
        let stat;
        try {
            stat = await fs.lstat(deps.config.archive.path);
        } catch {
            return;
        }
        const marker = await readArchiveMarker(deps.createDestination({ dev: stat.dev, ino: stat.ino }));
        if (marker !== null) throw new WorkerError("recovery-required");
    }
}
