import { createHash, randomBytes } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { ArtifactClaim, artifactIdentity, assertCount, canonicalJson } from "domain/eformsign-backup/source-evidence";

export interface LocalArchiveRoot {
    rootPath: string;
    expectedDevice: number;
    expectedInode: number;
    maxBytes: number;
}
export type ArchiveFaultPoint = "write" | "file-sync" | "publish" | "directory-sync" | "cleanup";
export type LocalArchiveResult = Readonly<{
    ok: true;
    artifactId: string;
    relativeKey: string;
    contentSha256: string;
    byteLength: number;
    disposition: "created" | "reused";
}> | Readonly<{ ok: false; error: "INVALID_INPUT" | "ARCHIVE_FAILED" }>;

export interface LocalArchiveOptions {
    /** Replaces the default `${artifactId}.bin` object name. Must be `<64 lowercase hex>.pdf`. */
    objectName?: string;
}

const OBJECT_NAME_PATTERN = /^[0-9a-f]{64}\.pdf$/;
const IO_BYTES = 64 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const WRITABLE_BY_OTHERS = 0o022;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
function fail(): never { throw new Error("Local archive operation failed"); }
function hasCode(error: unknown, code: string): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

/** Inert POSIX filesystem primitive. The caller must independently establish the root identity. */
export class LocalArtifactArchive {
    private readonly config: Readonly<LocalArchiveRoot>;
    constructor(config: LocalArchiveRoot, private readonly before?: (point: ArchiveFaultPoint) => void) {
        this.config = Object.freeze({ ...config });
    }

    private async checkRoot(): Promise<void> {
        const { rootPath, expectedDevice, expectedInode, maxBytes } = this.config;
        if (typeof rootPath !== "string" || !rootPath.startsWith("/") || rootPath === "/" ||
            rootPath.split("/").slice(1).some(part => !part || part === "." || part === "..")) fail();
        assertCount(expectedDevice); assertCount(expectedInode); assertCount(maxBytes);
        const serviceUid = process.getuid?.();
        if (serviceUid === undefined) fail();
        // Checking each ancestor also rejects symlinks that realpath alone would silently resolve.
        const ancestors = ["/"];
        let current = "";
        for (const part of rootPath.slice(1).split("/")) { current += `/${part}`; ancestors.push(current); }
        for (const ancestor of ancestors) {
            const stat = await fs.lstat(ancestor);
            if (!stat.isDirectory() || (stat.mode & WRITABLE_BY_OTHERS) !== 0 ||
                (stat.uid !== 0 && stat.uid !== serviceUid)) fail();
        }
        if (await fs.realpath(rootPath) !== rootPath) fail();
        const root = await fs.lstat(rootPath);
        if (root.dev !== expectedDevice || root.ino !== expectedInode) fail();
    }

    private async verifyFile(file: FileHandle, claim: Readonly<ArtifactClaim>): Promise<void> {
        const initial = await file.stat();
        const serviceUid = process.getuid?.();
        if (!initial.isFile() || initial.size !== claim.byteLength ||
            (initial.mode & WRITABLE_BY_OTHERS) !== 0 || (initial.uid !== 0 && initial.uid !== serviceUid)) fail();
        const buffer = Buffer.alloc(IO_BYTES);
        const hash = createHash("sha256");
        let count = 0;
        while (true) {
            await this.checkRoot();
            const { bytesRead } = await file.read(buffer, 0, buffer.length, count);
            if (bytesRead === 0) break;
            if (bytesRead > claim.byteLength - count) fail();
            hash.update(buffer.subarray(0, bytesRead));
            count += bytesRead;
        }
        const final = await file.stat();
        if (!final.isFile() || final.size !== count || (final.mode & WRITABLE_BY_OTHERS) !== 0 ||
            (final.uid !== 0 && final.uid !== serviceUid) || count !== claim.byteLength ||
            hash.digest("hex") !== claim.contentSha256) fail();
    }

    private async verifyExisting(path: string, claim: Readonly<ArtifactClaim>): Promise<void> {
        await this.checkRoot();
        const entry = await fs.lstat(path);
        if (!entry.isFile()) fail();
        const file = await fs.open(path, READ_FLAGS);
        try {
            const stat = await file.stat();
            if (stat.dev !== entry.dev || stat.ino !== entry.ino) fail();
            await this.verifyFile(file, claim);
            await this.checkRoot();
            this.before?.("file-sync");
            await file.sync();
            const final = await fs.lstat(path);
            if (!final.isFile() || final.dev !== stat.dev || final.ino !== stat.ino) fail();
        } finally { await file.close(); }
    }

    async archive(input: ArtifactClaim, source: AsyncIterable<Uint8Array>, options?: LocalArchiveOptions): Promise<LocalArchiveResult> {
        let claim: Readonly<ArtifactClaim>;
        let artifactId: string;
        let objectName: string | undefined;
        try {
            // Canonical validation rejects accessors/proxies before any field is read or await occurs.
            canonicalJson(input);
            artifactIdentity(input);
            claim = Object.freeze({ companyId: input.companyId, documentId: input.documentId,
                artifactKind: input.artifactKind, contentSha256: input.contentSha256, byteLength: input.byteLength });
            artifactId = artifactIdentity(claim);
            assertCount(this.config.maxBytes);
            if (claim.byteLength > this.config.maxBytes) fail();
            objectName = options?.objectName;
            if (objectName !== undefined && (typeof objectName !== "string" || !OBJECT_NAME_PATTERN.test(objectName))) fail();
        } catch { return Object.freeze({ ok: false, error: "INVALID_INPUT" }); }

        const relativeKey = objectName ?? `${artifactId}.bin`;
        const finalPath = `${this.config.rootPath}/${relativeKey}`;
        let tempPath: string | undefined;
        let tempIdentity: { dev: number; ino: number } | undefined;
        let file: FileHandle | undefined;
        let directory: FileHandle | undefined;
        try {
            await this.checkRoot();
            directory = await fs.open(this.config.rootPath, READ_FLAGS | constants.O_DIRECTORY);
            const root = await directory.stat();
            if (!root.isDirectory() || root.dev !== this.config.expectedDevice || root.ino !== this.config.expectedInode) fail();
            const candidate = `${this.config.rootPath}/.archive-${randomBytes(24).toString("hex")}.tmp`;
            await this.checkRoot();
            file = await fs.open(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
            tempPath = candidate; // Cleanup ownership begins only after exclusive creation succeeds.
            const created = await file.stat();
            tempIdentity = { dev: created.dev, ino: created.ino };
            if (!created.isFile()) fail();
            const hash = createHash("sha256");
            let count = 0;
            for await (const chunk of source) {
                if (!(chunk instanceof Uint8Array)) fail();
                const chunkLength = chunk.byteLength;
                assertCount(chunkLength);
                if (chunkLength > claim.byteLength - count) fail();
                for (let offset = 0; offset < chunkLength; offset += IO_BYTES) {
                    // Own bounded actual bytes across awaits; do not invoke caller-overridden methods.
                    const piece = Buffer.alloc(Math.min(IO_BYTES, chunkLength - offset));
                    for (let index = 0; index < piece.length; index++) {
                        const byte = chunk[offset + index];
                        if (byte === undefined) fail();
                        piece[index] = byte;
                    }
                    hash.update(piece);
                    let written = 0;
                    while (written < piece.length) {
                        await this.checkRoot();
                        this.before?.("write");
                        const result = await file.write(piece, written, piece.length - written, count + written);
                        if (result.bytesWritten <= 0) fail();
                        written += result.bytesWritten;
                    }
                    count += piece.length;
                }
            }
            if (count !== claim.byteLength || hash.digest("hex") !== claim.contentSha256) fail();
            await this.verifyFile(file, claim);
            await this.checkRoot();
            this.before?.("file-sync");
            await file.sync();
            await file.close(); file = undefined;
            await this.checkRoot();
            const entry = await fs.lstat(tempPath);
            if (!entry.isFile() || entry.dev !== tempIdentity.dev || entry.ino !== tempIdentity.ino) fail();
            let disposition: "created" | "reused" = "created";
            this.before?.("publish");
            try { await fs.link(tempPath, finalPath); }
            catch (error) {
                if (!hasCode(error, "EEXIST")) throw error;
                await this.verifyExisting(finalPath, claim);
                disposition = "reused";
            }
            await this.checkRoot();
            this.before?.("cleanup");
            await this.removeOwnTemp(tempPath, tempIdentity);
            tempPath = undefined;
            await this.checkRoot();
            this.before?.("directory-sync");
            await directory.sync();
            await this.checkRoot();
            await directory.close(); directory = undefined;
            return Object.freeze({ ok: true, artifactId, relativeKey, contentSha256: claim.contentSha256,
                byteLength: claim.byteLength, disposition });
        } catch {
            // Never expose source exceptions, paths, identifiers, payloads or low-level causes.
            return Object.freeze({ ok: false, error: "ARCHIVE_FAILED" });
        } finally {
            // Failure after publication retains the final object; retry must verify it in full.
            try { await file?.close(); } catch { /* Failure already yields no successful receipt. */ }
            if (tempPath && tempIdentity) {
                try { this.before?.("cleanup"); await this.removeOwnTemp(tempPath, tempIdentity); }
                catch { /* Fail closed if root/attempt ownership cannot be established. */ }
            }
            try { await directory?.close(); } catch { /* Failure already yields no successful receipt. */ }
        }
    }

    private async removeOwnTemp(path: string, identity: { dev: number; ino: number }): Promise<void> {
        await this.checkRoot();
        const entry = await fs.lstat(path);
        if (!entry.isFile() || entry.dev !== identity.dev || entry.ino !== identity.ino) fail();
        await fs.unlink(path);
    }
}
