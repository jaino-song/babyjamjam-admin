import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import {
    WorkerError, destinationKey, integrityErrorCount, isoUtc, transitionDestination,
    type DestinationEntry, type DestinationState, type Installation, type LedgerBodies, type LedgerState,
    type TransitionContext, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { publishBytesNoClobber } from "./atomic-file";
import { hasRoom } from "./fs-probe";
import type { InstallationMarker } from "./ledger-replay";
import type { LocalDestination } from "./local-destination";
import { ZERO_COUNTS, type RunnerDependencies } from "./runner-types";

export const ARCHIVE_MARKER_FILE = ".bjj-backup/installation.json";
export const WORKER_STAGING_NAME = /^[0-9a-f]{64}\.bin$/;
export const VERIFY_STALE_MS = 7 * 24 * 3600 * 1000;
export const SNAPSHOT_POLL_MS = 5000;
export const SNAPSHOT_POLL_LIMIT = 3;
export const TRANSIENT_STOP = 3;

/** Failure codes that mean the ARCHIVE side cannot be used right now (matrix: control fine, archive broken). */
const ARCHIVE_SIDE: ReadonlySet<WorkerReasonCode> = new Set([
    "archive-unavailable", "archive-identity-mismatch", "archive-marker-invalid", "archive-space", "archive-not-mount-point",
    "archive-unsafe-path", "unsupported-filesystem",
]);
export function isArchiveSide(code: WorkerReasonCode): boolean {
    return ARCHIVE_SIDE.has(code);
}

export function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** The control marker is written with the same no-clobber primitive as the archive marker (brief item 0). */
export async function controlMarkerWriter(dir: string, name: string, bytes: Uint8Array): Promise<void> {
    await publishBytesNoClobber(dir, name, bytes, { ioReasonCode: "control-unavailable" });
}

export function parseMarker(bytes: Buffer | null): InstallationMarker | null {
    if (bytes === null) return null;
    try {
        const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        if (value["schemaVersion"] !== 1 || typeof value["installationId"] !== "string" || typeof value["archiveId"] !== "string"
            || !isoUtc.safeParse(value["createdAt"]).success || Object.keys(value).length !== 4) return null;
        return value as unknown as InstallationMarker;
    } catch {
        return null;
    }
}

export function nowIso(deps: RunnerDependencies): string {
    return deps.clock.now().toISOString();
}

/** Contract W7: the ledger may use only a quarter of the reserve, so a full staging area can never stop the journal. */
export async function controlHasLedgerRoom(deps: RunnerDependencies): Promise<boolean> {
    const { control } = deps.config;
    return hasRoom(deps.probe, control.path, 0, Math.floor(control.reserveBytes / 4), Math.floor(control.reserveInodes / 4), "control-unavailable");
}
export async function assertLedgerRoom(deps: RunnerDependencies): Promise<void> {
    if (!(await controlHasLedgerRoom(deps))) throw new WorkerError("control-space");
}
export async function controlHasStagingRoom(deps: RunnerDependencies, byteLength: number): Promise<boolean> {
    const { control } = deps.config;
    return hasRoom(deps.probe, control.path, byteLength, control.reserveBytes, control.reserveInodes, "control-unavailable");
}

export function requireInstallation(deps: RunnerDependencies): Installation {
    const { ledger } = deps;
    if (ledger.status === "not_initialized") throw new WorkerError("not-initialized");
    if (ledger.status === "recovery_required") throw new WorkerError("recovery-required");
    const installation = ledger.state.installation;
    if (installation === null) throw new WorkerError("ledger-inconsistent");
    return installation;
}

/** Marker of the archive, `null` when it is missing or unreadable (that is an archive fault, not a different installation). */
export async function readArchiveMarker(destination: LocalDestination): Promise<InstallationMarker | null> {
    try {
        return parseMarker(await destination.readArchiveFile(ARCHIVE_MARKER_FILE));
    } catch {
        return null;
    }
}

/** An archive marker that names ANOTHER installation is `recovery_required`, not an archive fault (contract W2). */
export async function assertSameInstallation(destination: LocalDestination, installation: Installation): Promise<void> {
    const marker = await readArchiveMarker(destination);
    if (marker !== null && (marker.installationId !== installation.installationId || marker.archiveId !== installation.archiveId)) {
        throw new WorkerError("recovery-required");
    }
}

export class DestinationLedger {
    constructor(readonly deps: RunnerDependencies, readonly installation: Installation) {}

    get state(): LedgerState { return this.deps.ledger.state; }
    get destinationIdentity(): string { return this.installation.destinationIdentity; }
    get destinationRevision(): string { return this.installation.destinationRevision; }

    entryOf(artifactIdentity: string): DestinationEntry | undefined {
        return this.state.destinations.get(destinationKey(artifactIdentity, this.destinationIdentity, this.destinationRevision));
    }

    /** One validated destination transition. An illegal edge throws before anything is written. */
    async transition(
        artifactIdentity: string, to: DestinationState,
        extra: { reasonCode?: WorkerReasonCode | null; nextRetryAt?: string | null; relativeKey?: string | null; attempts?: number } = {},
    ): Promise<void> {
        const entry = this.entryOf(artifactIdentity);
        const from = entry?.state ?? null;
        const at = nowIso(this.deps);
        const context: TransitionContext = {
            now: at,
            nextRetryAt: entry?.nextRetryAt ?? null,
            integrityErrorCount: entry === undefined ? 0 : integrityErrorCount(entry),
            fromDestinationRevision: entry?.destinationRevision,
            destinationRevision: this.destinationRevision,
        };
        transitionDestination(from, to, context);
        const attempts = extra.attempts ?? entry?.attempts ?? 0;
        const body: LedgerBodies["destination_transition"] = {
            artifactIdentity,
            destinationIdentity: this.destinationIdentity,
            destinationRevision: this.destinationRevision,
            from,
            to,
            reasonCode: extra.reasonCode ?? null,
            attempts,
            nextRetryAt: extra.nextRetryAt ?? null,
            relativeKey: extra.relativeKey ?? null,
        };
        await this.deps.ledger.append("destination_transition", body, at);
    }
}

/** True when the entry belongs to a gap that can never be fetched again (the bytes are gone at the source). */
export function isTerminalReason(code: WorkerReasonCode | null): boolean {
    return code === "source-removed" || code === "exact-bytes-unavailable";
}

export async function countOrphanTemps(stagingPath: string): Promise<number> {
    try {
        return (await fs.readdir(stagingPath)).filter((name) => !WORKER_STAGING_NAME.test(name)).length;
    } catch {
        return ZERO_COUNTS.orphanTemps;
    }
}
