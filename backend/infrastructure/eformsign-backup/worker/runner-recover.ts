import { promises as fs } from "node:fs";
import path from "node:path";

import {
    ARCHIVE_MARKER_KEY, DRIVE_APP_PROPERTY_BINDING_ID, DRIVE_APP_PROPERTY_INSTALLATION_ID, DRIVE_FILE_ID_PATTERN, DRIVE_FOLDER_MIME, UUID_V4_PATTERN,
    WorkerError, completionContentDigest, completionSchema, decodeLedgerLine, driveDestinationIdentity, driveDestinationRevision, driveFolderChain,
    driveMimeOf, driveNameOf, driveStateKey, identifier, isPathIdentifier, isPermanentGapReason, isSafeRelativeKey, judgeHistoricalCoverage,
    parseArtifactKey, parseCompletionName, parseManifestKey, runInventorySchema,
    type DriveBinding, type Installation, type KnownGap, type Manifest, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { DriveTransferError, type DriveFailure, type DriveFile } from "./drive-client";
import { DriveDestination, driveReasonCode, type DriveNodeLedger, type DriveStep } from "./drive-destination";
import { decodeCheckpoint } from "./ledger-checkpoint";
import { CHECKPOINT_NAME, LEDGER_DIR_NAME, MARKER_NAME, encodeMarker } from "./ledger-replay";
import type { LocalDestination } from "./local-destination";
import { listManifestFiles, parseManifestBytes, readManifest } from "./restore";
import { countDamagedBoundManifests } from "./runner-run";
import {
    ARCHIVE_MARKER_FILE, DestinationLedger, VERIFY_STALE_MS, assertLedgerRoom, assertSameInstallation, controlMarkerWriter, ledgerDriveNodes, nowIso,
    parseMarker, readArchiveMarker, requireInstallation, sha256Hex,
} from "./runner-common";
import {
    LOCAL_DESTINATION_REVISION, ZERO_COUNTS, localDestinationIdentity, type RecoverSummary, type RunnerDependencies, type VerifySummary,
} from "./runner-types";

const JOURNAL_NAME = /^journal-\d{12}\.jsonl$/;
const QUARANTINE_PREFIX = "ledger.quarantine-";

const isEnoent = (error: unknown): boolean => error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";

/**
 * Evidence files: only a missing file (ENOENT) counts as absent. Anything else that stops it being read, or a name that is
 * not a regular file, could be hiding a record, so it is `control-unavailable` rather than an empty answer.
 */
async function readIfPresent(file: string): Promise<Buffer | null> {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile()) throw new WorkerError("control-unavailable");
        return await fs.readFile(file);
    } catch (error) {
        if (isEnoent(error)) return null;
        throw error instanceof WorkerError ? error : new WorkerError("control-unavailable");
    }
}

/** Evidence directories: a missing one (ENOENT) is absent, any other failure to list it is `control-unavailable`. */
async function readEvidenceDir(dir: string): Promise<string[] | null> {
    try {
        return await fs.readdir(dir);
    } catch (error) {
        if (isEnoent(error)) return null;
        throw new WorkerError("control-unavailable");
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
    // The Drive side is independent of the archive (design 7.1): it is read here and settled wherever the run ends. Without a Drive
    // dependency this reads nothing and every number below is exactly what the local verify alone reports.
    const drive = await checkDriveEntries(deps, installation, options);
    const finish = async (
        snapshotStatus: "partial" | "blocked", reasonCodes: WorkerReasonCode[],
    ): Promise<void> => {
        const at = nowIso(deps);
        await deps.ledger.append("run_finished", {
            runId, finishedAt: at, snapshotStatus, historicalCoverage: judgeHistoricalCoverage(deps.ledger.state),
            reasonCodes: [...new Set([...reasonCodes, ...drive.reasons])], counts: { ...ZERO_COUNTS },
        }, at);
    };

    const check = await archive.checkArchive(0);
    if (!check.ok) {
        await recordDriveDamage(deps, installation, drive);
        await finish("blocked", ["archive-unavailable"]);
        return { outcome: "finished", runId, checked: drive.checked, integrityErrors: drive.damaged.length, archiveAvailable: false };
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
    let damagedManifests = 0;
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
    if (archiveAvailable && options.all) {
        // Only `--all` also reads the bound manifests; plain verify keeps its PDF-only scope.
        try {
            damagedManifests = await countDamagedBoundManifests(deps, archive);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            archiveAvailable = false;
        }
    }
    if (!archiveAvailable) {
        // The archive went away part way: nothing found so far is trusted, no transition is written.
        await recordDriveDamage(deps, installation, drive);
        await finish("blocked", ["archive-unavailable"]);
        return { outcome: "finished", runId, checked: drive.checked, integrityErrors: drive.damaged.length, archiveAvailable: false };
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
    await recordDriveDamage(deps, installation, drive);
    await finish("partial", damagedManifests > 0 ? ["archive-conflict"] : []);
    // The run is on record with its reason; the exit follows the unchanged mapping (archive-conflict is 69). Nothing is rewritten.
    if (damagedManifests > 0) throw new WorkerError("archive-conflict");
    return { outcome: "finished", runId, checked: checked + drive.checked, integrityErrors: damaged.length + drive.damaged.length, archiveAvailable: true };
}

async function rehash(archive: LocalDestination, relativeKey: string, sha256: string): Promise<"ok" | "missing" | "mismatch"> {
    const bytes = await archive.readArchiveFile(relativeKey);
    if (bytes === null) return "missing";
    return sha256Hex(bytes) === sha256 ? "ok" : "mismatch";
}

/**
 * True when the directory holds a record: a checkpoint, or a journal with at least one newline-terminated line. A missing or
 * empty directory, empty journals and a torn first line are what a kill inside `init` leaves: nothing was ever recorded.
 */
async function ledgerHoldsRecords(dir: string): Promise<boolean> {
    const names = await readEvidenceDir(dir);
    if (names === null) return false;
    if (names.includes(CHECKPOINT_NAME)) return true;
    for (const name of names.filter((entry) => JOURNAL_NAME.test(entry))) {
        const bytes = await readIfPresent(path.join(dir, name));
        if (bytes !== null && bytes.includes(0x0a)) return true;
    }
    return false;
}

/** The installation a ledger directory last described, when any of it can still be read (best effort, never trusted alone). */
interface PriorInstallation { installationId: string; archiveDev: number; archiveIno: number }

async function readPriorInstallation(ledgerDir: string): Promise<PriorInstallation | null> {
    const checkpoint = await readIfPresent(path.join(ledgerDir, CHECKPOINT_NAME));
    const restored = checkpoint === null ? null : decodeCheckpoint(checkpoint);
    if (restored?.installation) {
        const { installationId, archiveDev, archiveIno } = restored.installation;
        return { installationId, archiveDev, archiveIno };
    }
    const listed = await readEvidenceDir(ledgerDir);
    if (listed === null) return null;
    for (const name of listed.filter((entry) => JOURNAL_NAME.test(entry)).sort()) {
        const bytes = await readIfPresent(path.join(ledgerDir, name));
        const first = bytes?.toString("utf8").split("\n")[0];
        if (first === undefined || first === "") continue;
        const decoded = decodeLedgerLine(first);
        if (decoded.ok && (decoded.record.type === "installed" || decoded.record.type === "recovery_started")) {
            const { installationId, archiveDev, archiveIno } = decoded.record.body;
            return { installationId, archiveDev, archiveIno };
        }
    }
    return null;
}

/**
 * Every directory that can hold identity evidence: `ledger/` and each `ledger.quarantine-<uuid-v4>`. `quarantineAndReset`
 * moves the ledger aside before `recovery_started` is written, so a kill in between leaves the only durable record in a
 * quarantine directory. A symlink or a non-directory under one of these names is not something to read through.
 */
async function listEvidenceDirs(controlPath: string): Promise<string[]> {
    let names: string[];
    try {
        names = (await fs.readdir(controlPath)).sort();
    } catch {
        throw new WorkerError("control-unavailable");
    }
    const found: string[] = [];
    for (const name of names) {
        const quarantine = name.startsWith(QUARANTINE_PREFIX) && UUID_V4_PATTERN.test(name.slice(QUARANTINE_PREFIX.length));
        if (name !== LEDGER_DIR_NAME && !quarantine) continue;
        let stat;
        try {
            stat = await fs.lstat(path.join(controlPath, name));
        } catch {
            throw new WorkerError("control-unavailable");
        }
        if (!stat.isDirectory()) throw new WorkerError("control-unavailable");
        found.push(name);
    }
    return found;
}

/**
 * The installation every record-holding evidence directory agrees on, with the directory it was read from (`ledger` when
 * `ledger/` held records, otherwise the first quarantine directory). Null only when no directory anywhere holds a record.
 * A directory that holds records but yields no readable prior, or priors that disagree, refuse: nothing then proves which
 * archive was installed. Order, names and mtimes never pick a "newest".
 */
async function resolvePriorInstallation(controlPath: string): Promise<{ prior: PriorInstallation; source: string } | null> {
    const found: Array<{ name: string; prior: PriorInstallation }> = [];
    for (const name of await listEvidenceDirs(controlPath)) {
        const dir = path.join(controlPath, name);
        if (!(await ledgerHoldsRecords(dir))) continue;
        const prior = await readPriorInstallation(dir);
        if (prior === null) throw new WorkerError("archive-identity-mismatch");
        found.push({ name, prior });
    }
    const first = found[0];
    if (first === undefined) return null;
    for (const other of found) {
        if (other.prior.installationId !== first.prior.installationId || other.prior.archiveDev !== first.prior.archiveDev
            || other.prior.archiveIno !== first.prior.archiveIno) throw new WorkerError("archive-identity-mismatch");
    }
    return { prior: first.prior, source: found.some((entry) => entry.name === LEDGER_DIR_NAME) ? LEDGER_DIR_NAME : first.name };
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
        // Only permanent gaps are historical coverage; a transient omission says why one snapshot lacked a document (see ledger-state).
        for (const gap of content.data.gaps.filter((candidate) => isPermanentGapReason(candidate.reasonCode))) gaps.set(`${gap.documentId}\u0000${gap.reasonCode}`, { documentId: gap.documentId, artifactIdentity: null, reasonCode: gap.reasonCode });
    }
    const known = [...gaps.values()].sort((a, b) => (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : a.reasonCode < b.reasonCode ? -1 : 1));
    return { floor, gaps: known, valid };
}

/**
 * `recover` (contract section 3): builds a new ledger from what the archive itself proves. It refuses, changing nothing,
 * unless the archive is the one that was installed and the operator named its installation id.
 *
 * A recover that was killed part way leaves an ok ledger that started with `recovery_started` and holds only some of the
 * `recovered_verified` records. Running recover again then RESUMES: it re-hashes what is not yet recovered, appends only
 * that, and starts nothing new. Resume is allowed only while no run has started since (`run` and `verify` both append
 * `run_started`), so a ledger that has moved on is never rewritten.
 */
export async function executeRecover(deps: RunnerDependencies, options: { installationId: string; driveRootFolderId?: string }): Promise<RecoverSummary> {
    const { config } = deps;
    const initialStatus = deps.ledger.status;
    // A root named for a Drive this command does not have is an operator error: refused before anything is written.
    if (options.driveRootFolderId !== undefined && deps.drive === null) throw new WorkerError("drive-not-configured");

    // The archive root is compared with what the ledger recorded at install time. Marker-only proof is allowed only when no
    // directory anywhere (ledger/ or a quarantine dir) holds a record; otherwise the agreed prior is the expected identity.
    const resolved = await resolvePriorInstallation(config.control.path);
    const prior = resolved === null ? null : resolved.prior;
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

    // An ok ledger passes only as the resume of an interrupted recover; every other ok ledger refuses before anything is written.
    const installed = deps.ledger.state.installation;
    const resuming = initialStatus === "ok";
    if (resuming && !(installed !== null && installed.origin === "recovery_started" && deps.ledger.state.runs.size === 0
        && installed.installationId === options.installationId && installed.archiveDev === current.dev && installed.archiveIno === current.ino)) {
        throw new WorkerError("ledger-inconsistent");
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
        // The same ownership guard the ledger runs before its own writes: a worker whose lock file was replaced must not restore it.
        await deps.ledger.guardExternalWrite();
        await controlMarkerWriter(config.control.path, MARKER_NAME, encodeMarker(marker));
        if (deps.reopenLedger === undefined) throw new WorkerError("internal");
        await deps.ledger.close();
        deps.ledger = await deps.reopenLedger();
        if (deps.ledger.status === "ok") {
            await deps.ledger.repairPendingTail();
            // The marker was the only thing missing; a Drive part an earlier pass could not finish is still owed (and an unusable Drive still reported).
            await recoverDrive(deps, archive, options);
            return { outcome: "finished", recovered: 0, unverified: 0, sequenceFloor: deps.ledger.state.lastSeq, knownGaps: 0 };
        }
    }
    // Every refusal check has passed: only now may a torn tail of the ledger be repaired.
    await deps.ledger.repairPendingTail();
    if (!resuming && deps.ledger.status !== "recovery_required") throw new WorkerError("ledger-inconsistent");

    const facts = await readCompletionFacts(archive, config.companyId);
    const named = new Set(facts.valid.flatMap((completion) => completion.entries.map((entry) => entry.manifestKey)));
    const others = (await listManifestFiles(config.archive.path, config.companyId)).filter((file) => !named.has(file.key));
    if (!resuming) {
        const runId = deps.uuid();
        await deps.ledger.quarantineAndReset(runId);
        await deps.runnerFault?.("recover-after-quarantine");
        const at = nowIso(deps);
        await deps.ledger.append("recovery_started", {
            installationId: marker.installationId, archiveId: marker.archiveId, archiveDev: current.dev, archiveIno: current.ino,
            destinationIdentity: localDestinationIdentity(marker.archiveId), destinationRevision: LOCAL_DESTINATION_REVISION,
            priorLedgerName: resolved === null || resolved.source === LEDGER_DIR_NAME ? `${QUARANTINE_PREFIX}${runId}` : resolved.source,
            sequenceFloor: facts.floor, knownGaps: facts.gaps,
        }, at);
    }
    // Resume keeps the floor and the gaps the interrupted pass already recorded.
    const { sequenceFloor, knownGaps } = resuming
        ? { sequenceFloor: deps.ledger.state.sequenceFloor, knownGaps: deps.ledger.state.gaps.length }
        : { sequenceFloor: facts.floor, knownGaps: facts.gaps.length };

    // Resume skips what the interrupted pass already proved: an entry verified for this installation's destination.
    const done = resuming && installed !== null ? new DestinationLedger(deps, installed) : null;
    let recovered = 0;
    let unverified = 0;
    const seen = new Set<string>();
    const manifests = [
        ...facts.valid.flatMap((completion) => completion.entries.map((entry) => ({
            key: entry.manifestKey, companyId: completion.companyId, documentId: entry.documentId,
            metadataRevision: entry.metadataRevision, sha256: entry.manifestSha256,
        }))),
        // A manifest no completion names (its run died before the completion) is re-hashed all the same.
        ...others.map((file) => ({ key: file.key, companyId: config.companyId, documentId: file.documentId, metadataRevision: file.metadataRevision })),
    ];
    for (const item of manifests) {
        let manifest;
        try {
            manifest = await readManifest(archive, item.key, item);
        } catch (error) {
            if (!(error instanceof WorkerError)) throw error;
            unverified += 1;
            continue;
        }
        for (const artifact of manifest.artifacts) {
            if (seen.has(artifact.artifactIdentity)) continue;
            seen.add(artifact.artifactIdentity);
            if (done?.entryOf(artifact.artifactIdentity)?.state === "verified") continue;
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
            if (recovered === 1) await deps.runnerFault?.("recover-after-first-recovered");
        }
    }
    // The local ledger is rebuilt and kept whatever happens next; the Drive part adopts what Drive already holds and creates nothing.
    await recoverDrive(deps, archive, options);
    return { outcome: "finished", recovered, unverified, sequenceFloor, knownGaps };
}

// ---- Google Drive (BJJ-456 U6) ------------------------------------------------------------------------------------------------
//
// Recover adopts what Drive already holds; it never creates, uploads, renames or trashes anything there. Everything it reads is
// validated first (the marker byte for byte, records by their parsers, artifacts by Drive's own checksum or their bytes), and only
// then written to the ledger: the root binding (`drive_bound`, status `pending`), one node record per folder and file of the
// layout, the records (`drive_record_published`), each proven artifact (`recovered_verified` with its file id), and last
// `drive_ready`. A recover that stops anywhere in between finds the same root again and repeats what is missing.

/** More than one root of this installation holds the archive marker: the operator picks one with `--drive-root-folder-id`. */
export class DriveRootCandidatesError extends WorkerError {
    constructor(readonly candidates: ReadonlyArray<{ rootFolderId: string; bindingId: string | null }>) {
        super("drive-root-changed");
        this.name = "DriveRootCandidatesError";
    }
}

/** A record is small; a bigger one is not a record. */
const JSON_MAX_BYTES = 16 * 1024 * 1024;
const NATIVE_GOOGLE_MIME_PREFIX = "application/vnd.google-apps.";
const COMPLETION_PATH = /^eformsign\/([^/]+)\/completions\/([^/]+)$/;
const RUN_PATH = /^eformsign\/([^/]+)\/runs\/([^/]+)\.json$/;

/** The value of a Drive step, or the `WorkerError` whose reason code is the contract's for that failure (`drive-conflict` for a conflict). */
function settle<T>(step: DriveStep<T>): T {
    if (step.ok) return step.value;
    throw new WorkerError("failure" in step ? driveReasonCode(step.failure) : "drive-conflict");
}

function isNotFound(failure: DriveFailure): boolean {
    return failure.kind === "http" && failure.httpStatus === 404;
}

function isFolder(file: DriveFile): boolean {
    return file.mimeType === DRIVE_FOLDER_MIME;
}

function isSafeName(name: string): boolean {
    return name.length > 0 && !name.includes("/") && isSafeRelativeKey(name);
}

type LayoutKind =
    | { kind: "marker" }
    | { kind: "artifact" }
    | { kind: "manifest"; documentId: string; metadataRevision: string }
    | { kind: "completion"; name: string }
    | { kind: "run"; runId: string };

/** What the archive layout says a path of this company is; `null` for a path that is not part of it. */
function layoutKind(key: string, companyId: string): LayoutKind | null {
    if (key === ARCHIVE_MARKER_KEY) return { kind: "marker" };
    const artifact = parseArtifactKey(key);
    if (artifact !== null) return artifact.companyId === companyId ? { kind: "artifact" } : null;
    const manifest = parseManifestKey(key);
    if (manifest !== null) return manifest.companyId === companyId ? { kind: "manifest", documentId: manifest.documentId, metadataRevision: manifest.metadataRevision } : null;
    const completion = COMPLETION_PATH.exec(key);
    if (completion !== null && completion[1] === companyId && isPathIdentifier(completion[1]) && parseCompletionName(completion[2]!) !== null) {
        return { kind: "completion", name: completion[2]! };
    }
    const run = RUN_PATH.exec(key);
    if (run !== null && run[1] === companyId && isPathIdentifier(run[1]) && UUID_V4_PATTERN.test(run[2]!)) return { kind: "run", runId: run[2]! };
    return null;
}

/**
 * Whether a folder is one the archive layout has: a folder that is empty today is still the one the next run would put a file into,
 * so it is adopted like any other (otherwise that run would create a second folder of the same name beside it).
 */
function isLayoutFolder(key: string, companyId: string): boolean {
    const [top, company, area, kind, type, ...rest] = key.split("/");
    if (key === ".bjj-backup" || key === "eformsign") return true;
    if (top !== "eformsign" || company !== companyId || rest.length > 0) return false;
    if (area === undefined) return true;
    if (kind === undefined) return area === "completions" || area === "runs" || isPathIdentifier(area);
    if (area === "completions" || area === "runs" || !isPathIdentifier(area)) return false;
    if (type === undefined) return kind === "manifests" || kind === "artifacts";
    return kind === "artifacts" && (type === "document" || type === "audit-trail");
}

/** The bytes of a Drive file; `null` when it vanished, is too big for a record, or is not the length its listing says. */
async function readDriveBytes(destination: DriveDestination, file: DriveFile): Promise<Buffer | null> {
    const opened = await destination.download(file.id);
    if (!opened.ok) {
        if ("failure" in opened && isNotFound(opened.failure)) return null;
        settle(opened);
        return null;
    }
    const parts: Buffer[] = [];
    let total = 0;
    try {
        for await (const part of opened.value) {
            total += part.byteLength;
            if (total > JSON_MAX_BYTES) return null;
            parts.push(Buffer.from(part));
        }
    } catch (error) {
        if (error instanceof DriveTransferError) throw new WorkerError(driveReasonCode(error.failure));
        throw error;
    }
    const bytes = Buffer.concat(parts);
    return file.size !== null && file.size !== bytes.length ? null : bytes;
}

function destinationOf(deps: RunnerDependencies, root: DriveFile, installation: Installation): DriveDestination {
    return deps.createDriveDestination({
        rootFolderId: root.id, rootName: root.name, rootParentId: root.parents[0] ?? "root",
        bindingId: root.appProperties[DRIVE_APP_PROPERTY_BINDING_ID] ?? "unknown", installationId: installation.installationId, archiveId: installation.archiveId,
    });
}

/** Whether the root holds the archive marker, byte for byte, at the marker's mirrored path. */
async function markerState(deps: RunnerDependencies, destination: DriveDestination, root: DriveFile, archiveMarker: Buffer): Promise<"equal" | "differs" | "absent"> {
    const [directoryName, fileName] = ARCHIVE_MARKER_FILE.split("/") as [string, string];
    await assertLedgerRoom(deps);
    const directories: DriveFile[] = [];
    for await (const child of destination.listChildren(root.id)) if (child.name === directoryName && isFolder(child)) directories.push(child);
    const files: DriveFile[] = [];
    for (const directory of directories) {
        await assertLedgerRoom(deps);
        for await (const child of destination.listChildren(directory.id)) if (child.name === fileName && !isFolder(child)) files.push(child);
    }
    if (files.length === 0) return "absent";
    // Two files at the marker's path cannot both be it: that is a conflict, never a guess.
    if (files.length > 1) return "differs";
    await assertLedgerRoom(deps);
    const bytes = await readDriveBytes(destination, files[0]!);
    return bytes !== null && bytes.equals(archiveMarker) ? "equal" : "differs";
}

/**
 * The one root this installation is recovered onto (A2.4): named by the operator, or by a `pending` binding of an interrupted recover,
 * or found by `bjjInstallationId`; in every case it must be an untrashed folder of this installation that holds the archive marker.
 */
async function selectRoot(
    deps: RunnerDependencies, installation: Installation, archiveMarker: Buffer, named: string | undefined,
): Promise<DriveFile> {
    const dependency = deps.drive;
    if (dependency === null || dependency.kind !== "ready") throw new WorkerError("drive-not-configured");
    const { client } = dependency;
    const isRoot = (file: DriveFile | null): file is DriveFile => file !== null && isFolder(file) && !file.trashed
        && file.appProperties[DRIVE_APP_PROPERTY_INSTALLATION_ID] === installation.installationId;
    let candidates: DriveFile[];
    if (named !== undefined) {
        await assertLedgerRoom(deps);
        const found = await client.getFile(named);
        if (!found.ok) throw new WorkerError(driveReasonCode(found.failure));
        if (!isRoot(found.value)) throw new WorkerError("drive-root-changed");
        candidates = [found.value];
    } else {
        await assertLedgerRoom(deps);
        candidates = settle(await DriveDestination.discoverRoots(client, "bjjInstallationId", installation.installationId)).filter(isRoot);
    }
    const states: Array<{ root: DriveFile; state: "equal" | "differs" | "absent" }> = [];
    for (const root of candidates) states.push({ root, state: await markerState(deps, destinationOf(deps, root, installation), root, archiveMarker) });
    const matching = states.filter((entry) => entry.state === "equal").map((entry) => entry.root);
    if (matching.length === 1) return matching[0]!;
    if (matching.length > 1) {
        throw new DriveRootCandidatesError(matching
            .map((root) => ({ rootFolderId: root.id, bindingId: root.appProperties[DRIVE_APP_PROPERTY_BINDING_ID] ?? null }))
            .sort((a, b) => (a.rootFolderId < b.rootFolderId ? -1 : 1)));
    }
    // A root of this installation whose marker is not the archive's is somebody else's data under this name: never adopted.
    throw new WorkerError(states.some((entry) => entry.state === "differs") ? "archive-conflict" : "drive-root-changed");
}

interface TreeEntry {
    key: string;
    id: string;
    parentId: string;
}
interface TreeFile extends TreeEntry {
    file: DriveFile;
}

/** Every untrashed folder and file under the root, by mirrored path. Reads only; a failed page ends the recover with its reason code. */
async function walkTree(deps: RunnerDependencies, destination: DriveDestination, root: DriveFile): Promise<{ folders: TreeEntry[]; files: TreeFile[] }> {
    const folders: TreeEntry[] = [];
    const files: TreeFile[] = [];
    const visited = new Set<string>([root.id]);
    const pending: Array<{ id: string; prefix: string }> = [{ id: root.id, prefix: "" }];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        await assertLedgerRoom(deps);
        for await (const child of destination.listChildren(next.id)) {
            if (!isSafeName(child.name)) continue;
            const key = next.prefix === "" ? child.name : `${next.prefix}/${child.name}`;
            if (isFolder(child)) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                folders.push({ key, id: child.id, parentId: next.id });
                pending.push({ id: child.id, prefix: key });
            } else if (!child.mimeType.startsWith(NATIVE_GOOGLE_MIME_PREFIX)) {
                files.push({ key, id: child.id, parentId: next.id, file: child });
            }
        }
    }
    const byKey = (a: TreeEntry, b: TreeEntry): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { folders: folders.sort(byKey), files: files.sort(byKey) };
}

/** A node of the tree becomes a ledger node of the revision: reserved, then created, each step only if it is not already there. */
async function adoptNode(nodes: DriveNodeLedger, kind: "folder" | "file", entry: TreeEntry): Promise<void> {
    const current = nodes.current(entry.key);
    if (current !== null) {
        // A node this revision already holds under another id (or place) is not what Drive shows now.
        if (current.kind !== kind || current.fileId !== entry.id || current.parentFileId !== entry.parentId) throw new WorkerError("drive-conflict");
        if (current.status === "reserved") await nodes.created(entry.key, entry.id);
        return;
    }
    await nodes.reserve(kind, entry.key, entry.id, entry.parentId);
    await nodes.created(entry.key, entry.id);
}

/** What one JSON record of the layout holds, once its own parser accepts it; `null` when it does not. */
function parseRecord(deps: RunnerDependencies, kind: LayoutKind, key: string, bytes: Buffer, archiveMarker: Buffer): { manifest?: Manifest } | null {
    const { companyId } = deps.config;
    try {
        switch (kind.kind) {
            case "marker":
                return bytes.equals(archiveMarker) ? {} : null;
            case "manifest":
                return { manifest: parseManifestBytes(bytes, key, { companyId, documentId: kind.documentId, metadataRevision: kind.metadataRevision }).manifest };
            case "completion": {
                const named = parseCompletionName(kind.name);
                const content = completionSchema.safeParse(JSON.parse(bytes.toString("utf8")));
                if (named === null || !content.success || content.data.companyId !== companyId || content.data.sequence !== named.sequence
                    || completionContentDigest(content.data) !== named.contentDigest) return null;
                return {};
            }
            case "run": {
                const parsed = runInventorySchema.safeParse(JSON.parse(bytes.toString("utf8")));
                return parsed.success && parsed.data.runId === kind.runId ? {} : null;
            }
            default:
                return null;
        }
    } catch (error) {
        if (error instanceof SyntaxError || error instanceof WorkerError) return null;
        throw error;
    }
}

/**
 * The Drive part of `recover`. It runs after the local pass and only when the config has a `drive` block. A root it cannot adopt
 * (none, several, a different marker) is refused with the reason code and nothing Drive-related is written; the command then
 * ends with that code and the rebuilt local ledger stays. A Drive that cannot be used right now (unreachable, token rejected,
 * secret file unusable) ends it the same way, and a later `recover` finishes the Drive part.
 */
async function recoverDrive(deps: RunnerDependencies, archive: LocalDestination, options: { installationId: string; driveRootFolderId?: string }): Promise<void> {
    const dependency = deps.drive;
    if (dependency === null) return;
    const installation = deps.ledger.state.installation;
    if (installation === null) throw new WorkerError("ledger-inconsistent");
    const existing = installation.drive;
    if (existing !== null && existing.status === "ready") {
        // The Drive part of an earlier recover is complete; an explicit root that is another one needs `drive-setup --rebind`.
        if (options.driveRootFolderId !== undefined && options.driveRootFolderId !== existing.rootFolderId) throw new WorkerError("drive-root-changed");
        return;
    }
    if (dependency.kind === "unavailable") throw new WorkerError(dependency.reason);

    const archiveMarker = await archive.readArchiveFile(ARCHIVE_MARKER_FILE).catch((error: unknown) => {
        throw error instanceof WorkerError ? error : new WorkerError("archive-unavailable");
    });
    if (archiveMarker === null) throw new WorkerError("archive-marker-invalid");

    // 1. The root, validated. Nothing is written yet.
    const named = options.driveRootFolderId ?? existing?.rootFolderId;
    const root = await selectRoot(deps, installation, archiveMarker, named);
    const bindingId = root.appProperties[DRIVE_APP_PROPERTY_BINDING_ID];
    const rootParentId = root.parents.length === 1 ? root.parents[0]! : null;
    if (bindingId === undefined || !UUID_V4_PATTERN.test(bindingId) || rootParentId === null || !DRIVE_FILE_ID_PATTERN.test(rootParentId)
        || !DRIVE_FILE_ID_PATTERN.test(root.id) || root.name.length < 1 || root.name.length > 255) throw new WorkerError("drive-root-changed");
    const destination = destinationOf(deps, root, installation);

    // 2. The tree and the records, read and judged in memory.
    const { folders, files } = await walkTree(deps, destination, root);
    const layout = files.filter((entry) => layoutKind(entry.key, deps.config.companyId) !== null);
    const needed = new Set(layout.flatMap((entry) => driveFolderChain(entry.key)));
    const layoutFolders = folders.filter((entry) => needed.has(entry.key) || isLayoutFolder(entry.key, deps.config.companyId));
    const occupied = new Map<string, number>();
    for (const entry of [...layoutFolders, ...layout, ...files.filter((entry) => needed.has(entry.key))]) occupied.set(entry.key, (occupied.get(entry.key) ?? 0) + 1);
    // Two Drive objects at one mirrored path cannot be told apart: nothing is adopted until the operator removes one.
    if ([...occupied.values()].some((count) => count > 1)) throw new WorkerError("drive-conflict");

    const records: Array<{ key: string; fileId: string; sha256: string }> = [];
    const manifests = new Map<string, Manifest>();
    for (const entry of layout) {
        const kind = layoutKind(entry.key, deps.config.companyId)!;
        if (kind.kind === "artifact") continue;
        await assertLedgerRoom(deps);
        const bytes = await readDriveBytes(destination, entry.file);
        if (bytes === null) continue;
        const parsed = parseRecord(deps, kind, entry.key, bytes, archiveMarker);
        if (parsed === null) continue;
        records.push({ key: entry.key, fileId: entry.id, sha256: sha256Hex(bytes) });
        if (parsed.manifest !== undefined) manifests.set(entry.key, parsed.manifest);
    }

    // 3. The ledger: the binding, the nodes, the records.
    const accountId = await accountOf(deps, existing, bindingId);
    if (existing === null || existing.bindingId !== bindingId) {
        await deps.ledger.append("drive_bound", {
            destinationIdentity: driveDestinationIdentity(root.id), destinationRevision: driveDestinationRevision(bindingId), bindingId,
            rootFolderId: root.id, rootName: root.name, rootParentId, accountId: accountId!,
        }, nowIso(deps));
    } else if (existing.rootFolderId !== root.id || existing.rootName !== root.name || existing.rootParentId !== rootParentId) {
        // The root of a half-finished recover is no longer the folder it bound.
        throw new WorkerError("drive-root-changed");
    }
    const binding = deps.ledger.state.installation?.drive;
    if (binding === null || binding === undefined || binding.bindingId !== bindingId) throw new WorkerError("ledger-inconsistent");
    const revision = binding.destinationRevision;
    const nodes = ledgerDriveNodes(deps, revision);
    const depth = (entry: TreeEntry): number => entry.key.split("/").length;
    for (const entry of [...layoutFolders].sort((a, b) => depth(a) - depth(b) || (a.key < b.key ? -1 : 1))) await adoptNode(nodes, "folder", entry);
    for (const entry of layout) await adoptNode(nodes, "file", entry);
    for (const record of records) {
        const known = deps.ledger.state.driveRecords.get(driveStateKey(revision, record.key));
        if (known !== undefined) {
            if (known.sha256 !== record.sha256 || known.fileId !== record.fileId) throw new WorkerError("drive-conflict");
            continue;
        }
        await deps.ledger.append("drive_record_published", { destinationRevision: revision, relativeKey: record.key, sha256: record.sha256, fileId: record.fileId }, nowIso(deps));
    }

    // 4. Artifacts named by a valid manifest: each is recovered only after Drive's checksum, or the downloaded bytes, prove it.
    const dl = new DestinationLedger(deps, installation, binding);
    const byKey = new Map(layout.map((entry) => [entry.key, entry]));
    const seen = new Set<string>();
    let recovered = 0;
    for (const [, manifest] of [...manifests].sort(([a], [b]) => (a < b ? -1 : 1))) {
        for (const artifact of manifest.artifacts) {
            if (seen.has(artifact.artifactIdentity)) continue;
            seen.add(artifact.artifactIdentity);
            // Resume skips what the interrupted pass already proved for this revision.
            if (dl.entryOf(artifact.artifactIdentity)?.state === "verified") continue;
            const entry = byKey.get(artifact.relativeKey);
            if (entry === undefined) continue;
            await assertLedgerRoom(deps);
            const found = settle(await destination.verifyRemote(entry.id, {
                name: driveNameOf(artifact.relativeKey), parentFileId: entry.parentId, sha256: artifact.sha256, byteLength: artifact.byteLength,
                mimeType: driveMimeOf(artifact.relativeKey),
            }));
            if (found !== "ok") continue;
            await deps.ledger.append("recovered_verified", {
                artifactIdentity: artifact.artifactIdentity, relativeKey: artifact.relativeKey, sha256: artifact.sha256,
                destinationIdentity: binding.destinationIdentity, destinationRevision: binding.destinationRevision, fileId: entry.id,
            }, nowIso(deps));
            recovered += 1;
            if (recovered === 1) await deps.runnerFault?.("drive-recover-after-first");
        }
    }
    if (deps.ledger.state.installation?.drive?.status === "pending") {
        await deps.ledger.append("drive_ready", { destinationRevision: revision }, nowIso(deps));
    }
}

/** The account the binding is recorded for: only asked when a binding is about to be written. */
async function accountOf(deps: RunnerDependencies, existing: DriveBinding | null, bindingId: string): Promise<string | null> {
    if (existing !== null && existing.bindingId === bindingId) return null;
    const dependency = deps.drive;
    if (dependency === null || dependency.kind !== "ready") throw new WorkerError("drive-not-configured");
    await assertLedgerRoom(deps);
    const about = await dependency.client.about();
    if (!about.ok) throw new WorkerError(driveReasonCode(about.failure));
    if (!identifier.safeParse(about.value.permissionId).success) throw new WorkerError("drive-conflict");
    return about.value.permissionId;
}

// ---- verify: the Drive entries of the current binding ---------------------------------------------------------------------------

interface DriveVerification {
    /** Entries that were actually rechecked on Drive. */
    checked: number;
    damaged: Array<{ artifactIdentity: string; relativeKey: string | null }>;
    /** Why the Drive pass could not be completed; non-empty means nothing was found and no transition is written. */
    reasons: WorkerReasonCode[];
}

const NO_DRIVE: Readonly<DriveVerification> = Object.freeze({ checked: 0, damaged: [], reasons: [] });

/**
 * Rechecks the Drive entries of the current, `ready` binding: all of them with `--all` (the bytes are downloaded and hashed), otherwise
 * those never verified or older than the verify cadence. Reads only. A Drive that cannot answer (or a root that changed) yields a
 * reason and no finding at all: nothing is written on a guess. Previous success events of a damaged entry are never touched.
 */
async function checkDriveEntries(deps: RunnerDependencies, installation: Installation, options: { all: boolean }): Promise<DriveVerification> {
    const dependency = deps.drive;
    const binding = installation.drive;
    if (dependency === null || binding === null || binding.status !== "ready") return NO_DRIVE;
    if (dependency.kind === "unavailable") return { checked: 0, damaged: [], reasons: [dependency.reason] };
    const { state } = deps.ledger;
    const now = deps.clock.now().getTime();
    const due = [...state.destinations.values()].filter((entry) => {
        if (entry.destinationIdentity !== binding.destinationIdentity || entry.destinationRevision !== binding.destinationRevision) return false;
        if (entry.state !== "verified") return false;
        if (options.all || entry.lastVerifiedAt === null) return true;
        return now - Date.parse(entry.lastVerifiedAt) >= VERIFY_STALE_MS;
    }).sort((a, b) => (a.artifactIdentity < b.artifactIdentity ? -1 : 1));
    if (due.length === 0) return NO_DRIVE;

    const unanswered = (reason: WorkerReasonCode): DriveVerification => ({ checked: 0, damaged: [], reasons: [reason] });
    const destination = deps.createDriveDestination({
        rootFolderId: binding.rootFolderId, rootName: binding.rootName, rootParentId: binding.rootParentId, bindingId: binding.bindingId,
        installationId: installation.installationId, archiveId: installation.archiveId,
    });
    await assertLedgerRoom(deps);
    const root = await destination.checkRoot();
    if (!root.ok) return unanswered("failure" in root ? driveReasonCode(root.failure) : "drive-conflict");
    if (root.value === "changed") return unanswered("drive-root-changed");

    const damaged: DriveVerification["damaged"] = [];
    let checked = 0;
    for (const entry of due) {
        const info = state.artifacts.get(entry.artifactIdentity);
        const relativeKey = entry.relativeKey;
        if (info === undefined || relativeKey === null) continue;
        const node = state.driveNodes.get(driveStateKey(binding.destinationRevision, relativeKey));
        if (node === undefined || node.kind !== "file") {
            // A verified entry whose file the ledger cannot name has nothing to stand on.
            checked += 1;
            damaged.push({ artifactIdentity: entry.artifactIdentity, relativeKey });
            continue;
        }
        await assertLedgerRoom(deps);
        let byteLength = info.byteLength;
        if (byteLength === null) {
            // A recovered artifact has no recorded length: Drive's size is only the length the hash below must account for.
            const listed = await dependency.client.getFile(node.fileId);
            if (!listed.ok) return unanswered(driveReasonCode(listed.failure));
            if (listed.value === null || listed.value.size === null) {
                checked += 1;
                damaged.push({ artifactIdentity: entry.artifactIdentity, relativeKey });
                continue;
            }
            byteLength = listed.value.size;
        }
        const found = await destination.verifyRemote(node.fileId, {
            name: driveNameOf(relativeKey), parentFileId: node.parentFileId, sha256: info.sha256, byteLength, mimeType: driveMimeOf(relativeKey),
        }, { forceDownload: options.all || info.byteLength === null });
        if (!found.ok) return unanswered("failure" in found ? driveReasonCode(found.failure) : "drive-conflict");
        checked += 1;
        if (found.value !== "ok") damaged.push({ artifactIdentity: entry.artifactIdentity, relativeKey });
    }
    return { checked, damaged, reasons: [] };
}

/** The Drive entries found damaged become `integrity_error` of that entry; the next run takes a fresh id and uploads again. */
async function recordDriveDamage(deps: RunnerDependencies, installation: Installation, drive: DriveVerification): Promise<void> {
    const binding = installation.drive;
    if (binding === null || drive.damaged.length === 0) return;
    const dl = new DestinationLedger(deps, installation, binding);
    for (const item of drive.damaged) {
        await dl.transition(item.artifactIdentity, "integrity_error", { reasonCode: "artifact-integrity", relativeKey: item.relativeKey });
    }
}
