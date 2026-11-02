import { promises as fs } from "node:fs";

import { WorkerError } from "domain/eformsign-backup/worker";
import { executeRecover, executeVerify } from "./runner-recover";
import { controlMarkerWriter, readArchiveMarker } from "./runner-common";
import { executeRun } from "./runner-run";
import {
    LOCAL_DESTINATION_REVISION, localDestinationIdentity,
    type InitSummary, type InspectSummary, type RecoverSummary, type RunSummary, type RunnerDependencies, type VerifySummary,
    type WorkerRunnerPort,
} from "./runner-types";

export { controlMarkerWriter };
export type { RunSummary };

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
        return executeVerify(this.deps, options);
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
