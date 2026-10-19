import { promises as fs } from "node:fs";
import path from "node:path";

import {
    WorkerError, completionContentDigest, completionSchema, decodeLedgerLine, judgeHistoricalCoverage, manifestSchema,
    parseCompletionName, type KnownGap, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { decodeCheckpoint } from "./ledger-checkpoint";
import { CHECKPOINT_NAME, LEDGER_DIR_NAME, MARKER_NAME, encodeMarker } from "./ledger-replay";
import type { LocalDestination } from "./local-destination";
import {
    DestinationLedger, VERIFY_STALE_MS, assertSameInstallation, controlMarkerWriter, nowIso, parseMarker, readArchiveMarker,
    requireInstallation, sha256Hex,
} from "./runner-common";
import {
    LOCAL_DESTINATION_REVISION, ZERO_COUNTS, localDestinationIdentity, type RecoverSummary, type RunnerDependencies, type VerifySummary,
} from "./runner-types";

const JOURNAL_NAME = /^journal-\d{12}\.jsonl$/;

async function readIfPresent(file: string): Promise<Buffer | null> {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile()) return null;
        return await fs.readFile(file);
    } catch {
        return null;
    }
}

/** `verify` (contract section 3): re-hash verified entries; the ledger changes only for what is proven damaged. */
export async function executeVerify(deps: RunnerDependencies, options: { all: boolean }): Promise<VerifySummary> {
    const installation = requireInstallation(deps);
    const archive = deps.createDestination({ dev: installation.archiveDev, ino: installation.archiveIno });
    await assertSameInstallation(archive, installation);
    const runId = deps.uuid();
    const startedAt = nowIso(deps);
    await deps.ledger.append("run_started", { runId, scheduledFor: null, startedAt }, startedAt);
    const finish = async (
        snapshotStatus: "partial" | "blocked", reasonCodes: WorkerReasonCode[],
    ): Promise<void> => {
        const at = nowIso(deps);
        await deps.ledger.append("run_finished", {
            runId, finishedAt: at, snapshotStatus, historicalCoverage: judgeHistoricalCoverage(deps.ledger.state), reasonCodes,
            counts: { ...ZERO_COUNTS },
        }, at);
    };

    const check = await archive.checkArchive(0);
    if (!check.ok) {
        await finish("blocked", ["archive-unavailable"]);
        return { outcome: "finished", runId, checked: 0, integrityErrors: 0, archiveAvailable: false };
    }
    const now = deps.clock.now().getTime();
    const due = [...deps.ledger.state.destinations.values()].filter((entry) => {
        if (entry.destinationIdentity !== installation.destinationIdentity || entry.destinationRevision !== installation.destinationRevision) return false;
        if (entry.state !== "verified") return false;
        if (options.all || entry.lastVerifiedAt === null) return true;
        return now - Date.parse(entry.lastVerifiedAt) >= VERIFY_STALE_MS;
    });
    const damaged: Array<{ artifactIdentity: string; relativeKey: string | null }> = [];
    let checked = 0;
    let archiveAvailable = true;
    for (const entry of due) {
        const info = deps.ledger.state.artifacts.get(entry.artifactIdentity);
        const relativeKey = entry.relativeKey;
        if (info === undefined || relativeKey === null) continue;
        try {
            const found = info.byteLength === null
                ? await rehash(archive, relativeKey, info.sha256)
                : await archive.reverify(relativeKey, info.sha256, info.byteLength);
            checked += 1;
            if (found === "missing") damaged.push({ artifactIdentity: entry.artifactIdentity, relativeKey: null });
            else if (found === "mismatch") damaged.push({ artifactIdentity: entry.artifactIdentity, relativeKey });
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            archiveAvailable = false;
            break;
        }
    }
    if (!archiveAvailable) {
        // The archive went away part way: nothing found so far is trusted, no transition is written.
        await finish("blocked", ["archive-unavailable"]);
        return { outcome: "finished", runId, checked: 0, integrityErrors: 0, archiveAvailable: false };
    }
    const dl = new DestinationLedger(deps, installation);
    for (const item of damaged) {
        const entry = dl.entryOf(item.artifactIdentity);
        const relativeKey = entry?.relativeKey ?? item.relativeKey;
        if (item.relativeKey !== null) {
            try {
                await archive.quarantineCorrupt(item.relativeKey, runId);
            } catch (error) {
                if (!(error instanceof WorkerError)) throw error;
                continue;
            }
        }
        await dl.transition(item.artifactIdentity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey });
    }
    await finish("partial", []);
    return { outcome: "finished", runId, checked, integrityErrors: damaged.length, archiveAvailable: true };
}

async function rehash(archive: LocalDestination, relativeKey: string, sha256: string): Promise<"ok" | "missing" | "mismatch"> {
    const bytes = await archive.readArchiveFile(relativeKey);
    if (bytes === null) return "missing";
    return sha256Hex(bytes) === sha256 ? "ok" : "mismatch";
}

/** The installation the damaged ledger last described, when any of it can still be read (best effort, never trusted alone). */
interface PriorInstallation { installationId: string; archiveDev: number; archiveIno: number }

async function readPriorInstallation(controlPath: string): Promise<PriorInstallation | null> {
    const ledgerDir = path.join(controlPath, LEDGER_DIR_NAME);
    const checkpoint = await readIfPresent(path.join(ledgerDir, CHECKPOINT_NAME));
    const restored = checkpoint === null ? null : decodeCheckpoint(checkpoint);
    if (restored?.installation) {
        const { installationId, archiveDev, archiveIno } = restored.installation;
        return { installationId, archiveDev, archiveIno };
    }
    let names: string[];
    try {
        names = (await fs.readdir(ledgerDir)).filter((name) => JOURNAL_NAME.test(name)).sort();
    } catch {
        return null;
    }
    for (const name of names) {
        const bytes = await readIfPresent(path.join(ledgerDir, name));
        const first = bytes?.toString("utf8").split("\n")[0];
        if (first === undefined || first === "") continue;
        const decoded = decodeLedgerLine(first);
        if (decoded.ok && decoded.record.type === "installed") {
            const { installationId, archiveDev, archiveIno } = decoded.record.body;
            return { installationId, archiveDev, archiveIno };
        }
    }
    return null;
}

interface CompletionFacts {
    floor: number;
    gaps: KnownGap[];
    valid: Array<ReturnType<typeof completionSchema.parse>>;
}

async function readCompletionFacts(archive: LocalDestination, companyId: string): Promise<CompletionFacts> {
    const files = await archive.listCompletions(companyId);
    let floor = 0;
    const valid: CompletionFacts["valid"] = [];
    const gaps = new Map<string, KnownGap>();
    for (const file of files) {
        const parsedName = parseCompletionName(file.name);
        if (parsedName === null) continue;
        floor = Math.max(floor, parsedName.sequence);
        const content = completionSchema.safeParse(file.content);
        if (!content.success || content.data.companyId !== companyId || content.data.sequence !== parsedName.sequence
            || completionContentDigest(content.data) !== parsedName.contentDigest) continue;
        valid.push(content.data);
        for (const gap of content.data.gaps) gaps.set(`${gap.documentId}\u0000${gap.reasonCode}`, { documentId: gap.documentId, artifactIdentity: null, reasonCode: gap.reasonCode });
    }
    const known = [...gaps.values()].sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : a.reasonCode < b.reasonCode ? -1 : 1));
    return { floor, gaps: known, valid };
}

/**
 * `recover` (contract section 3): builds a new ledger from what the archive itself proves. It refuses, changing nothing,
 * unless the archive is the one that was installed and the operator named its installation id.
 */
export async function executeRecover(deps: RunnerDependencies, options: { installationId: string }): Promise<RecoverSummary> {
    const { config } = deps;
    const initialStatus = deps.ledger.status;
    if (initialStatus === "ok") throw new WorkerError("ledger-inconsistent");

    const prior = await readPriorInstallation(config.control.path);
    let current;
    try {
        current = await fs.lstat(config.archive.path);
    } catch {
        throw new WorkerError("archive-unavailable");
    }
    const expected = prior === null ? { dev: current.dev, ino: current.ino } : { dev: prior.archiveDev, ino: prior.archiveIno };
    const archive = deps.createDestination(expected);
    const check = await archive.checkArchive(0);
    if (!check.ok) throw new WorkerError(check.reasonCode);
    const marker = await readArchiveMarker(archive);
    if (marker === null) throw new WorkerError("archive-marker-invalid");
    if (marker.installationId !== options.installationId || marker.archiveId !== config.archive.archiveId
        || (prior !== null && prior.installationId !== options.installationId)) {
        throw new WorkerError("archive-identity-mismatch");
    }

    const controlMarkerPath = path.join(config.control.path, MARKER_NAME);
    let controlMarkerBytes: Buffer | null = null;
    try {
        controlMarkerBytes = await fs.readFile(controlMarkerPath);
    } catch (error) {
        if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new WorkerError("control-unavailable");
    }
    if (controlMarkerBytes !== null) {
        const control = parseMarker(controlMarkerBytes);
        if (control === null) throw new WorkerError("recovery-required");
        if (control.installationId !== marker.installationId || control.archiveId !== marker.archiveId) throw new WorkerError("archive-identity-mismatch");
    } else {
        await controlMarkerWriter(config.control.path, MARKER_NAME, encodeMarker(marker));
        if (deps.reopenLedger === undefined) throw new WorkerError("internal");
        await deps.ledger.close();
        deps.ledger = await deps.reopenLedger();
        if (deps.ledger.status === "ok") return { outcome: "finished", recovered: 0, unverified: 0, sequenceFloor: deps.ledger.state.lastSeq, knownGaps: 0 };
    }
    if (deps.ledger.status !== "recovery_required") throw new WorkerError("ledger-inconsistent");

    const facts = await readCompletionFacts(archive, config.companyId);
    const runId = deps.uuid();
    await deps.ledger.quarantineAndReset(runId);
    const at = nowIso(deps);
    await deps.ledger.append("recovery_started", {
        installationId: marker.installationId, archiveId: marker.archiveId, archiveDev: current.dev, archiveIno: current.ino,
        destinationIdentity: localDestinationIdentity(marker.archiveId), destinationRevision: LOCAL_DESTINATION_REVISION,
        priorLedgerName: `ledger.quarantine-${runId}`, sequenceFloor: facts.floor, knownGaps: facts.gaps,
    }, at);

    let recovered = 0;
    let unverified = 0;
    const seen = new Set<string>();
    for (const completion of facts.valid) {
        for (const entry of completion.entries) {
            const found = await verifyManifest(archive, entry);
            if (found === null) {
                unverified += 1;
                continue;
            }
            for (const artifact of found.artifacts) {
                if (seen.has(artifact.artifactIdentity)) continue;
                seen.add(artifact.artifactIdentity);
                let state: "ok" | "missing" | "mismatch" = "missing";
                try {
                    state = await archive.reverify(artifact.relativeKey, artifact.sha256, artifact.byteLength);
                } catch (error) {
                    if (!(error instanceof WorkerError)) throw error;
                }
                if (state !== "ok") {
                    unverified += 1;
                    continue;
                }
                await deps.ledger.append("recovered_verified", {
                    artifactIdentity: artifact.artifactIdentity, relativeKey: artifact.relativeKey, sha256: artifact.sha256,
                }, nowIso(deps));
                recovered += 1;
            }
        }
    }
    return { outcome: "finished", recovered, unverified, sequenceFloor: facts.floor, knownGaps: facts.gaps.length };
}

async function verifyManifest(
    archive: LocalDestination, entry: { documentId: string; metadataRevision: string; manifestKey: string; manifestSha256: string },
): Promise<ReturnType<typeof manifestSchema.parse> | null> {
    let bytes: Buffer | null;
    try {
        bytes = await archive.readArchiveFile(entry.manifestKey);
    } catch (error) {
        if (!(error instanceof WorkerError)) throw error;
        return null;
    }
    if (bytes === null || sha256Hex(bytes) !== entry.manifestSha256) return null;
    try {
        const parsed = manifestSchema.safeParse(JSON.parse(bytes.toString("utf8")));
        if (!parsed.success || parsed.data.documentId !== entry.documentId || parsed.data.metadataRevision !== entry.metadataRevision) return null;
        return parsed.data;
    } catch {
        return null;
    }
}
