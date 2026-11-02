import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

import {
    ARCHIVE_MARKER_KEY, DRIVE_APP_PROPERTY_ARCHIVE_ID, DRIVE_APP_PROPERTY_BINDING_ID, DRIVE_APP_PROPERTY_INSTALLATION_ID, DRIVE_FOLDER_MIME,
    UUID_V4_PATTERN, WorkerError, isPathIdentifier, isSafeRelativeKey, parseArtifactKey, parseCompletionName, parseManifestKey, runInventorySchema,
    selectCompletion, type Manifest,
} from "domain/eformsign-backup/worker";
import { DriveTransferError, type DriveClient, type DriveFailure, type DriveFile } from "./drive-client";
import { DriveDestination, driveReasonCode } from "./drive-destination";
import { checkPdfFile } from "./pdf-check";
import { parseManifestBytes } from "./restore";
import { parseMarker } from "./runner-common";

/** Why a Drive file was not written. `drive-conflict`: the mirrored path is already taken by another Drive file. */
export type RestoreDriveFailureReason = "mirror-missing" | "artifact-integrity" | "drive-conflict";

export interface RestoreDriveFailure {
    relativeKey: string;
    reason: RestoreDriveFailureReason;
}

export interface RestoreDriveReport {
    schemaVersion: 1;
    rootFolderId: string;
    archiveId: string;
    verified: number;
    failed: number;
    failures: RestoreDriveFailure[];
}

export interface RestoreDriveOptions {
    client: DriveClient;
    archiveId: string;
    /** The configured archive and control paths: the output may be neither inside nor around them. */
    archivePath: string;
    controlPath: string;
    outDir: string;
    /** Takes this root instead of discovering it by the archive id. */
    rootFolderId?: string;
}

/** The archive id matches no single root: none, or several (`candidates`, ids only, sorted). */
export class DriveRootSelectionError extends WorkerError {
    constructor(readonly candidates: readonly string[]) {
        super("drive-root-changed");
        this.name = "DriveRootSelectionError";
    }
}

export const RESTORE_DRIVE_REPORT_NAME = "restore-drive-report.json";
export const RESTORE_DRIVE_TMP_NAME = ".restore-drive-tmp";

/** A record is small; a bigger one is not a record. */
const JSON_MAX_BYTES = 16 * 1024 * 1024;
const NATIVE_GOOGLE_MIME_PREFIX = "application/vnd.google-apps.";

function hasCode(error: unknown, code: string): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function inside(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`);
}

/**
 * The physical location of a path that may not exist yet: its nearest EXISTING ancestor resolved through every symlink, plus the
 * missing lexical suffix. A configured path that exists but will not resolve (a dangling symlink, a loop, an I/O error) is
 * `config-invalid`: it is the configuration, not `--out`, that cannot be judged, and nothing is guessed about it (fail closed).
 */
async function physicalPath(target: string): Promise<string> {
    const suffix: string[] = [];
    for (let existing = target; ;) {
        try {
            return path.join(await fs.realpath(existing), ...suffix.reverse());
        } catch (error) {
            if (!hasCode(error, "ENOENT")) throw new WorkerError("config-invalid");
        }
        let present = true;
        try {
            await fs.lstat(existing);
        } catch (error) {
            if (!hasCode(error, "ENOENT")) throw new WorkerError("config-invalid");
            present = false;
        }
        if (present) throw new WorkerError("config-invalid");
        const parent = path.dirname(existing);
        if (parent === existing) throw new WorkerError("restore-output-invalid");
        suffix.push(path.basename(existing));
        existing = parent;
    }
}

/**
 * The output directory must be new or an empty real directory, and unrelated to the archive and control trees (it may not
 * contain them, lie in them, or be them). Neither tree needs to exist: a Drive-only restore is for when the local one is gone.
 */
async function checkOutput(outDir: string, forbidden: readonly string[]): Promise<{ exists: boolean }> {
    const invalid = (): WorkerError => new WorkerError("restore-output-invalid");
    if (typeof outDir !== "string" || !path.isAbsolute(outDir) || outDir === "/" || outDir.split("/").slice(1).some((part) => part === "" || part === "." || part === "..")) {
        throw invalid();
    }
    let stat;
    try {
        stat = await fs.lstat(outDir);
    } catch (error) {
        if (!hasCode(error, "ENOENT")) throw invalid();
        stat = null;
    }
    let resolved: string;
    if (stat === null) {
        try {
            resolved = path.join(await fs.realpath(path.dirname(outDir)), path.basename(outDir));
        } catch {
            throw invalid();
        }
    } else {
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw invalid();
        try {
            if ((await fs.readdir(outDir)).length !== 0) throw invalid();
            resolved = await fs.realpath(outDir);
        } catch (error) {
            throw error instanceof WorkerError ? error : invalid();
        }
    }
    for (const tree of forbidden) {
        for (const candidate of new Set([tree, await physicalPath(tree)])) {
            if (inside(candidate, resolved) || inside(resolved, candidate) || inside(candidate, outDir) || inside(outDir, candidate)) throw invalid();
        }
    }
    return { exists: stat !== null };
}

function isNotFound(failure: DriveFailure): boolean {
    return failure.kind === "http" && failure.httpStatus === 404;
}

function isFolder(file: DriveFile): boolean {
    return file.mimeType === DRIVE_FOLDER_MIME;
}

/** An untrashed folder of this archive: the only thing a root can be. */
function isRootOf(file: DriveFile | null, archiveId: string): file is DriveFile {
    return file !== null && isFolder(file) && !file.trashed && file.appProperties[DRIVE_APP_PROPERTY_ARCHIVE_ID] === archiveId;
}

async function resolveRoot(client: DriveClient, archiveId: string, explicit: string | undefined): Promise<DriveFile> {
    if (explicit !== undefined) {
        const found = await client.getFile(explicit);
        if (!found.ok) throw new WorkerError(driveReasonCode(found.failure));
        if (!isRootOf(found.value, archiveId)) throw new WorkerError("drive-root-changed");
        return found.value;
    }
    const discovered = await DriveDestination.discoverRoots(client, "bjjArchiveId", archiveId);
    if (!discovered.ok) throw new WorkerError("failure" in discovered ? driveReasonCode(discovered.failure) : "drive-conflict");
    const roots = discovered.value.filter((file) => isRootOf(file, archiveId));
    if (roots.length !== 1) throw new DriveRootSelectionError(roots.map((file) => file.id).sort());
    return roots[0]!;
}

// ---- what each path of the archive layout must hold -----------------------------------------------------------------

type Kind =
    | { kind: "marker" }
    | { kind: "artifact"; sha256: string }
    | { kind: "manifest"; companyId: string; documentId: string; metadataRevision: string }
    | { kind: "completion"; companyId: string; name: string }
    | { kind: "run"; companyId: string; runId: string };

const COMPLETION_PATH = /^eformsign\/([^/]+)\/completions\/([^/]+)$/;
const RUN_PATH = /^eformsign\/([^/]+)\/runs\/([^/]+)\.json$/;

/** `null` for a path that is not part of the archive layout. */
function classify(key: string): Kind | null {
    if (key === ARCHIVE_MARKER_KEY) return { kind: "marker" };
    const artifact = parseArtifactKey(key);
    if (artifact !== null) return { kind: "artifact", sha256: artifact.sha256 };
    const manifest = parseManifestKey(key);
    if (manifest !== null) return { kind: "manifest", companyId: manifest.companyId, documentId: manifest.documentId, metadataRevision: manifest.metadataRevision };
    const completion = COMPLETION_PATH.exec(key);
    if (completion !== null && isPathIdentifier(completion[1]) && parseCompletionName(completion[2]!) !== null) {
        return { kind: "completion", companyId: completion[1], name: completion[2]! };
    }
    const run = RUN_PATH.exec(key);
    if (run !== null && isPathIdentifier(run[1]) && UUID_V4_PATTERN.test(run[2]!)) return { kind: "run", companyId: run[1], runId: run[2]! };
    return null;
}

interface Verified {
    manifest?: Manifest;
    /** What a completion names: the manifest key and the digest it claims for it. */
    completionEntries?: ReadonlyArray<{ manifestKey: string; manifestSha256: string }>;
}

/** The digest and length of a file that was verified and written. */
interface Held {
    sha256: string;
    byteLength: number;
}

/**
 * A verified record is only as good as what it names. A manifest holds if every artifact it names that was written has the declared
 * length (the digest is bound to the key by the manifest schema); a completion holds if every manifest it names that was written has the
 * digest the completion claims. A reference to something that was not written is not judged here: that file is already in the report,
 * and the record is kept as Drive has it so the unchanged restore fails loudly on it instead of silently taking an older snapshot.
 */
function referencesHold(verified: Verified, held: ReadonlyMap<string, Held>): boolean {
    for (const artifact of verified.manifest?.artifacts ?? []) {
        const file = held.get(artifact.relativeKey);
        if (file !== undefined && (file.sha256 !== artifact.sha256 || file.byteLength !== artifact.byteLength)) return false;
    }
    for (const entry of verified.completionEntries ?? []) {
        const file = held.get(entry.manifestKey);
        if (file !== undefined && file.sha256 !== entry.manifestSha256) return false;
    }
    return true;
}

/** Artifacts first, then the records that name them, then the completions that name those: a record is judged after what it names. */
function rankOf(key: string): number {
    const kind = classify(key);
    return kind === null ? 1 : kind.kind === "artifact" ? 0 : kind.kind === "manifest" ? 2 : kind.kind === "completion" ? 3 : 1;
}

/** What a file held, once downloaded, against what its path claims. `null`: it does not hold up. */
async function verify(kind: Kind, key: string, tmpPath: string, sha256: string, archiveId: string): Promise<Verified | null> {
    if (kind.kind === "artifact") {
        if (sha256 !== kind.sha256) return null;
        const file = await fs.open(tmpPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            return (await checkPdfFile(file)).ok ? {} : null;
        } finally {
            await file.close();
        }
    }
    const bytes = await fs.readFile(tmpPath);
    try {
        switch (kind.kind) {
            case "marker": {
                const marker = parseMarker(bytes);
                return marker !== null && marker.archiveId === archiveId ? {} : null;
            }
            case "manifest":
                return { manifest: parseManifestBytes(bytes, key, kind).manifest };
            case "completion": {
                const selection = selectCompletion([{ name: kind.name, content: JSON.parse(bytes.toString("utf8")) as unknown }], { companyId: kind.companyId, latest: true });
                if (selection.kind !== "selected" || selection.entry.name !== kind.name) return null;
                return { completionEntries: selection.entry.completion.entries.map(({ manifestKey, manifestSha256 }) => ({ manifestKey, manifestSha256 })) };
            }
            case "run": {
                const parsed = runInventorySchema.safeParse(JSON.parse(bytes.toString("utf8")));
                return parsed.success && parsed.data.runId === kind.runId ? {} : null;
            }
        }
    } catch {
        return null;
    }
}

// ---- the walk -------------------------------------------------------------------------------------------------------

interface Listed {
    key: string;
    file: DriveFile;
}

function isSafeName(name: string): boolean {
    return name.length > 0 && !name.includes("/") && isSafeRelativeKey(name);
}

function byKeyThenId(left: Listed, right: Listed): number {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    return left.file.id < right.file.id ? -1 : left.file.id > right.file.id ? 1 : 0;
}

/**
 * Copies the Drive archive into an empty directory, mirror path for mirror path, verifying every file against what its own
 * path claims before it is written (artifacts: the digest in the name and the PDF shape; manifests, completions, run
 * inventories and the marker: their parsers). A file that fails is not written and is listed in the report. Read-only on Drive.
 *
 * Verified bytes are first received in `<out>/.restore-drive-tmp/` and then linked, no-clobber, to their path: a path already
 * taken by another Drive file of the same name is a `drive-conflict`, never an overwrite. The worker removes no file, so the
 * tmp area stays: a file that failed verification, collided, or whose transfer was interrupted is truncated to zero bytes, and a
 * verified one is the same inode as its mirrored file. Records are judged after what they name (artifacts, then manifests, then
 * completions): one whose verified references disagree on digest or length is not written and is reported as `artifact-integrity`.
 */
export async function restoreDrive(options: RestoreDriveOptions): Promise<RestoreDriveReport> {
    const { client, archiveId, outDir } = options;
    const output = await checkOutput(outDir, [options.archivePath, options.controlPath]);
    const root = await resolveRoot(client, archiveId, options.rootFolderId);
    const destination = new DriveDestination(client, {
        rootFolderId: root.id, rootName: root.name, rootParentId: root.parents[0] ?? "root", archiveId,
        bindingId: root.appProperties[DRIVE_APP_PROPERTY_BINDING_ID] ?? "unknown",
        installationId: root.appProperties[DRIVE_APP_PROPERTY_INSTALLATION_ID] ?? "unknown",
    });

    const failures = new Map<string, RestoreDriveFailureReason>();
    const fail = (key: string, reason: RestoreDriveFailureReason): void => { if (!failures.has(key)) failures.set(key, reason); };

    // Pass 1: the whole tree is listed before anything is written, so a listing that fails leaves the output untouched.
    const listed: Listed[] = [];
    const visited = new Set<string>([root.id]);
    const pending: Array<{ id: string; prefix: string }> = [{ id: root.id, prefix: "" }];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        const join = (name: string): string => (next!.prefix === "" ? name : `${next!.prefix}/${name}`);
        for await (const child of destination.listChildren(next.id)) {
            if (!isSafeName(child.name)) {
                fail(join("(unsafe-name)"), "artifact-integrity");
            } else if (isFolder(child)) {
                if (!visited.has(child.id)) {
                    visited.add(child.id);
                    pending.push({ id: child.id, prefix: join(child.name) });
                }
            } else {
                listed.push({ key: join(child.name), file: child });
            }
        }
    }
    listed.sort((left, right) => rankOf(left.key) - rankOf(right.key) || byKeyThenId(left, right));
    // A path that more than one Drive file maps to is ambiguous whichever copy verifies: it is reported once, as `drive-conflict`.
    const copies = new Map<string, number>();
    for (const { key } of listed) copies.set(key, (copies.get(key) ?? 0) + 1);

    // Pass 2: receive, verify, write.
    if (!output.exists) await fs.mkdir(outDir, { mode: 0o700 });
    const tmpDir = path.join(outDir, RESTORE_DRIVE_TMP_NAME);
    await fs.mkdir(tmpDir, { mode: 0o700 });
    const madeDirs = new Set<string>();
    const ensureDirectory = async (dir: string): Promise<void> => {
        const relative = path.relative(outDir, dir);
        let current = outDir;
        for (const segment of relative === "" ? [] : relative.split("/")) {
            current = path.join(current, segment);
            if (madeDirs.has(current)) continue;
            try {
                await fs.mkdir(current, { mode: 0o700 });
            } catch (error) {
                if (!hasCode(error, "EEXIST") || !(await fs.lstat(current)).isDirectory()) throw error;
            }
            madeDirs.add(current);
        }
    };

    const held = new Map<string, Held>();
    const manifests = new Map<string, Manifest>();
    const completions = new Map<string, readonly string[]>();
    let counter = 0;
    for (const { key, file } of listed) {
        const kind = file.mimeType.startsWith(NATIVE_GOOGLE_MIME_PREFIX) ? null : classify(key);
        if (kind === null) {
            fail(key, "artifact-integrity");
            continue;
        }
        const opened = await destination.download(file.id);
        if (!opened.ok) {
            if (!("failure" in opened)) throw new WorkerError("drive-conflict");
            if (!isNotFound(opened.failure)) throw new WorkerError(driveReasonCode(opened.failure));
            fail(key, "mirror-missing");
            continue;
        }

        const tmpPath = path.join(tmpDir, `${String(counter++).padStart(8, "0")}.part`);
        const limit = kind.kind === "artifact" ? Number.POSITIVE_INFINITY : JSON_MAX_BYTES;
        const hash = createHash("sha256");
        let received = 0;
        let tooLong = false;
        let transferred = false;
        const tmp = await fs.open(tmpPath, "wx", 0o600);
        try {
            for await (const part of opened.value) {
                received += part.byteLength;
                if (received > limit) { tooLong = true; break; }
                hash.update(part);
                await tmp.writeFile(part);
            }
            transferred = true;
        } catch (error) {
            if (error instanceof DriveTransferError) throw new WorkerError(driveReasonCode(error.failure));
            throw error;
        } finally {
            await tmp.close();
            // An interrupted transfer must not leave the bytes it did receive behind.
            if (!transferred) await fs.truncate(tmpPath, 0).catch(() => undefined);
        }

        const sha256 = hash.digest("hex");
        const verified = tooLong || (file.size !== null && file.size !== received) ? null : await verify(kind, key, tmpPath, sha256, archiveId);
        if (verified === null || !referencesHold(verified, held)) {
            fail(key, "artifact-integrity");
            await fs.truncate(tmpPath, 0);
            continue;
        }
        const target = path.join(outDir, ...key.split("/"));
        try {
            await ensureDirectory(path.dirname(target));
            await fs.link(tmpPath, target);
        } catch (error) {
            if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTDIR")) throw error;
            fail(key, "drive-conflict");
            await fs.truncate(tmpPath, 0);
            continue;
        }
        held.set(key, { sha256, byteLength: received });
        if (verified.manifest !== undefined) manifests.set(key, verified.manifest);
        if (verified.completionEntries !== undefined) completions.set(key, verified.completionEntries.map((entry) => entry.manifestKey));
    }

    for (const [key, count] of copies) if (count > 1) failures.set(key, "drive-conflict");

    // What a verified record names must be there: a manifest its artifacts, a completion its manifests.
    for (const manifest of manifests.values()) {
        for (const artifact of manifest.artifacts) if (!held.has(artifact.relativeKey)) fail(artifact.relativeKey, "mirror-missing");
    }
    for (const manifestKeys of completions.values()) {
        for (const manifestKey of manifestKeys) if (!held.has(manifestKey)) fail(manifestKey, "mirror-missing");
    }

    const report: RestoreDriveReport = {
        schemaVersion: 1, rootFolderId: root.id, archiveId, verified: [...held.keys()].filter((key) => !failures.has(key)).length, failed: failures.size,
        failures: [...failures].map(([relativeKey, reason]) => ({ relativeKey, reason })).sort((a, b) => (a.relativeKey < b.relativeKey ? -1 : 1)),
    };
    const out = await fs.open(path.join(outDir, RESTORE_DRIVE_REPORT_NAME), "wx", 0o600);
    try {
        await out.writeFile(`${JSON.stringify(report, null, 2)}\n`);
        await out.sync();
    } finally {
        await out.close();
    }
    return report;
}
