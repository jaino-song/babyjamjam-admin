import { createHash, type Hash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { z } from "zod";

import { EXPORT_ARTIFACT_MAX_BYTES } from "domain/eformsign-backup/export/constants";
import { artifactIdentity, canonicalJson } from "domain/eformsign-backup/source-evidence";
import {
    PDF_TAIL_WINDOW, UUID_V4_PATTERN, WorkerError, artifactKey, checkPdfShape, completionKey, identifier, isPathIdentifier,
    isSafeRelativeKey, isoUtc, manifestKey, parseArtifactKey, runKey, type ArchiveArtifactType, type WorkerReasonCode,
} from "domain/eformsign-backup/worker";
import { LocalArtifactArchive, type ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import { publishBytesNoClobber } from "./atomic-file";
import { ExportFailure } from "./export-client";
import { assertSupportedFilesystem, hasRoom, isMountPoint, type FsProbe } from "./fs-probe";
import { checkPdfFile } from "./pdf-check";

export interface LocalDestinationOptions {
    archivePath: string;
    archiveId: string;
    /** Identity of the archive root recorded at install time; checked before every publish. */
    expectedDev: number;
    expectedIno: number;
    reserveBytes: number;
    reserveInodes: number;
    /** Contract W6: the root must be a mount point. Defaults to true; only synthetic tests turn it off. */
    requireMountPoint?: boolean;
}

/** What the runner knows about one artifact; `artifactIdentity` is re-derived and must match. */
export interface ArtifactPublishInput {
    companyId: string;
    documentId: string;
    artifactType: ArchiveArtifactType;
    sha256: string;
    byteLength: number;
    artifactIdentity: string;
}

export type CheckResult = { ok: true } | { ok: false; reasonCode: WorkerReasonCode };
export type PublishResult =
    | { ok: true; relativeKey: string; disposition: "created" | "reused" }
    | { ok: false; reasonCode: WorkerReasonCode };
export interface StagingRoot { path: string; dev: number; ino: number }
export type StagingResult = { ok: true; root: StagingRoot } | { ok: false; reasonCode: WorkerReasonCode };
export interface CompletionFile { name: string; content: unknown }

/** `{archive}/.bjj-backup/installation.json` and `{control}/installation.json` (contract W2). No secrets. */
export const installationMarkerSchema = z.strictObject({
    schemaVersion: z.literal(1),
    installationId: identifier,
    archiveId: identifier,
    createdAt: isoUtc,
});
export type InstallationMarker = z.infer<typeof installationMarkerSchema>;

const MARKER_DIRECTORY = ".bjj-backup";
const MARKER_NAME = "installation.json";
const MARKER_MAX_BYTES = 4096;
const READ_MAX_BYTES = 128 * 1024 * 1024;
const IO_BYTES = 64 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;
const WRITABLE_BY_OTHERS = 0o022;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

const MANIFEST_KEY = /^eformsign\/([^/]+)\/([^/]+)\/manifests\/([0-9a-f]{64})\.json$/;
const COMPLETION_KEY = /^eformsign\/([^/]+)\/completions\/(\d{12})-([0-9a-f]{64})\.json$/;
const RUN_KEY = /^eformsign\/([^/]+)\/runs\/([^/]+)\.json$/;

function hasCode(error: unknown, code: string): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
function reasonOf(error: unknown): WorkerReasonCode {
    return error instanceof WorkerError ? error.reasonCode : "archive-unavailable";
}
function ok(): CheckResult { return { ok: true }; }
function refuse(reasonCode: WorkerReasonCode): { ok: false; reasonCode: WorkerReasonCode } { return { ok: false, reasonCode }; }

/** True for exactly the keys `manifestKey`, `completionKey` and `runKey` can produce. */
function isJsonKey(key: string): boolean {
    try {
        let match = MANIFEST_KEY.exec(key);
        if (match) return manifestKey({ companyId: match[1]!, documentId: match[2]!, metadataRevision: match[3]! }) === key;
        match = COMPLETION_KEY.exec(key);
        if (match) return completionKey({ companyId: match[1]!, sequence: Number(match[2]), contentDigest: match[3]! }) === key;
        match = RUN_KEY.exec(key);
        if (match) return runKey({ companyId: match[1]!, runId: match[2]! }) === key;
    } catch { /* a segment the builders reject is not a valid key */ }
    return false;
}

interface SourceState {
    failure: unknown;
}

/**
 * Wraps the byte source so the destination can tell WHY the archive primitive failed (the primitive reports only
 * `ARCHIVE_FAILED`). It stops at the first byte over the claim, checks length and sha256 at the end, and applies the
 * PDF shape check to the first 5 and last 1024 bytes BEFORE the stream ends, so non-PDF bytes never get published.
 */
function observe(source: AsyncIterable<Uint8Array>, input: ArtifactPublishInput): { iterable: AsyncIterable<Uint8Array>; state: SourceState } {
    const state: SourceState = { failure: undefined };
    const hash: Hash = createHash("sha256");
    async function* iterate(): AsyncGenerator<Uint8Array> {
        try {
            let count = 0;
            let head = Buffer.alloc(0);
            let tail = Buffer.alloc(0);
            for await (const chunk of source) {
                if (!(chunk instanceof Uint8Array)) throw new WorkerError("export-response-invalid");
                count += chunk.byteLength;
                if (count > input.byteLength) throw new WorkerError("artifact-integrity");
                const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                hash.update(view);
                if (head.length < 5) head = Buffer.concat([head, view.subarray(0, 5 - head.length)]);
                tail = view.length >= PDF_TAIL_WINDOW
                    ? Buffer.from(view.subarray(view.length - PDF_TAIL_WINDOW))
                    : Buffer.concat([tail, view]).subarray(-PDF_TAIL_WINDOW);
                yield chunk;
            }
            if (count !== input.byteLength || hash.digest("hex") !== input.sha256) throw new WorkerError("artifact-integrity");
            if (!checkPdfShape(head, tail, count).ok) throw new WorkerError("pdf-shape");
        } catch (error) {
            state.failure = error;
            throw error;
        }
    }
    return { iterable: iterate(), state };
}

/** Local archive destination (contract W2-W8): root identity, marker, space, safe directories, publish and verify. */
export class LocalDestination {
    private readonly requireMount: boolean;

    constructor(
        private readonly options: LocalDestinationOptions,
        private readonly probe: FsProbe,
        private readonly fault?: (point: ArchiveFaultPoint) => void,
    ) {
        const { archivePath, expectedDev, expectedIno, reserveBytes, reserveInodes } = options;
        const absolute = typeof archivePath === "string" && archivePath.startsWith("/") && archivePath !== "/"
            && archivePath.split("/").slice(1).every(part => part !== "" && part !== "." && part !== "..");
        if (!absolute || ![expectedDev, expectedIno, reserveBytes, reserveInodes].every(n => Number.isSafeInteger(n) && n >= 0)) {
            throw new WorkerError("config-invalid");
        }
        this.requireMount = options.requireMountPoint !== false;
    }

    // ---- identity, marker, space -------------------------------------------------------------------------------

    private async rootIdentityReason(): Promise<WorkerReasonCode | null> {
        const { archivePath, expectedDev, expectedIno } = this.options;
        let stat;
        try {
            stat = await fs.lstat(archivePath);
        } catch {
            return "archive-unavailable";
        }
        if (!stat.isDirectory() || stat.dev !== expectedDev || stat.ino !== expectedIno) return "archive-identity-mismatch";
        try {
            if (await fs.realpath(archivePath) !== archivePath) return "archive-unsafe-path";
        } catch {
            return "archive-unavailable";
        }
        return null;
    }

    private async assertRootIdentity(): Promise<void> {
        const reason = await this.rootIdentityReason();
        if (reason) throw new WorkerError(reason);
    }

    private async markerValid(): Promise<boolean> {
        const directory = `${this.options.archivePath}/${MARKER_DIRECTORY}`;
        let file: FileHandle | undefined;
        try {
            if (!(await fs.lstat(directory)).isDirectory()) return false;
            const entry = await fs.lstat(`${directory}/${MARKER_NAME}`);
            if (!entry.isFile() || entry.size > MARKER_MAX_BYTES || (entry.mode & WRITABLE_BY_OTHERS) !== 0) return false;
            file = await fs.open(`${directory}/${MARKER_NAME}`, READ_FLAGS);
            const stat = await file.stat();
            if (stat.dev !== entry.dev || stat.ino !== entry.ino) return false;
            const buffer = Buffer.alloc(stat.size);
            let filled = 0;
            while (filled < buffer.length) {
                const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, filled);
                if (bytesRead === 0) break;
                filled += bytesRead;
            }
            const parsed = installationMarkerSchema.safeParse(JSON.parse(buffer.subarray(0, filled).toString("utf8")));
            return parsed.success && parsed.data.archiveId === this.options.archiveId;
        } catch {
            return false;
        } finally {
            try { await file?.close(); } catch { /* read-only handle */ }
        }
    }

    /** Shared by `checkArchive`, `writeMarker` and the write paths; `room` is the incoming byte count, or null to skip the space check. */
    private async verifyRoot(room: number | null, needMarker: boolean): Promise<CheckResult> {
        const { archivePath, reserveBytes, reserveInodes } = this.options;
        const identity = await this.rootIdentityReason();
        if (identity) return refuse(identity);
        try {
            const stat = await fs.lstat(archivePath);
            if ((stat.mode & WRITABLE_BY_OTHERS) !== 0) return refuse("archive-unsafe-path");
            await fs.access(archivePath, constants.W_OK | constants.X_OK);
        } catch {
            return refuse("archive-unavailable");
        }
        try {
            if (this.requireMount && !await isMountPoint(archivePath)) return refuse("archive-not-mount-point");
        } catch (error) {
            return refuse(reasonOf(error));
        }
        if (needMarker && !await this.markerValid()) return refuse("archive-marker-invalid");
        try {
            await assertSupportedFilesystem(this.probe, archivePath);
            if (room !== null && !await hasRoom(this.probe, archivePath, room, reserveBytes, reserveInodes)) return refuse("archive-space");
        } catch (error) {
            return refuse(reasonOf(error));
        }
        return ok();
    }

    /**
     * Root lstat dev/ino equals the installed identity, realpath equals the path, the marker parses and names this
     * archive, the filesystem is allowed, there is room (plus `incomingBytes`), and the root is a mount point when
     * required. Never creates anything.
     */
    async checkArchive(incomingBytes = 0): Promise<CheckResult> {
        const bytes = Number.isSafeInteger(incomingBytes) && incomingBytes >= 0 ? incomingBytes : 0;
        return this.verifyRoot(bytes, true);
    }

    /** `init` only: the root must hold nothing but possibly an empty `eformsign/` (and mkfs's `lost+found`). */
    async writeMarker(installation: unknown): Promise<CheckResult> {
        try {
            const parsed = installationMarkerSchema.safeParse(installation);
            if (!parsed.success || parsed.data.archiveId !== this.options.archiveId) return refuse("archive-marker-invalid");
            const bytes = Buffer.from(`${canonicalJson(parsed.data)}\n`, "utf8");
            const gate = await this.verifyRoot(bytes.length, false);
            if (!gate.ok) return gate;
            for (const entry of await fs.readdir(this.options.archivePath)) {
                const stat = await fs.lstat(`${this.options.archivePath}/${entry}`);
                const allowed = stat.isDirectory() && (entry === "lost+found"
                    || (entry === "eformsign" && (await fs.readdir(`${this.options.archivePath}/eformsign`)).length === 0));
                if (!allowed) return refuse("archive-conflict");
            }
            const directory = await this.ensureDirectories([MARKER_DIRECTORY]);
            const recheck = await this.verifyRoot(null, false);
            if (!recheck.ok) return recheck;
            await publishBytesNoClobber(directory, MARKER_NAME, bytes, { fault: this.fault });
            return await this.verifyRoot(null, true);
        } catch (error) {
            return refuse(reasonOf(error));
        }
    }

    // ---- safe directories --------------------------------------------------------------------------------------

    /** Creates missing segments one by one (0700), each time requiring a real directory, owned by this uid, not group/other-writable. */
    private async ensureDirectories(segments: readonly string[]): Promise<string> {
        const uid = process.getuid?.();
        let current = this.options.archivePath;
        for (const segment of segments) {
            current = `${current}/${segment}`;
            try {
                await fs.mkdir(current, { mode: 0o700 });
            } catch (error) {
                if (!hasCode(error, "EEXIST")) throw new WorkerError(hasCode(error, "ENOSPC") ? "archive-space" : "archive-unavailable");
            }
            let stat;
            try {
                stat = await fs.lstat(current);
            } catch {
                throw new WorkerError("archive-unavailable");
            }
            if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & WRITABLE_BY_OTHERS) !== 0) throw new WorkerError("archive-unsafe-path");
            // A segment on another device means the archive root was unmounted under us: this is the root disk.
            if (stat.dev !== this.options.expectedDev) throw new WorkerError("archive-identity-mismatch");
        }
        return current;
    }

    /** Walks existing segments without creating any; `null` when one is missing, throws on a symlink or non-directory. */
    private async walkExisting(segments: readonly string[]): Promise<string | null> {
        await this.assertRootIdentity();
        let current = this.options.archivePath;
        for (const segment of segments) {
            current = `${current}/${segment}`;
            let stat;
            try {
                stat = await fs.lstat(current);
            } catch (error) {
                if (hasCode(error, "ENOENT")) return null;
                throw new WorkerError("archive-unavailable");
            }
            if (!stat.isDirectory()) throw new WorkerError("archive-unsafe-path");
        }
        return current;
    }

    private async syncDirectory(directoryPath: string): Promise<void> {
        const directory = await fs.open(directoryPath, DIRECTORY_FLAGS);
        try { await directory.sync(); } finally { await directory.close(); }
    }

    // ---- publishing --------------------------------------------------------------------------------------------

    /** Hashes the entry at `target`: `same`, `different`, or `unsafe` for a symlink; `null` when nothing is there. */
    private async compareFinal(target: string, input: ArtifactPublishInput): Promise<"same" | "different" | "unsafe" | null> {
        let entry;
        try {
            entry = await fs.lstat(target);
        } catch {
            return null;
        }
        if (entry.isSymbolicLink()) return "unsafe";
        if (!entry.isFile() || entry.size !== input.byteLength) return "different";
        let file: FileHandle | undefined;
        try {
            file = await fs.open(target, READ_FLAGS);
            const hash = createHash("sha256");
            const buffer = Buffer.alloc(IO_BYTES);
            let position = 0;
            while (true) {
                const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
                if (bytesRead === 0) break;
                hash.update(buffer.subarray(0, bytesRead));
                position += bytesRead;
            }
            return hash.digest("hex") === input.sha256 ? "same" : "different";
        } catch {
            return null;
        } finally {
            try { await file?.close(); } catch { /* read-only handle */ }
        }
    }

    private async classifyFailure(state: SourceState, input: ArtifactPublishInput, target: string, ioCode: WorkerReasonCode): Promise<WorkerReasonCode> {
        if (state.failure instanceof WorkerError) return state.failure.reasonCode;
        if (state.failure instanceof ExportFailure) return "network-timeout";
        if (state.failure !== undefined) return "internal";
        // The primitive failed on its own: an existing object with other bytes is a conflict, anything else is I/O.
        const found = await this.compareFinal(target, input);
        if (found === "unsafe") return "archive-unsafe-path";
        if (found === "different") return "archive-conflict";
        return ioCode;
    }

    private validateClaim(input: ArtifactPublishInput): WorkerReasonCode | null {
        try {
            artifactKey(input);
        } catch {
            return "invalid-path-segment";
        }
        try {
            if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) return "export-response-invalid";
            const expected = artifactIdentity({
                companyId: input.companyId, documentId: input.documentId, artifactKind: input.artifactType,
                contentSha256: input.sha256, byteLength: input.byteLength,
            });
            if (expected !== input.artifactIdentity) return "export-response-invalid";
        } catch {
            return "export-response-invalid";
        }
        return input.byteLength > EXPORT_ARTIFACT_MAX_BYTES ? "artifact-too-large" : null;
    }

    /** Runs the archive primitive on `root` and turns its two failure kinds into reason codes. */
    private async runPrimitive(
        root: { path: string; dev: number; ino: number }, input: ArtifactPublishInput, source: AsyncIterable<Uint8Array>,
        objectName: string | undefined, ioCode: WorkerReasonCode,
    ): Promise<{ ok: true; relativeKey: string; disposition: "created" | "reused" } | { ok: false; reasonCode: WorkerReasonCode }> {
        const observed = observe(source, input);
        const primitive = new LocalArtifactArchive({
            rootPath: root.path, expectedDevice: root.dev, expectedInode: root.ino, maxBytes: EXPORT_ARTIFACT_MAX_BYTES,
        }, this.fault);
        const result = await primitive.archive({
            companyId: input.companyId, documentId: input.documentId, artifactKind: input.artifactType,
            contentSha256: input.sha256, byteLength: input.byteLength,
        }, observed.iterable, objectName === undefined ? undefined : { objectName });
        if (result.ok) return { ok: true, relativeKey: result.relativeKey, disposition: result.disposition };
        if (result.error === "INVALID_INPUT") return refuse("export-response-invalid");
        const name = objectName ?? `${input.artifactIdentity}.bin`;
        return refuse(await this.classifyFailure(observed.state, input, `${root.path}/${name}`, ioCode));
    }

    private async pdfShapeOf(target: string): Promise<boolean> {
        let file: FileHandle | undefined;
        try {
            const entry = await fs.lstat(target);
            if (!entry.isFile()) return false;
            file = await fs.open(target, READ_FLAGS);
            const stat = await file.stat();
            return stat.dev === entry.dev && stat.ino === entry.ino && (await checkPdfFile(file)).ok;
        } catch {
            return false;
        } finally {
            try { await file?.close(); } catch { /* read-only handle */ }
        }
    }

    /**
     * Publishes one artifact: `checkArchive()` first (every call), safe leaf directories, `checkArchive()` again once
     * the leaf exists, the primitive into the leaf as `<sha256>.pdf`, then a PDF re-check of the final file and a
     * last `checkArchive()`. Any failure is a reason code; nothing is ever deleted.
     */
    async publishArtifact(input: ArtifactPublishInput, source: AsyncIterable<Uint8Array>): Promise<PublishResult> {
        try {
            const first = await this.checkArchive(input.byteLength);
            if (!first.ok) return first;
            const invalid = this.validateClaim(input);
            if (invalid) return refuse(invalid);
            const key = artifactKey(input);
            const leaf = await this.ensureDirectories(key.split("/").slice(0, -1));
            const second = await this.checkArchive(input.byteLength);
            if (!second.ok) return second;
            const stat = await fs.lstat(leaf);
            const objectName = `${input.sha256}.pdf`;
            const result = await this.runPrimitive({ path: leaf, dev: stat.dev, ino: stat.ino }, input, source, objectName, "archive-unavailable");
            if (!result.ok) return result;
            if (!await this.pdfShapeOf(`${leaf}/${objectName}`)) return refuse("pdf-shape");
            // Identity and marker only: room dropping after the publish must not turn a success into a failure.
            const last = await this.verifyRoot(null, true);
            if (!last.ok) return last;
            return { ok: true, relativeKey: key, disposition: result.disposition };
        } catch (error) {
            return refuse(reasonOf(error));
        }
    }

    /** Writes a manifest, completion or run inventory (`publishJson`'s key must be one of those three shapes). */
    async publishJson(relativeKey: string, bytes: Uint8Array): Promise<PublishResult> {
        try {
            if (!isJsonKey(relativeKey)) return refuse("invalid-path-segment");
            if (bytes.byteLength > EXPORT_ARTIFACT_MAX_BYTES) return refuse("artifact-too-large");
            const first = await this.verifyRoot(bytes.byteLength, true);
            if (!first.ok) return first;
            const segments = relativeKey.split("/");
            const name = segments.pop()!;
            const directory = await this.ensureDirectories(segments);
            const second = await this.verifyRoot(null, true);
            if (!second.ok) return second;
            const { disposition } = await publishBytesNoClobber(directory, name, bytes, { fault: this.fault });
            const last = await this.verifyRoot(null, true);
            if (!last.ok) return last;
            return { ok: true, relativeKey, disposition };
        } catch (error) {
            return refuse(reasonOf(error));
        }
    }

    // ---- staging (control side) --------------------------------------------------------------------------------

    /** `<control>/staging`: created 0700 if missing, then required to be a real directory of this uid, not group/other-writable. */
    async ensureStaging(controlPath: string): Promise<StagingResult> {
        try {
            if (typeof controlPath !== "string" || !controlPath.startsWith("/")) return refuse("control-unavailable");
            const stagingPath = `${controlPath}/staging`;
            try {
                await fs.mkdir(stagingPath, { mode: 0o700 });
            } catch (error) {
                if (!hasCode(error, "EEXIST")) return refuse(hasCode(error, "ENOSPC") ? "control-space" : "control-unavailable");
            }
            const stat = await fs.lstat(stagingPath);
            if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & WRITABLE_BY_OTHERS) !== 0) {
                return refuse("control-unavailable");
            }
            return { ok: true, root: { path: stagingPath, dev: stat.dev, ino: stat.ino } };
        } catch {
            return refuse("control-unavailable");
        }
    }

    /** The primitive, unchanged, on `<control>/staging` (flat `<artifactIdentity>.bin`), plus the PDF check. */
    async stageArtifact(root: StagingRoot, input: ArtifactPublishInput, source: AsyncIterable<Uint8Array>): Promise<PublishResult> {
        try {
            const invalid = this.validateClaim(input);
            if (invalid) return refuse(invalid);
            const result = await this.runPrimitive(root, input, source, undefined, "control-unavailable");
            if (!result.ok) return result;
            if (!await this.pdfShapeOf(`${root.path}/${result.relativeKey}`)) return refuse("pdf-shape");
            return result;
        } catch {
            return refuse("control-unavailable");
        }
    }

    /** Streams a staged file back (O_RDONLY|O_NOFOLLOW). Errors are `WorkerError`s raised when iteration starts. */
    async *openStaged(root: StagingRoot, identity: string): AsyncGenerator<Uint8Array> {
        if (typeof identity !== "string" || !HEX64.test(identity)) throw new WorkerError("invalid-path-segment");
        let file: FileHandle | undefined;
        try {
            const rootStat = await fs.lstat(root.path);
            if (!rootStat.isDirectory() || rootStat.dev !== root.dev || rootStat.ino !== root.ino) throw new WorkerError("control-unavailable");
            const target = `${root.path}/${identity}.bin`;
            const entry = await fs.lstat(target);
            if (!entry.isFile()) throw new WorkerError("control-unavailable");
            file = await fs.open(target, READ_FLAGS);
            const stat = await file.stat();
            if (stat.dev !== entry.dev || stat.ino !== entry.ino) throw new WorkerError("control-unavailable");
            let position = 0;
            while (true) {
                const buffer = Buffer.alloc(IO_BYTES);
                const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
                if (bytesRead === 0) break;
                position += bytesRead;
                yield buffer.subarray(0, bytesRead);
            }
        } catch (error) {
            throw error instanceof WorkerError ? error : new WorkerError("control-unavailable");
        } finally {
            try { await file?.close(); } catch { /* read-only handle */ }
        }
    }

    // ---- verifying, quarantining, reading ----------------------------------------------------------------------

    /**
     * Re-reads a published artifact: `missing` when the file (or a directory above it) is absent, `mismatch` for
     * anything that is not a regular file of exactly `byteLength` bytes with the key's sha256 and a PDF shape.
     * Throws `invalid-path-segment`, `archive-unsafe-path` (symlink on the way) or the root-identity reason.
     */
    async reverify(relativeKey: string, sha256: string, byteLength: number): Promise<"ok" | "missing" | "mismatch"> {
        const parsed = parseArtifactKey(relativeKey);
        if (!parsed) throw new WorkerError("invalid-path-segment");
        const directory = await this.walkExisting(relativeKey.split("/").slice(0, -1));
        if (parsed.sha256 !== sha256) return "mismatch";
        if (directory === null) return "missing";
        const target = `${directory}/${parsed.sha256}.pdf`;
        let entry;
        try {
            entry = await fs.lstat(target);
        } catch (error) {
            if (hasCode(error, "ENOENT")) return "missing";
            throw new WorkerError("archive-unavailable");
        }
        if (!entry.isFile() || entry.size !== byteLength) return "mismatch";
        const same = await this.compareFinal(target, { sha256, byteLength } as ArtifactPublishInput);
        if (same !== "same") return "mismatch";
        return await this.pdfShapeOf(target) ? "ok" : "mismatch";
    }

    /** Renames a damaged artifact to `<name>.corrupt-<runId>` in the same directory. Never deletes, never overwrites. */
    async quarantineCorrupt(relativeKey: string, runId: string): Promise<string> {
        const parsed = parseArtifactKey(relativeKey);
        if (!parsed || typeof runId !== "string" || !UUID_V4_PATTERN.test(runId)) throw new WorkerError("invalid-path-segment");
        const gate = await this.verifyRoot(null, true);
        if (!gate.ok) throw new WorkerError(gate.reasonCode);
        const directory = await this.walkExisting(relativeKey.split("/").slice(0, -1));
        if (directory === null) throw new WorkerError("archive-unavailable");
        const source = `${directory}/${parsed.sha256}.pdf`;
        const target = `${source}.corrupt-${runId}`;
        let entry;
        try {
            entry = await fs.lstat(source);
        } catch {
            throw new WorkerError("archive-unavailable");
        }
        if (!entry.isFile()) throw new WorkerError("archive-unsafe-path");
        if (await fs.lstat(target).then(() => true, () => false)) throw new WorkerError("archive-conflict");
        try {
            await fs.rename(source, target);
            await this.syncDirectory(directory);
        } catch {
            throw new WorkerError("archive-unavailable");
        }
        await this.assertRootIdentity();
        return `${relativeKey}.corrupt-${runId}`;
    }

    /** Read-only. Entries of `completions/` as (name, parsed JSON or null); a symlink there is refused, directories are skipped. */
    async listCompletions(companyId: string): Promise<CompletionFile[]> {
        if (!isPathIdentifier(companyId)) throw new WorkerError("invalid-path-segment");
        const directory = await this.walkExisting(["eformsign", companyId, "completions"]);
        if (directory === null) return [];
        const files: CompletionFile[] = [];
        for (const name of (await fs.readdir(directory)).sort()) {
            const entry = await fs.lstat(`${directory}/${name}`);
            if (entry.isSymbolicLink()) throw new WorkerError("archive-unsafe-path");
            if (!entry.isFile()) continue;
            const bytes = await this.readFileNoFollow(`${directory}/${name}`);
            let content: unknown = null;
            try { content = bytes === null ? null : JSON.parse(bytes.toString("utf8")); } catch { content = null; }
            files.push({ name, content });
        }
        return files;
    }

    /** Read-only. The bytes of an archive file, or `null` when it does not exist. Symlinks are refused. */
    async readArchiveFile(relativeKey: string): Promise<Buffer | null> {
        if (typeof relativeKey !== "string" || !isSafeRelativeKey(relativeKey)) throw new WorkerError("invalid-path-segment");
        const segments = relativeKey.split("/");
        const name = segments.pop()!;
        const directory = await this.walkExisting(segments);
        if (directory === null) return null;
        return this.readFileNoFollow(`${directory}/${name}`);
    }

    private async readFileNoFollow(target: string): Promise<Buffer | null> {
        let entry;
        try {
            entry = await fs.lstat(target);
        } catch (error) {
            if (hasCode(error, "ENOENT")) return null;
            throw new WorkerError("archive-unavailable");
        }
        if (!entry.isFile()) throw new WorkerError("archive-unsafe-path");
        if (entry.size > READ_MAX_BYTES) throw new WorkerError("artifact-too-large");
        let file: FileHandle | undefined;
        try {
            file = await fs.open(target, READ_FLAGS);
            const stat = await file.stat();
            if (stat.dev !== entry.dev || stat.ino !== entry.ino) throw new WorkerError("archive-unsafe-path");
            const buffer = Buffer.alloc(stat.size);
            let filled = 0;
            while (filled < buffer.length) {
                const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, filled);
                if (bytesRead === 0) break;
                filled += bytesRead;
            }
            return buffer.subarray(0, filled);
        } catch (error) {
            throw error instanceof WorkerError ? error : new WorkerError("archive-unavailable");
        } finally {
            try { await file?.close(); } catch { /* read-only handle */ }
        }
    }
}
