import { createHash } from "node:crypto";

import {
    DRIVE_APP_PROPERTY_ARCHIVE_ID, DRIVE_APP_PROPERTY_BINDING_ID, DRIVE_APP_PROPERTY_INSTALLATION_ID, DRIVE_FOLDER_MIME,
    WorkerError, classifyDriveFailure, driveFolderChain, driveMimeOf, driveNameOf,
    type WorkerReasonCode,
} from "domain/eformsign-backup/worker";

import { beforeExecutionEffect, checkExecutionSignal, executionChunks, isExecutionFencedError, type ExecutionEffectFence } from "../execution-effect-fence";
import { DriveTransferError, type DriveClient, type DriveFailure, type DriveFile } from "./drive-client";

const JSON_MIME = "application/json";

/**
 * The node records the runner keeps for the Drive tree (BJJ-456). The destination never touches the ledger itself: it asks
 * for a durable reservation BEFORE the create that uses the id, and reports the create afterwards. `reserve` must not return
 * before the record is durable; a reservation of an id already used or retired is refused by the ledger (the destination
 * always asks Drive for a fresh id first).
 */
export interface DriveNodeLedger {
    current(nodeKey: string): { kind: "folder" | "file"; fileId: string; parentFileId: string; status: "reserved" | "created" } | null;
    reserve(kind: "folder" | "file", nodeKey: string, fileId: string, parentFileId: string): Promise<void>;
    created(nodeKey: string, fileId: string): Promise<void>;
}

export type DriveConflict = "mismatch" | "trashed" | "wrong-parent";

/** Facts of a Drive failure, or a conflict between what the ledger expects and what Drive holds. Never a body or a URL. */
export type DriveStep<T> = { ok: true; value: T } | { ok: false; failure: DriveFailure } | { ok: false; conflict: DriveConflict };

export interface DriveBinding {
    rootFolderId: string;
    rootName: string;
    rootParentId: string;
    bindingId: string;
    installationId: string;
    archiveId: string;
}

export interface DriveArtifactInput {
    relativeKey: string;
    sha256: string;
    byteLength: number;
    artifactIdentity: string;
    /**
     * Take a NEW id instead of resuming the ledger's reservation: set by the caller after an integrity error, so the id of the
     * damaged file is never reused. Without it a reserved id is resumed and a created one is compared.
     */
    freshId?: boolean;
}

export interface DriveExpectation {
    name: string;
    parentFileId: string;
    sha256: string;
    byteLength: number;
    mimeType: string;
}

const step = <T>(value: T): DriveStep<T> => ({ ok: true, value });
const failed = (failure: DriveFailure): DriveStep<never> => ({ ok: false, failure });
const conflict = (kind: DriveConflict): DriveStep<never> => ({ ok: false, conflict: kind });

/** A create or upload whose outcome is unknown (the answer was lost, or the id was already taken): look the id up and compare. */
function isDoubt(failure: DriveFailure): boolean {
    return failure.kind === "network" || failure.kind === "timeout" || (failure.kind === "http" && failure.httpStatus === 409);
}

/** The reason code the worker records for a failed Drive call, by the contract table (`classifyDriveFailure`). */
export function driveReasonCode(failure: DriveFailure): WorkerReasonCode {
    const action = classifyDriveFailure(failure, 1, new Date());
    // A 404 on a call that cannot be absent, and a 409 on a read, mean the tree is not what the ledger says.
    return action.kind === "retry_wait" || action.kind === "blocked" ? action.reasonCode : "drive-conflict";
}

function sameFolder(file: DriveFile, name: string, parentId: string): DriveStep<"ok"> {
    if (file.mimeType !== DRIVE_FOLDER_MIME || file.name !== name) return conflict("mismatch");
    if (file.trashed) return conflict("trashed");
    if (file.parents.length !== 1 || file.parents[0] !== parentId) return conflict("wrong-parent");
    return step("ok");
}

/** Mirrors the local archive on Google Drive, one id per node, reserved in the ledger before it is ever created. */
export class DriveDestination {
    constructor(private readonly client: DriveClient, private readonly binding: DriveBinding) {}

    /** The root still is the folder this binding made: present, untrashed, same name, same parent, same binding id. */
    async checkRoot(effectFence?: ExecutionEffectFence): Promise<DriveStep<"ok" | "changed">> {
        await beforeExecutionEffect(effectFence);
        const { rootFolderId, rootName, rootParentId, bindingId } = this.binding;
        const found = await this.client.getFile(rootFolderId, effectFence);
        if (!found.ok) return failed(found.failure);
        const root = found.value;
        const intact = root !== null && root.mimeType === DRIVE_FOLDER_MIME && !root.trashed && root.name === rootName
            && root.parents.length === 1 && root.parents[0] === rootParentId
            && root.appProperties[DRIVE_APP_PROPERTY_BINDING_ID] === bindingId;
        await beforeExecutionEffect(effectFence);
        return step(intact ? "ok" : "changed");
    }

    /** Makes sure every folder above the file exists and returns the id of the one holding it (the root for a top-level file). */
    async ensureFolderChain(relativeKey: string, ledger: DriveNodeLedger, effectFence?: ExecutionEffectFence): Promise<DriveStep<string>> {
        await beforeExecutionEffect(effectFence);
        let parentId = this.binding.rootFolderId;
        for (const nodeKey of driveFolderChain(relativeKey)) {
            const made = await this.ensureFolder(nodeKey, nodeKey.slice(nodeKey.lastIndexOf("/") + 1), parentId, ledger, effectFence);
            if (!made.ok) return made;
            parentId = made.value;
        }
        await beforeExecutionEffect(effectFence);
        return step(parentId);
    }

    async uploadArtifact(
        input: DriveArtifactInput, parentFileId: string, ledger: DriveNodeLedger, open: (offset: number) => AsyncIterable<Uint8Array>, effectFence?: ExecutionEffectFence,
    ): Promise<DriveStep<{ fileId: string }>> {
        await beforeExecutionEffect(effectFence);
        return this.putFile({
            nodeKey: input.relativeKey, name: driveNameOf(input.relativeKey), mimeType: driveMimeOf(input.relativeKey),
            parentFileId, sha256: input.sha256, byteLength: input.byteLength, fresh: input.freshId === true,
            appProperties: { bjjArtifactIdentity: input.artifactIdentity, bjjSha256: input.sha256 },
        }, ledger, open, effectFence);
    }

    /** Whether the file is what is expected, judged by Drive's checksum or by the bytes themselves; labels are never evidence. */
    async verifyRemote(fileId: string, expect: DriveExpectation, opts: { forceDownload?: boolean } = {}, effectFence?: ExecutionEffectFence): Promise<DriveStep<"ok" | "missing" | "mismatch">> {
        await beforeExecutionEffect(effectFence);
        const found = await this.client.getFile(fileId, effectFence);
        if (!found.ok) return failed(found.failure);
        if (found.value === null) { await beforeExecutionEffect(effectFence); return step("missing"); }
        const checked = await this.inspectFile(found.value, expect, opts.forceDownload === true, effectFence);
        if (checked.ok) { await beforeExecutionEffect(effectFence); return step("ok"); }
        return "failure" in checked ? checked : step("mismatch");
    }

    /** Publishes a record (manifest, completion, run inventory, marker): the same reserve-first upload as an artifact. */
    async publishJson(relativeKey: string, bytes: Uint8Array, ledger: DriveNodeLedger, effectFence?: ExecutionEffectFence): Promise<DriveStep<{ fileId: string; sha256: string }>> {
        await beforeExecutionEffect(effectFence);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const parent = await this.ensureFolderChain(relativeKey, ledger, effectFence);
        if (!parent.ok) return parent;
        const put = await this.putFile({
            nodeKey: relativeKey, name: driveNameOf(relativeKey), mimeType: JSON_MIME, parentFileId: parent.value,
            sha256, byteLength: bytes.byteLength, fresh: false, appProperties: { bjjSha256: sha256 },
        }, ledger, offset => (async function* () { if (offset < bytes.byteLength) yield bytes.subarray(offset); })(), effectFence);
        await beforeExecutionEffect(effectFence);
        return put.ok ? step({ fileId: put.value.fileId, sha256 }) : put;
    }

    /** The content of a file. A body that dies later throws `DriveTransferError` out of the iterable. */
    async download(fileId: string, effectFence?: ExecutionEffectFence): Promise<DriveStep<AsyncIterable<Uint8Array>>> {
        await beforeExecutionEffect(effectFence);
        const result = await this.client.download(fileId, effectFence);
        return result.ok ? step(result.value) : failed(result.failure);
    }

    /** Every untrashed child, page after page. A failed page throws `WorkerError` with the reason code of the failure (A3.1). */
    async *listChildren(folderId: string, effectFence?: ExecutionEffectFence): AsyncIterable<DriveFile> {
        await beforeExecutionEffect(effectFence);
        let pageToken: string | undefined;
        do {
            const page = await this.client.listChildren(folderId, pageToken, effectFence);
            if (!page.ok) throw new WorkerError(driveReasonCode(page.failure));
            for (const file of page.value.files) {
                checkExecutionSignal(effectFence);
                yield file;
            }
            pageToken = page.value.nextPageToken ?? undefined;
        } while (pageToken !== undefined);
    }

    /**
     * Creates the root under the id the ledger already holds (`drive_bound`). A lost answer or a 409 is resolved by looking
     * the id up: the same object is accepted, anything else is a conflict. `parentId` may be the `root` alias.
     */
    static async createRootWithId(
        client: DriveClient, args: { id: string; name: string; parentId: string; installationId: string; archiveId: string; bindingId: string },
    ): Promise<DriveStep<DriveFile>> {
        const appProperties = {
            [DRIVE_APP_PROPERTY_INSTALLATION_ID]: args.installationId,
            [DRIVE_APP_PROPERTY_ARCHIVE_ID]: args.archiveId,
            [DRIVE_APP_PROPERTY_BINDING_ID]: args.bindingId,
        };
        const created = await client.createFolder({ id: args.id, name: args.name, parentId: args.parentId, appProperties });
        let file: DriveFile;
        if (created.ok) {
            file = created.value;
        } else if (isDoubt(created.failure)) {
            const found = await client.getFile(args.id);
            if (!found.ok) return failed(found.failure);
            if (found.value === null) return failed(created.failure);
            file = found.value;
        } else {
            return failed(created.failure);
        }
        let parentId = args.parentId;
        if (parentId === "root") {
            const my = await client.getFile("root");
            if (!my.ok) return failed(my.failure);
            if (my.value === null) return failed({ kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null });
            parentId = my.value.id;
        }
        const checked = sameFolder(file, args.name, parentId);
        if (!checked.ok) return checked;
        for (const [key, value] of Object.entries(appProperties)) {
            if (file.appProperties[key] !== value) return conflict("mismatch");
        }
        return step(file);
    }

    /** Untrashed folders carrying the app property, for recover; the caller decides which one is the root. */
    static async discoverRoots(
        client: DriveClient, key: "bjjInstallationId" | "bjjArchiveId", value: string,
    ): Promise<DriveStep<DriveFile[]>> {
        const found = await client.findFolders({ appPropertyKey: key, appPropertyValue: value });
        return found.ok ? step(found.value) : failed(found.failure);
    }

    // ---- internals -------------------------------------------------------------------------------------------

    /** A new id from Drive, durably reserved in the ledger. Nothing is created before this returns. */
    private async reserveNew(kind: "folder" | "file", nodeKey: string, parentFileId: string, ledger: DriveNodeLedger, effectFence?: ExecutionEffectFence): Promise<DriveStep<string>> {
        await beforeExecutionEffect(effectFence);
        const ids = await this.client.generateIds(1, effectFence);
        if (!ids.ok) return failed(ids.failure);
        const id = ids.value[0]!;
        await beforeExecutionEffect(effectFence);
        checkExecutionSignal(effectFence);
        await ledger.reserve(kind, nodeKey, id, parentFileId);
        await beforeExecutionEffect(effectFence);
        return step(id);
    }

    private async ensureFolder(nodeKey: string, name: string, parentId: string, ledger: DriveNodeLedger, effectFence?: ExecutionEffectFence): Promise<DriveStep<string>> {
        await beforeExecutionEffect(effectFence);
        const current = ledger.current(nodeKey);
        let id: string;
        if (current) {
            if (current.kind !== "folder") return conflict("mismatch");
            if (current.parentFileId !== parentId) return conflict("wrong-parent");
            // A created folder is trusted here; the root was checked by `checkRoot` and a vanished folder surfaces as a 404 below it.
            if (current.status === "created") { await beforeExecutionEffect(effectFence); return step(current.fileId); }
            const found = await this.client.getFile(current.fileId, effectFence);
            if (!found.ok) return failed(found.failure);
            if (found.value !== null) {
                const same = sameFolder(found.value, name, parentId);
                if (!same.ok) return same;
                await ledger.created(nodeKey, current.fileId);
                await beforeExecutionEffect(effectFence);
                return step(current.fileId);
            }
            id = current.fileId;
        } else {
            const reserved = await this.reserveNew("folder", nodeKey, parentId, ledger, effectFence);
            if (!reserved.ok) return reserved;
            id = reserved.value;
        }
        const created = await this.client.createFolder({ id, name, parentId }, effectFence);
        if (!created.ok && !isDoubt(created.failure)) return failed(created.failure);
        // After an answer, a 409 or a lost answer alike, what Drive holds under the id is what counts: look it up and compare.
        const found = await this.client.getFile(id, effectFence);
        if (!found.ok) return failed(found.failure);
        if (found.value === null) {
            // A create that answered ok but whose folder cannot be found is a transient upstream fault; the reservation stays.
            return failed(created.ok ? { kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null } : created.failure);
        }
        const same = sameFolder(found.value, name, parentId);
        if (!same.ok) return same;
        await ledger.created(nodeKey, id);
        await beforeExecutionEffect(effectFence);
        return step(id);
    }

    /**
     * The reserve-first upload shared by artifacts and records. A reserved id is resumed (compare first, upload only if Drive
     * does not know it), a created one is compared, `fresh` takes a new id. A 409 or a lost answer is settled by comparison.
     */
    private async putFile(
        args: {
            nodeKey: string; name: string; mimeType: string; parentFileId: string; sha256: string; byteLength: number;
            fresh: boolean; appProperties: Record<string, string>;
        },
        ledger: DriveNodeLedger, open: (offset: number) => AsyncIterable<Uint8Array>, effectFence?: ExecutionEffectFence,
    ): Promise<DriveStep<{ fileId: string }>> {
        await beforeExecutionEffect(effectFence);
        const { nodeKey, name, mimeType, parentFileId } = args;
        const expect: DriveExpectation = { name, parentFileId, sha256: args.sha256, byteLength: args.byteLength, mimeType };
        const current = ledger.current(nodeKey);
        let id: string | null = null;
        if (current) {
            if (current.kind !== "file") return conflict("mismatch");
            if (!args.fresh) {
                if (current.parentFileId !== parentFileId) return conflict("wrong-parent");
                const found = await this.client.getFile(current.fileId, effectFence);
                if (!found.ok) return failed(found.failure);
                if (found.value !== null) {
                    const same = await this.inspectFile(found.value, expect, false, effectFence);
                    if (!same.ok) return same;
                    if (current.status === "reserved") await ledger.created(nodeKey, current.fileId);
                    await beforeExecutionEffect(effectFence);
                    return step({ fileId: current.fileId });
                }
                // Known to be reserved but never created: the same id is used. Created and gone: the id is dead, take a new one.
                if (current.status === "reserved") id = current.fileId;
            }
        }
        if (id === null) {
            const reserved = await this.reserveNew("file", nodeKey, parentFileId, ledger, effectFence);
            if (!reserved.ok) return reserved;
            id = reserved.value;
        }
        const uploaded = await this.client.uploadResumable({ id, name, parentId: parentFileId, mimeType, appProperties: args.appProperties }, open, args.byteLength, effectFence);
        let file: DriveFile;
        if (uploaded.ok) {
            file = uploaded.value;
        } else if (isDoubt(uploaded.failure)) {
            const found = await this.client.getFile(id, effectFence);
            if (!found.ok) return failed(found.failure);
            if (found.value === null) return failed(uploaded.failure);
            file = found.value;
        } else {
            return failed(uploaded.failure);
        }
        const same = await this.inspectFile(file, expect, false, effectFence);
        if (!same.ok) return same;
        await ledger.created(nodeKey, id);
        await beforeExecutionEffect(effectFence);
        return step({ fileId: id });
    }

    /**
     * Drive's own facts decide: trashed, parent, name, type, size, then the checksum Drive computed, or - when it has none or a
     * download is demanded - the hash of the downloaded bytes. `appProperties` are labels anyone can set and are never read here.
     */
    private async inspectFile(file: DriveFile, expect: DriveExpectation, forceDownload: boolean, effectFence?: ExecutionEffectFence): Promise<DriveStep<"ok">> {
        await beforeExecutionEffect(effectFence);
        if (file.trashed) return conflict("trashed");
        if (file.parents.length !== 1 || file.parents[0] !== expect.parentFileId) return conflict("wrong-parent");
        if (file.name !== expect.name || file.mimeType !== expect.mimeType || file.size !== expect.byteLength) return conflict("mismatch");
        if (file.sha256Checksum !== null) {
            if (file.sha256Checksum !== expect.sha256) return conflict("mismatch");
            if (!forceDownload) { await beforeExecutionEffect(effectFence); return step("ok"); }
        }
        const stream = await this.client.download(file.id, effectFence);
        if (!stream.ok) return failed(stream.failure);
        const hash = createHash("sha256");
        let seen = 0;
        try {
            for await (const part of executionChunks(stream.value, effectFence)) {
                seen += part.byteLength;
                if (seen > expect.byteLength) return conflict("mismatch");
                hash.update(part);
            }
        } catch (error) {
            if (isExecutionFencedError(error)) throw error;
            checkExecutionSignal(effectFence);
            if (error instanceof DriveTransferError) return failed(error.failure);
            throw error;
        }
        await beforeExecutionEffect(effectFence);
        return seen === expect.byteLength && hash.digest("hex") === expect.sha256 ? step("ok") : conflict("mismatch");
    }
}
