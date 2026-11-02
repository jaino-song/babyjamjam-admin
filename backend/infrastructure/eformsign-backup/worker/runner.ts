import { promises as fs } from "node:fs";

import {
    WorkerError, destinationKey, driveDestinationIdentity, driveDestinationRevision, driveStateKey, identifier, isDriveDestinationIdentity,
    type DriveBinding, type Installation,
} from "domain/eformsign-backup/worker";
import { DriveDestination, driveReasonCode, type DriveBinding as DriveDestinationBinding, type DriveStep } from "./drive-destination";
import { executeRecover, executeVerify } from "./runner-recover";
import {
    ARCHIVE_MARKER_FILE, controlMarkerWriter, ledgerDriveNodes, nowIso, parseMarker, readArchiveMarker, requireInstallation,
} from "./runner-common";
import { executeRun } from "./runner-run";
import {
    LOCAL_DESTINATION_REVISION, localDestinationIdentity,
    type DriveSetupSummary, type InitSummary, type InspectSummary, type RecoverSummary, type RunSummary, type RunnerDependencies,
    type VerifySummary, type WorkerRunnerPort,
} from "./runner-types";

export { controlMarkerWriter };
export type { RunSummary };

/** The value of a Drive step, or the `WorkerError` whose reason code is the contract's for that failure (or `drive-conflict` for a conflict). */
function settle<T>(step: DriveStep<T>): T {
    if (step.ok) return step.value;
    throw new WorkerError("failure" in step ? driveReasonCode(step.failure) : "drive-conflict");
}

function driveDestinationBinding(binding: DriveBinding, installation: Installation): DriveDestinationBinding {
    return {
        rootFolderId: binding.rootFolderId, rootName: binding.rootName, rootParentId: binding.rootParentId, bindingId: binding.bindingId,
        installationId: installation.installationId, archiveId: installation.archiveId,
    };
}

function summaryOf(binding: DriveBinding): DriveSetupSummary {
    return { rootFolderId: binding.rootFolderId, destinationRevision: binding.destinationRevision };
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
        return executeVerify(this.deps, options);
    }

    async recover(options: { installationId: string; driveRootFolderId?: string }): Promise<RecoverSummary> {
        return executeRecover(this.deps, options);
    }

    /**
     * Binds the Google Drive root of this installation, durably and resumably (BJJ-456 A2.2). The order is: resolve the parent
     * and the account, take a root id from Drive, append `drive_bound` (status `pending`), create the root under that id, publish
     * the archive marker on Drive, append `drive_ready`. A `pending` binding is resumed with the same root id; a `ready` one whose
     * root is intact and whose marker is on Drive changes nothing; a changed root is refused unless `rebind` binds a new one.
     */
    async driveSetup(options: { rebind: boolean }): Promise<DriveSetupSummary> {
        const { deps } = this;
        const installation = requireInstallation(deps);
        if (deps.drive === null) throw new WorkerError("drive-not-configured");
        let binding = installation.drive;
        const resuming = binding !== null && !options.rebind;
        const markerPublished = (revision: string): boolean => deps.ledger.state.driveRecords.has(driveStateKey(revision, ARCHIVE_MARKER_FILE));

        if (binding !== null && resuming && binding.status === "ready") {
            const root = settle(await deps.createDriveDestination(driveDestinationBinding(binding, installation)).checkRoot());
            if (root === "changed") throw new WorkerError("drive-root-changed");
            if (markerPublished(binding.destinationRevision)) return summaryOf(binding);
        }
        // Everything below publishes something, so the marker is read first: an archive that cannot give it stops us before Drive is touched.
        const marker = await this.readLocalMarker(installation);
        if (binding === null || !resuming) binding = await this.bindNewRoot();
        const { client } = deps.drive;
        const revision = binding.destinationRevision;
        const bound = driveDestinationBinding(binding, installation);

        await deps.runnerFault?.("drive-setup-after-bound");
        if (binding.status === "pending") {
            settle(await DriveDestination.createRootWithId(client, {
                id: binding.rootFolderId, name: binding.rootName, parentId: binding.rootParentId,
                installationId: installation.installationId, archiveId: installation.archiveId, bindingId: binding.bindingId,
            }));
        }
        await deps.runnerFault?.("drive-setup-after-root");
        if (!markerPublished(revision)) {
            const published = settle(await deps.createDriveDestination(bound).publishJson(ARCHIVE_MARKER_FILE, marker, ledgerDriveNodes(deps, revision)));
            await deps.ledger.append("drive_record_published", {
                destinationRevision: revision, relativeKey: ARCHIVE_MARKER_FILE, sha256: published.sha256, fileId: published.fileId,
            }, nowIso(deps));
        }
        if (binding.status === "pending") await deps.ledger.append("drive_ready", { destinationRevision: revision }, nowIso(deps));
        return summaryOf(binding);
    }

    inspect(): InspectSummary {
        const { ledger } = this.deps;
        const counts: Record<string, number> = {
            verified: 0, blocked: 0, retryWait: 0, integrityError: 0, pending: 0, transferring: 0, verifying: 0,
            terminalUnavailable: ledger.state.terminalUnavailable.size, runs: ledger.state.runs.size, openRuns: 0,
        };
        // The top-level counts are the local archive's; Drive entries (any revision) are counted separately below.
        for (const entry of ledger.state.destinations.values()) {
            if (isDriveDestinationIdentity(entry.destinationIdentity)) continue;
            const key = entry.state === "retry_wait" ? "retryWait" : entry.state === "integrity_error" ? "integrityError" : entry.state;
            if (key in counts) counts[key] = (counts[key] ?? 0) + 1;
        }
        for (const run of ledger.state.runs.values()) if (run.status === "open") counts["openRuns"] = (counts["openRuns"] ?? 0) + 1;
        const installation = ledger.state.installation;
        if (installation?.drive != null) Object.assign(counts, this.driveCounts(installation, installation.drive));
        return { status: ledger.status, reasons: [...ledger.reasons], lastSeq: ledger.lastSeq, counts };
    }

    /** Counts of the CURRENT Drive revision only (an earlier binding's results are never carried over), and what staging may drop. */
    private driveCounts(installation: Installation, drive: DriveBinding): Record<string, number> {
        const { destinations } = this.deps.ledger.state;
        const counts = { driveBound: drive.status === "ready" ? 1 : 0, driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0, stagingReleasable: 0 };
        for (const entry of destinations.values()) {
            if (entry.destinationIdentity !== drive.destinationIdentity || entry.destinationRevision !== drive.destinationRevision) continue;
            if (entry.state === "verified") counts.driveVerified += 1;
            else if (entry.state === "blocked") counts.driveBlocked += 1;
            else if (entry.state === "retry_wait") counts.driveRetryWait += 1;
            else if (entry.state === "integrity_error") counts.driveIntegrityError += 1;
        }
        for (const entry of destinations.values()) {
            if (entry.destinationIdentity !== installation.destinationIdentity || entry.destinationRevision !== installation.destinationRevision) continue;
            if (entry.state !== "verified") continue;
            const onDrive = destinations.get(destinationKey(entry.artifactIdentity, drive.destinationIdentity, drive.destinationRevision));
            if (onDrive?.state === "verified") counts.stagingReleasable += 1;
        }
        return counts;
    }

    /** The archive marker exactly as it is on disk (it is mirrored byte for byte). An archive that cannot give it is `archive-unavailable`. */
    private async readLocalMarker(installation: Installation): Promise<Buffer> {
        const archive = this.deps.createDestination({ dev: installation.archiveDev, ino: installation.archiveIno });
        let bytes: Buffer | null;
        try {
            bytes = await archive.readArchiveFile(ARCHIVE_MARKER_FILE);
        } catch (error) {
            throw error instanceof WorkerError ? error : new WorkerError("archive-unavailable");
        }
        const marker = parseMarker(bytes);
        if (bytes === null || marker === null) throw new WorkerError("archive-unavailable");
        if (marker.installationId !== installation.installationId || marker.archiveId !== installation.archiveId) throw new WorkerError("recovery-required");
        return bytes;
    }

    /** Takes a root id from Drive and appends `drive_bound` for it (status `pending`): nothing is created on Drive yet. */
    private async bindNewRoot(): Promise<DriveBinding> {
        const { deps } = this;
        const { client, settings } = deps.drive!;
        const parent = settle(await client.getFile("root"));
        if (parent === null) throw new WorkerError("drive-unavailable");
        const account = settle(await client.about());
        if (!identifier.safeParse(account.permissionId).success) throw new WorkerError("drive-conflict");
        const rootFolderId = settle(await client.generateIds(1))[0]!;
        const bindingId = deps.uuid();
        await deps.ledger.append("drive_bound", {
            destinationIdentity: driveDestinationIdentity(rootFolderId), destinationRevision: driveDestinationRevision(bindingId), bindingId,
            rootFolderId, rootName: settings.rootFolderName, rootParentId: parent.id, accountId: account.permissionId,
        }, nowIso(deps));
        const bound = deps.ledger.state.installation?.drive;
        if (bound === null || bound === undefined || bound.bindingId !== bindingId) throw new WorkerError("ledger-inconsistent");
        return bound;
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
