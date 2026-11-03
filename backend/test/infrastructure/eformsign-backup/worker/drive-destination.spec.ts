import { createHash, randomUUID } from "node:crypto";

import { WorkerError } from "domain/eformsign-backup/worker";
import {
    DriveDestination, type DriveNodeLedger, type DriveStep,
} from "infrastructure/eformsign-backup/worker/drive-destination";
import type { DriveClient, DriveFile } from "infrastructure/eformsign-backup/worker/drive-client";

import { driveFaults } from "./helpers/fake-drive-server";
import { bytesFrom, makeDriveClient, startDriveFakes, type DriveHarness } from "./helpers/drive-support";

const CHUNK = 262144;
const PDF = "application/pdf";
const FOLDER = "application/vnd.google-apps.folder";
const ROOT_NAME = "bjj-eformsign-backup";
const INSTALLATION = "inst-0001";
const ARCHIVE = "arch-0001";
const KEY = "eformsign/co-1/doc-1/artifacts/document/art-1.pdf";
const KEY_FOLDERS = ["eformsign", "eformsign/co-1", "eformsign/co-1/doc-1", "eformsign/co-1/doc-1/artifacts", "eformsign/co-1/doc-1/artifacts/document"];

function data(length: number, salt = 0): Buffer {
    const out = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) out[index] = (index * 31 + 7 + (index >> 8) + salt) & 0xff;
    return out;
}
const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function expectStep<T>(step: DriveStep<T>): T {
    if (!step.ok) throw new Error(`expected ok, got ${JSON.stringify(step)}`);
    return step.value;
}

async function collect(files: AsyncIterable<DriveFile>): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    for await (const file of files) out.push(file);
    return out;
}

/** Setup helpers that create remote objects the way an earlier, interrupted attempt would have. */
const DriveDestinationTestAccess = {
    async createFolderRemotely(client: DriveClient, id: string, name: string, parentId: string): Promise<DriveStep<DriveFile>> {
        const result = await client.createFolder({ id, name, parentId });
        return result.ok ? { ok: true, value: result.value } : { ok: false, failure: result.failure };
    },
};

interface LedgerNode { kind: "folder" | "file"; fileId: string; parentFileId: string; status: "reserved" | "created" }

/** In-memory stand-in for the runner's ledger: durable by construction, with the id rules of the real one. */
class MemoryLedger implements DriveNodeLedger {
    readonly nodes = new Map<string, LedgerNode>();
    readonly events: string[] = [];
    private readonly retired = new Set<string>();
    /** Runs right after a reservation is recorded: a crash point, or a remote object that appears behind the destination's back. */
    afterReserve: ((node: { kind: "folder" | "file"; nodeKey: string; fileId: string; parentFileId: string }) => Promise<void>) | null = null;
    rejectReserve: Error | null = null;

    current(nodeKey: string): LedgerNode | null {
        const node = this.nodes.get(nodeKey);
        return node ? { ...node } : null;
    }

    async reserve(kind: "folder" | "file", nodeKey: string, fileId: string, parentFileId: string): Promise<void> {
        if (this.rejectReserve) throw this.rejectReserve;
        const old = this.nodes.get(nodeKey);
        if (this.retired.has(fileId) || old?.fileId === fileId) throw new Error("ledger-inconsistent: id reused");
        if (old) this.retired.add(old.fileId);
        this.nodes.set(nodeKey, { kind, fileId, parentFileId, status: "reserved" });
        this.events.push(`reserve:${nodeKey}`);
        if (this.afterReserve) await this.afterReserve({ kind, nodeKey, fileId, parentFileId });
    }

    async created(nodeKey: string, fileId: string): Promise<void> {
        const node = this.nodes.get(nodeKey);
        if (!node || node.fileId !== fileId) throw new Error("ledger-inconsistent: not the current reservation");
        node.status = "created";
        this.events.push(`created:${nodeKey}`);
    }
}

describe("DriveDestination", () => {
    let h: DriveHarness;
    let client: DriveClient;
    let dest: DriveDestination;
    let ledger: MemoryLedger;
    let rootId: string;
    let bindingId: string;

    const binding = () => ({
        rootFolderId: rootId, rootName: ROOT_NAME, rootParentId: h.drive.myDriveId, bindingId, installationId: INSTALLATION, archiveId: ARCHIVE,
    });

    async function freshId(): Promise<string> {
        const ids = await client.generateIds(1);
        if (!ids.ok) throw new Error("generateIds failed");
        return ids.value[0]!;
    }

    beforeEach(async () => {
        h = await startDriveFakes();
        client = makeDriveClient(h, { chunkBytes: CHUNK, requestTimeoutMs: 2000 }).client;
        bindingId = randomUUID();
        rootId = await freshId();
        expectStep(await DriveDestination.createRootWithId(client, {
            id: rootId, name: ROOT_NAME, parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: ARCHIVE, bindingId,
        }));
        dest = new DriveDestination(client, binding());
        ledger = new MemoryLedger();
    });
    afterEach(async () => { await h.close(); });

    const artifactInput = (bytes: Buffer, relativeKey = KEY, freshId?: boolean) => ({
        relativeKey, sha256: sha256Of(bytes), byteLength: bytes.length, artifactIdentity: sha256Of(Buffer.from(relativeKey)),
        ...(freshId === undefined ? {} : { freshId }),
    });
    const expectOf = (bytes: Buffer, parentFileId: string, name = "art-1.pdf") => ({
        name, parentFileId, sha256: sha256Of(bytes), byteLength: bytes.length, mimeType: PDF,
    });
    async function parentOf(relativeKey = KEY): Promise<string> {
        return expectStep(await dest.ensureFolderChain(relativeKey, ledger));
    }
    async function upload(bytes: Buffer, relativeKey = KEY, freshId?: boolean): Promise<{ fileId: string; parent: string }> {
        const parent = await parentOf(relativeKey);
        const { fileId } = expectStep(await dest.uploadArtifact(artifactInput(bytes, relativeKey, freshId), parent, ledger, bytesFrom(bytes, 1000)));
        return { fileId, parent };
    }

    describe("root (createRootWithId, discoverRoots, checkRoot)", () => {
        it("should bind the root with the pre-generated id and the three app properties", () => {
            const root = h.drive.node(rootId)!;
            expect(root).toMatchObject({ id: rootId, name: ROOT_NAME, mimeType: FOLDER, parents: [h.drive.myDriveId], trashed: false });
            expect(root.appProperties).toEqual({ bjjInstallationId: INSTALLATION, bjjArchiveId: ARCHIVE, bjjBindingId: bindingId });
        });

        it("should accept the root alias as parent, also when the response is lost (T17 root)", async () => {
            const id = await freshId();
            h.drive.addFault({ route: "create", times: 1, action: driveFaults.lostResponse() });
            const before = h.drive.creates;
            const root = expectStep(await DriveDestination.createRootWithId(client, {
                id, name: "alias-root", parentId: "root", installationId: INSTALLATION, archiveId: ARCHIVE, bindingId: randomUUID(),
            }));
            expect(root.id).toBe(id);
            expect(root.parents).toEqual([h.drive.myDriveId]);
            expect(h.drive.creates - before).toBe(1);
        });

        it("should find an already created root again (409) and refuse one that is not the same object", async () => {
            const same = expectStep(await DriveDestination.createRootWithId(client, {
                id: rootId, name: ROOT_NAME, parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: ARCHIVE, bindingId,
            }));
            expect(same.id).toBe(rootId);
            const other = await DriveDestination.createRootWithId(client, {
                id: rootId, name: ROOT_NAME, parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: ARCHIVE, bindingId: randomUUID(),
            });
            expect(other).toEqual({ ok: false, conflict: "mismatch" });
            const renamed = await DriveDestination.createRootWithId(client, {
                id: rootId, name: "another-name", parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: ARCHIVE, bindingId,
            });
            expect(renamed).toEqual({ ok: false, conflict: "mismatch" });
            expect(h.drive.creates).toBe(1);
        });

        it("should return the failure of a create it cannot resolve", async () => {
            const id = await freshId();
            h.drive.addFault({ route: "create", times: 1, action: driveFaults.status(503) });
            const result = await DriveDestination.createRootWithId(client, {
                id, name: "x-root", parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: ARCHIVE, bindingId: randomUUID(),
            });
            expect(result).toEqual({ ok: false, failure: { kind: "http", httpStatus: 503, reason: "backendError", retryAfterSeconds: null } });
        });

        it("should discover untrashed roots by installation or archive id", async () => {
            const second = await freshId();
            expectStep(await DriveDestination.createRootWithId(client, {
                id: second, name: "second-root", parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: "arch-0002", bindingId: randomUUID(),
            }));
            const third = await freshId();
            expectStep(await DriveDestination.createRootWithId(client, {
                id: third, name: "third-root", parentId: h.drive.myDriveId, installationId: INSTALLATION, archiveId: "arch-0003", bindingId: randomUUID(),
            }));
            h.drive.trash(third);
            const byInstallation = expectStep(await DriveDestination.discoverRoots(client, "bjjInstallationId", INSTALLATION));
            expect(byInstallation.map(file => file.id).sort()).toEqual([rootId, second].sort());
            const byArchive = expectStep(await DriveDestination.discoverRoots(client, "bjjArchiveId", "arch-0002"));
            expect(byArchive.map(file => file.id)).toEqual([second]);
            expect(expectStep(await DriveDestination.discoverRoots(client, "bjjArchiveId", "arch-none"))).toEqual([]);
        });

        it("should return the facts of a failed discovery", async () => {
            h.drive.addFault({ route: "list", times: 1, action: driveFaults.status(429, "rateLimitExceeded", 7) });
            expect(await DriveDestination.discoverRoots(client, "bjjInstallationId", INSTALLATION)).toEqual({
                ok: false, failure: { kind: "http", httpStatus: 429, reason: "rateLimitExceeded", retryAfterSeconds: 7 },
            });
        });

        it("checkRoot should say ok for the bound root and changed when it was renamed, moved, trashed, rebound or is gone", async () => {
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "ok" });

            h.drive.rename(rootId, "renamed-by-someone");
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "changed" });
            h.drive.rename(rootId, ROOT_NAME);
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "ok" });

            const elsewhere = h.drive.seed({ id: "ElsewhereFolder0001", name: "elsewhere" });
            h.drive.move(rootId, elsewhere.id);
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "changed" });
            h.drive.move(rootId, h.drive.myDriveId);
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "ok" });

            h.drive.node(rootId)!.appProperties["bjjBindingId"] = randomUUID();
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "changed" });
            h.drive.node(rootId)!.appProperties["bjjBindingId"] = bindingId;

            h.drive.trash(rootId);
            expect(await dest.checkRoot()).toEqual({ ok: true, value: "changed" });

            const gone = new DriveDestination(client, { ...binding(), rootFolderId: "NeverExistedFolder001" });
            expect(await gone.checkRoot()).toEqual({ ok: true, value: "changed" });
        });

        it("checkRoot should report a failed lookup as a failure, not as a change", async () => {
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.status(503) });
            expect(await dest.checkRoot()).toMatchObject({ ok: false, failure: { kind: "http", httpStatus: 503 } });
        });
    });

    describe("ensureFolderChain", () => {
        it("should create every prefix once, reserving before creating, and return the folder holding the file", async () => {
            const parent = expectStep(await dest.ensureFolderChain(KEY, ledger));
            const folders = h.drive.nodes().filter(node => node.mimeType === FOLDER && node.id !== h.drive.myDriveId && node.id !== rootId);
            expect(folders.map(node => node.name)).toEqual(["eformsign", "co-1", "doc-1", "artifacts", "document"]);
            expect(parent).toBe(folders[4]!.id);
            expect(folders[0]!.parents).toEqual([rootId]);
            expect(folders[3]!.parents).toEqual([folders[2]!.id]);
            expect(ledger.events).toEqual(KEY_FOLDERS.flatMap(key => [`reserve:${key}`, `created:${key}`]));
            for (const key of KEY_FOLDERS) expect(ledger.current(key)?.status).toBe("created");

            const creates = h.drive.creates;
            const requests = h.drive.requests.length;
            expect(expectStep(await dest.ensureFolderChain(KEY, ledger))).toBe(parent);
            expect(h.drive.creates).toBe(creates);
            expect(h.drive.requests.length).toBe(requests); // created nodes are trusted: no request at all
        });

        it("should return the root for a single-segment key and share prefixes between keys", async () => {
            expect(expectStep(await dest.ensureFolderChain("run.json", ledger))).toBe(rootId);
            const first = expectStep(await dest.ensureFolderChain("eformsign/co-1/a.json", ledger));
            const second = expectStep(await dest.ensureFolderChain("eformsign/co-1/b.json", ledger));
            expect(second).toBe(first);
            expect(h.drive.creates).toBe(2 + 1); // root + two folders
        });

        /** A destination whose client changes the folder behind its back right before the lookup that follows a create. */
        function destinationRenamingBeforeLookup(): DriveDestination {
            const spied = Object.create(client) as DriveClient;
            spied.getFile = async (id: string) => {
                if (h.drive.node(id) !== undefined && h.drive.node(id)!.name === "eformsign") h.drive.rename(id, "renamed-in-between");
                return client.getFile(id);
            };
            return new DriveDestination(spied, binding());
        }

        it("U3-F1: after an ok create it looks the folder up and compares what Drive holds, not the create answer", async () => {
            const lookups = () => h.drive.requests.filter(request => request.method === "GET" && /\/drive\/v3\/files\/(?!generateIds$)[^/]+$/.test(request.path)).length;
            const before = lookups();
            expectStep(await dest.ensureFolderChain("eformsign/a.json", ledger));
            expect(lookups() - before).toBe(1);
        });

        it("U3-F1: a folder that no longer matches when it is looked up after an ok create is a conflict and is not recorded as created", async () => {
            const result = await destinationRenamingBeforeLookup().ensureFolderChain("eformsign/a.json", ledger);
            expect(result).toEqual({ ok: false, conflict: "mismatch" });
            expect(ledger.current("eformsign")?.status).toBe("reserved");
            expect(ledger.events).not.toContain("created:eformsign");
        });

        it("U3-F1: a failed lookup after an ok create keeps the reservation, and the next call resumes the same id without a second create", async () => {
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.status(503) });
            const first = await dest.ensureFolderChain("eformsign/a.json", ledger);
            expect(first).toMatchObject({ ok: false, failure: { kind: "http", httpStatus: 503 } });
            const reserved = ledger.current("eformsign")!;
            expect(reserved.status).toBe("reserved");
            const creates = h.drive.creates;

            expect(expectStep(await dest.ensureFolderChain("eformsign/a.json", ledger))).toBe(reserved.fileId);
            expect(h.drive.creates).toBe(creates);
            expect(h.drive.children(rootId).filter(node => node.name === "eformsign")).toHaveLength(1);
            expect(ledger.current("eformsign")?.status).toBe("created");
        });

        it("T17: a lost folder create leaves no duplicate", async () => {
            h.drive.addFault({ route: "create", times: 1, action: driveFaults.lostResponse() });
            const parent = expectStep(await dest.ensureFolderChain("eformsign/co-1/a.json", ledger));
            const children = h.drive.children(rootId).filter(node => node.name === "eformsign");
            expect(children).toHaveLength(1);
            expect(h.drive.children(children[0]!.id).map(node => node.name)).toEqual(["co-1"]);
            expect(h.drive.node(parent)!.name).toBe("co-1");
            expect(ledger.current("eformsign")?.status).toBe("created");
        });

        it("T17: a lost folder create whose lookup also fails stays reserved, and the next call resumes with the same id", async () => {
            h.drive.addFault({ route: "create", times: 1, action: driveFaults.lostResponse() });
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.dropRequest() });
            const first = await dest.ensureFolderChain("eformsign/a.json", ledger);
            expect(first).toMatchObject({ ok: false, failure: { kind: "network" } });
            const reserved = ledger.current("eformsign")!;
            expect(reserved.status).toBe("reserved");
            const creates = h.drive.creates;

            const second = expectStep(await dest.ensureFolderChain("eformsign/a.json", ledger));
            expect(second).toBe(reserved.fileId);
            expect(h.drive.creates).toBe(creates); // nothing was created a second time
            expect(h.drive.children(rootId).filter(node => node.name === "eformsign")).toHaveLength(1);
            expect(ledger.current("eformsign")?.status).toBe("created");
        });

        it("should create a reserved folder that Drive does not know with the reserved id", async () => {
            const id = await freshId();
            await ledger.reserve("folder", "eformsign", id, rootId);
            expect(expectStep(await dest.ensureFolderChain("eformsign/a.json", ledger))).toBe(id);
            expect(h.drive.node(id)).toMatchObject({ name: "eformsign", parents: [rootId] });
            expect(ledger.current("eformsign")?.status).toBe("created");
        });

        it("T17: a 409 on a folder that is the same object is accepted", async () => {
            ledger.afterReserve = async node => {
                expectStep(await DriveDestinationTestAccess.createFolderRemotely(client, node.fileId, "eformsign", node.parentFileId));
            };
            const before = h.drive.creates;
            const parent = expectStep(await dest.ensureFolderChain("eformsign/a.json", ledger));
            expect(h.drive.creates - before).toBe(1); // the remote one made behind the destination's back; its own create was refused
            expect(h.drive.node(parent)!.name).toBe("eformsign");
            expect(ledger.current("eformsign")?.status).toBe("created");
        });

        it("T17: a 409 on an id that holds something else is a conflict", async () => {
            const other = h.drive.seed({ id: "OtherParentFolder001", name: "other-parent" });
            ledger.afterReserve = async node => {
                expectStep(await DriveDestinationTestAccess.createFolderRemotely(client, node.fileId, "eformsign", other.id));
            };
            expect(await dest.ensureFolderChain("eformsign/a.json", ledger)).toEqual({ ok: false, conflict: "wrong-parent" });
            expect(ledger.current("eformsign")?.status).toBe("reserved");
        });

        it("should report a reserved folder that was renamed or trashed as a conflict", async () => {
            const id = await freshId();
            await ledger.reserve("folder", "eformsign", id, rootId);
            expectStep(await DriveDestinationTestAccess.createFolderRemotely(client, id, "not-eformsign", rootId));
            expect(await dest.ensureFolderChain("eformsign/a.json", ledger)).toEqual({ ok: false, conflict: "mismatch" });
            h.drive.rename(id, "eformsign");
            h.drive.trash(id);
            expect(await dest.ensureFolderChain("eformsign/a.json", ledger)).toEqual({ ok: false, conflict: "trashed" });
        });

        it("should refuse a node the ledger holds as a file", async () => {
            const id = await freshId();
            await ledger.reserve("file", "eformsign", id, rootId);
            expect(await dest.ensureFolderChain("eformsign/a.json", ledger)).toEqual({ ok: false, conflict: "mismatch" });
        });

        it("should return the failure when Drive refuses the create", async () => {
            h.drive.addFault({ route: "create", times: 1, action: driveFaults.status(403, "storageQuotaExceeded") });
            expect(await dest.ensureFolderChain("eformsign/a.json", ledger)).toEqual({
                ok: false, failure: { kind: "http", httpStatus: 403, reason: "storageQuotaExceeded", retryAfterSeconds: null },
            });
            expect(ledger.current("eformsign")?.status).toBe("reserved");
        });
    });

    describe("uploadArtifact", () => {
        it("should upload under the folder chain with the artifact's name, mime type and identity properties", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            const node = h.drive.node(fileId)!;
            expect(node).toMatchObject({ name: "art-1.pdf", mimeType: PDF, parents: [parent], trashed: false });
            expect(node.bytes!.equals(bytes)).toBe(true);
            expect(node.appProperties).toEqual({ bjjArtifactIdentity: sha256Of(Buffer.from(KEY)), bjjSha256: sha256Of(bytes) });
            expect(ledger.current(KEY)).toEqual({ kind: "file", fileId, parentFileId: parent, status: "created" });
            expect(ledger.events.slice(-2)).toEqual([`reserve:${KEY}`, `created:${KEY}`]);
        });

        it("should upload a multi-chunk file and an empty one", async () => {
            const big = data(600_000);
            const { fileId } = await upload(big);
            expect(h.drive.bytesOf(fileId)!.equals(big)).toBe(true);
            const key = "eformsign/co-1/doc-1/artifacts/document/empty.pdf";
            const empty = await upload(Buffer.alloc(0), key);
            expect(h.drive.bytesOf(empty.fileId)!.length).toBe(0);
        });

        it("T17: a lost final response resolves by comparison, with a single object and the same id on a second call", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            h.drive.addFault({ route: "uploadPut", times: 1, action: driveFaults.lostResponse() });
            h.drive.addFault({ route: "uploadProbe", action: driveFaults.dropRequest() });
            const first = expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(h.drive.fileCount()).toBe(1);
            expect(h.drive.uploadsCompleted).toBe(1);
            expect(ledger.current(KEY)).toMatchObject({ fileId: first.fileId, status: "created" });

            const sessions = h.drive.sessionsStarted;
            const second = expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(second.fileId).toBe(first.fileId);
            expect(h.drive.sessionsStarted).toBe(sessions);
            expect(h.drive.fileCount()).toBe(1);
        });

        it("T17: a lost response whose lookup also fails keeps the reservation, and the second call finds the same id", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            h.drive.addFault({ route: "uploadPut", times: 1, action: driveFaults.lostResponse() });
            h.drive.addFault({ route: "uploadProbe", action: driveFaults.dropRequest() });
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.dropRequest() });
            const first = await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes));
            expect(first).toMatchObject({ ok: false, failure: { kind: "network" } });
            const reserved = ledger.current(KEY)!;
            expect(reserved.status).toBe("reserved");
            expect(h.drive.fileCount()).toBe(1); // the bytes did land

            const second = expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(second.fileId).toBe(reserved.fileId);
            expect(h.drive.fileCount()).toBe(1);
            expect(h.drive.uploadsCompleted).toBe(1);
            expect(ledger.current(KEY)?.status).toBe("created");
        });

        it("should resume a reservation whose upload never started with the same id, uploading once", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            const id = await freshId();
            await ledger.reserve("file", KEY, id, parent);
            const result = expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(result.fileId).toBe(id);
            expect(h.drive.uploadsCompleted).toBe(1);
        });

        it("T17: a 409 on an id that already holds the same object is accepted without a second upload", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            ledger.afterReserve = async node => {
                const made = await client.uploadResumable(
                    { id: node.fileId, name: "art-1.pdf", parentId: parent, mimeType: PDF }, bytesFrom(bytes), bytes.length);
                if (!made.ok) throw new Error("setup upload failed");
            };
            const result = expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(h.drive.fileCount()).toBe(1);
            expect(h.drive.uploadsCompleted).toBe(1);
            expect(ledger.current(KEY)).toMatchObject({ fileId: result.fileId, status: "created" });
        });

        it("T17: a 409 on an id that holds different bytes or another parent is a conflict, never an accept", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            ledger.afterReserve = async node => {
                const made = await client.uploadResumable(
                    { id: node.fileId, name: "art-1.pdf", parentId: parent, mimeType: PDF }, bytesFrom(data(2500, 1)), 2500);
                if (!made.ok) throw new Error("setup upload failed");
            };
            expect(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes))).toEqual({ ok: false, conflict: "mismatch" });
            expect(ledger.current(KEY)?.status).toBe("reserved");

            const key = "eformsign/co-1/doc-1/artifacts/document/art-2.pdf";
            const other = h.drive.seed({ id: "OtherParentFolder002", name: "other-parent" });
            ledger.afterReserve = async node => {
                if (node.nodeKey !== key) return;
                const made = await client.uploadResumable(
                    { id: node.fileId, name: "art-2.pdf", parentId: other.id, mimeType: PDF }, bytesFrom(bytes), bytes.length);
                if (!made.ok) throw new Error("setup upload failed");
            };
            expect(await dest.uploadArtifact(artifactInput(bytes, key), parent, ledger, bytesFrom(bytes))).toEqual({ ok: false, conflict: "wrong-parent" });
        });

        it("should not trust a response without a checksum: it downloads and hashes the file", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            h.drive.addFault({ route: "uploadPut", times: 1, action: driveFaults.omitSha256() });
            const downloads = h.drive.downloads;
            expectStep(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(h.drive.downloads).toBe(downloads + 1);
        });

        it("should surface a failing source as the worker error it throws and keep the reservation", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            const short = bytesFrom(bytes.subarray(0, 1000));
            await expect(dest.uploadArtifact(artifactInput(bytes), parent, ledger, short)).rejects.toMatchObject({ reasonCode: "artifact-integrity" });
            expect(ledger.current(KEY)?.status).toBe("reserved");
            expect(h.drive.fileCount()).toBe(0);
        });

        it("should return the failure of a refused upload and keep the reservation", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            h.drive.setQuotaExceeded(true);
            expect(await dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes))).toEqual({
                ok: false, failure: { kind: "http", httpStatus: 403, reason: "storageQuotaExceeded", retryAfterSeconds: null },
            });
            expect(ledger.current(KEY)?.status).toBe("reserved");
        });

        it("should call for a new id (freshId) after an integrity error and leave the superseded id unused", async () => {
            const bytes = data(2500);
            const first = await upload(bytes);
            h.drive.corrupt(first.fileId);
            expect(expectStep(await dest.verifyRemote(first.fileId, expectOf(bytes, first.parent)))).toBe("mismatch");
            // Without freshId the destination compares and reports the damage.
            expect(await dest.uploadArtifact(artifactInput(bytes), first.parent, ledger, bytesFrom(bytes))).toEqual({ ok: false, conflict: "mismatch" });
            const second = expectStep(await dest.uploadArtifact(artifactInput(bytes, KEY, true), first.parent, ledger, bytesFrom(bytes)));
            expect(second.fileId).not.toBe(first.fileId);
            expect(ledger.current(KEY)).toMatchObject({ fileId: second.fileId, status: "created" });
            expect(expectStep(await dest.verifyRemote(second.fileId, expectOf(bytes, first.parent)))).toBe("ok");
        });

        it("should replace an id whose file is gone for good with a new reservation", async () => {
            const bytes = data(2500);
            const first = await upload(bytes);
            (h.drive as unknown as { nodeMap: Map<string, unknown> }).nodeMap.delete(first.fileId);
            const second = expectStep(await dest.uploadArtifact(artifactInput(bytes), first.parent, ledger, bytesFrom(bytes)));
            expect(second.fileId).not.toBe(first.fileId);
            expect(expectStep(await dest.verifyRemote(second.fileId, expectOf(bytes, first.parent)))).toBe("ok");
        });

        it("should report a trashed or moved file instead of uploading over it", async () => {
            const bytes = data(2500);
            const first = await upload(bytes);
            const sessions = h.drive.sessionsStarted;
            h.drive.trash(first.fileId);
            expect(await dest.uploadArtifact(artifactInput(bytes), first.parent, ledger, bytesFrom(bytes))).toEqual({ ok: false, conflict: "trashed" });
            h.drive.node(first.fileId)!.trashed = false;
            h.drive.move(first.fileId, rootId);
            expect(await dest.uploadArtifact(artifactInput(bytes), first.parent, ledger, bytesFrom(bytes))).toEqual({ ok: false, conflict: "wrong-parent" });
            expect(h.drive.sessionsStarted).toBe(sessions);
        });

        it("U3-createfirst: with a ledger that refuses the reservation, no create reaches Drive at all", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            const posts = () => h.drive.requests.filter(request => request.method !== "GET").length;
            const creates = h.drive.creates;
            const before = posts();
            ledger.rejectReserve = new Error("ledger-down");
            await expect(dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes))).rejects.toThrow("ledger-down");
            expect(posts()).toBe(before);
            expect(h.drive.sessionsStarted).toBe(0);
            expect(h.drive.uploadsCompleted).toBe(0);
            expect(h.drive.creates).toBe(creates);
            expect(h.drive.fileCount()).toBe(0);

            const folderDest = new DriveDestination(client, binding());
            await expect(folderDest.ensureFolderChain("brand-new/a.json", ledger)).rejects.toThrow("ledger-down");
            expect(posts()).toBe(before);
            expect(h.drive.creates).toBe(creates);
        });

        it("V09 (adapter): a crash after the reservation and before the create resumes with the same id and leaves one object", async () => {
            const bytes = data(2500);
            const parent = await parentOf();
            ledger.afterReserve = async () => { throw new Error("crash after reserve"); };
            await expect(dest.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes))).rejects.toThrow("crash after reserve");
            const reserved = ledger.current(KEY)!;
            expect(reserved.status).toBe("reserved");
            expect(h.drive.fileCount()).toBe(0);

            ledger.afterReserve = null;
            const resumed = new DriveDestination(client, binding());
            const result = expectStep(await resumed.uploadArtifact(artifactInput(bytes), parent, ledger, bytesFrom(bytes)));
            expect(result.fileId).toBe(reserved.fileId);
            expect(h.drive.fileCount()).toBe(1);
            expect(h.drive.uploadsCompleted).toBe(1);
            expect(ledger.current(KEY)?.status).toBe("created");
        });

        it("V09 (adapter): a crash after a folder reservation resumes with the same id and leaves one folder", async () => {
            ledger.afterReserve = async () => { throw new Error("crash after reserve"); };
            await expect(dest.ensureFolderChain("eformsign/a.json", ledger)).rejects.toThrow("crash after reserve");
            const reserved = ledger.current("eformsign")!;
            ledger.afterReserve = null;
            const resumed = new DriveDestination(client, binding());
            expect(expectStep(await resumed.ensureFolderChain("eformsign/a.json", ledger))).toBe(reserved.fileId);
            expect(h.drive.children(rootId).filter(node => node.name === "eformsign")).toHaveLength(1);
        });
    });

    describe("verifyRemote", () => {
        it("should say ok for an intact file, from the checksum, without downloading", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            const downloads = h.drive.downloads;
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent)))).toBe("ok");
            expect(h.drive.downloads).toBe(downloads);
        });

        it("should download and hash when the checksum is absent, and when asked to", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.omitSha256() });
            const downloads = h.drive.downloads;
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent)))).toBe("ok");
            expect(h.drive.downloads).toBe(downloads + 1);

            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent), { forceDownload: true }))).toBe("ok");
            expect(h.drive.downloads).toBe(downloads + 2);
        });

        it("should find damage by hashing the download when the checksum is absent", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            h.drive.corrupt(fileId);
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.omitSha256() });
            const downloads = h.drive.downloads;
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent)))).toBe("mismatch");
            expect(h.drive.downloads).toBe(downloads + 1);
        });

        it("U3-trustappprops: bytes that changed after the upload are a mismatch although the stored bjjSha256 still names the expected hash", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            expect(h.drive.node(fileId)!.appProperties["bjjSha256"]).toBe(sha256Of(bytes));
            h.drive.corrupt(fileId);
            expect(h.drive.node(fileId)!.appProperties["bjjSha256"]).toBe(sha256Of(bytes)); // the property is a label, not evidence
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent)))).toBe("mismatch");
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.omitSha256() });
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent)))).toBe("mismatch");
            expect(expectStep(await dest.verifyRemote(fileId, expectOf(bytes, parent), { forceDownload: true }))).toBe("mismatch");
        });

        it("should say mismatch for a trashed, renamed, moved, retyped or resized file", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            const want = expectOf(bytes, parent);
            expect(expectStep(await dest.verifyRemote(fileId, { ...want, byteLength: 2499 }))).toBe("mismatch");
            expect(expectStep(await dest.verifyRemote(fileId, { ...want, mimeType: "application/json" }))).toBe("mismatch");
            expect(expectStep(await dest.verifyRemote(fileId, { ...want, name: "other.pdf" }))).toBe("mismatch");
            expect(expectStep(await dest.verifyRemote(fileId, { ...want, sha256: sha256Of(data(2500, 3)) }))).toBe("mismatch");
            h.drive.rename(fileId, "renamed.pdf");
            expect(expectStep(await dest.verifyRemote(fileId, want))).toBe("mismatch");
            h.drive.rename(fileId, "art-1.pdf");
            h.drive.move(fileId, rootId);
            expect(expectStep(await dest.verifyRemote(fileId, want))).toBe("mismatch");
            h.drive.move(fileId, parent);
            h.drive.trash(fileId);
            expect(expectStep(await dest.verifyRemote(fileId, want))).toBe("mismatch");
        });

        it("should say missing for an id Drive does not know", async () => {
            const bytes = data(10);
            expect(expectStep(await dest.verifyRemote("NeverExistedFile0001", expectOf(bytes, rootId)))).toBe("missing");
        });

        it("should return the failure of a lookup or a download that failed", async () => {
            const bytes = data(2500);
            const { fileId, parent } = await upload(bytes);
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.status(503) });
            expect(await dest.verifyRemote(fileId, expectOf(bytes, parent))).toMatchObject({ ok: false, failure: { httpStatus: 503 } });
            h.drive.addFault({ route: "download", times: 1, action: driveFaults.status(429, "rateLimitExceeded") });
            expect(await dest.verifyRemote(fileId, expectOf(bytes, parent), { forceDownload: true })).toMatchObject({
                ok: false, failure: { httpStatus: 429, reason: "rateLimitExceeded" },
            });
        });
    });

    describe("publishJson", () => {
        const json = (value: unknown) => Buffer.from(JSON.stringify(value));

        it("should publish a record under its folder chain, and publish the same bytes again without a new upload", async () => {
            const key = "eformsign/co-1/doc-1/manifests/m-1.json";
            const bytes = json({ a: 1 });
            const first = expectStep(await dest.publishJson(key, bytes, ledger));
            expect(first.sha256).toBe(sha256Of(bytes));
            const node = h.drive.node(first.fileId)!;
            expect(node).toMatchObject({ name: "m-1.json", mimeType: "application/json" });
            expect(node.bytes!.equals(bytes)).toBe(true);
            expect(h.drive.node(node.parents[0]!)!.name).toBe("manifests");

            const sessions = h.drive.sessionsStarted;
            const second = expectStep(await dest.publishJson(key, bytes, ledger));
            expect(second).toEqual(first);
            expect(h.drive.sessionsStarted).toBe(sessions);
        });

        it("should publish a root-level record into the root folder", async () => {
            const result = expectStep(await dest.publishJson("archive-marker.json", json({ marker: true }), ledger));
            expect(h.drive.node(result.fileId)!.parents).toEqual([rootId]);
        });

        it("should refuse different bytes for a key that already holds a record", async () => {
            const key = "eformsign/co-1/doc-1/manifests/m-1.json";
            expectStep(await dest.publishJson(key, json({ a: 1 }), ledger));
            expect(await dest.publishJson(key, json({ a: 2 }), ledger)).toEqual({ ok: false, conflict: "mismatch" });
        });

        it("should resolve a lost response to a single record", async () => {
            const key = "eformsign/run-1.json";
            const bytes = json({ run: 1 });
            h.drive.addFault({ route: "uploadPut", times: 1, action: driveFaults.lostResponse() });
            h.drive.addFault({ route: "uploadProbe", action: driveFaults.dropRequest() });
            const result = expectStep(await dest.publishJson(key, bytes, ledger));
            expect(h.drive.fileCount()).toBe(1);
            expect(ledger.current(key)).toMatchObject({ fileId: result.fileId, status: "created" });
        });
    });

    describe("download", () => {
        it("should stream the stored bytes", async () => {
            const bytes = data(600_000);
            const { fileId } = await upload(bytes);
            const stream = expectStep(await dest.download(fileId));
            const parts: Buffer[] = [];
            for await (const part of stream) parts.push(Buffer.from(part));
            expect(Buffer.concat(parts).equals(bytes)).toBe(true);
        });

        it("should return the failure for an id Drive does not have", async () => {
            expect(await dest.download("NeverExistedFile0001")).toMatchObject({ ok: false, failure: { kind: "http", httpStatus: 404 } });
        });
    });

    describe("listChildren", () => {
        function seedChildren(count: number): string[] {
            const ids: string[] = [];
            for (let index = 0; index < count; index += 1) {
                const id = `ListedChild_${String(index).padStart(4, "0")}`;
                h.drive.seed({ id, name: `child-${index}`, parents: [rootId] });
                ids.push(id);
            }
            return ids;
        }

        it("should return every page of untrashed children", async () => {
            h.drive.pageSizeCap = 2;
            const ids = seedChildren(5);
            h.drive.trash(ids[1]!);
            const listed = await collect(dest.listChildren(rootId));
            expect(listed.map(file => file.id).sort()).toEqual([ids[0], ids[2], ids[3], ids[4]].sort());
            expect(h.drive.listCalls).toBeGreaterThanOrEqual(2);
        });

        it("A3.1: a refresh token revoked between page 1 and page 2 ends as drive-token-invalid", async () => {
            h.drive.pageSizeCap = 2;
            seedChildren(5);
            const iterator = dest.listChildren(rootId)[Symbol.asyncIterator]();
            const first = await iterator.next();
            expect(first.done).toBe(false);
            h.drive.revokeAccess();
            const drain = async (): Promise<void> => {
                for (;;) {
                    const next = await iterator.next();
                    if (next.done) return;
                }
            };
            const error = await drain().then(() => null, (thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(WorkerError);
            expect((error as WorkerError).reasonCode).toBe("drive-token-invalid");
        });

        it.each([
            [503, undefined, "drive-unavailable"],
            [429, undefined, "rate-limited"],
            [403, "userRateLimitExceeded", "rate-limited"],
            [403, "storageQuotaExceeded", "drive-quota"],
            [403, "forbidden", "drive-permission"],
            [400, undefined, "drive-conflict"],
            [404, undefined, "drive-conflict"],
        ] as const)("A3.1: a failed page (%s %s) throws WorkerError(%s)", async (status, reason, code) => {
            h.drive.addFault({ route: "list", times: 1, action: driveFaults.status(status, reason) });
            await expect(collect(dest.listChildren(rootId))).rejects.toMatchObject({ name: "WorkerError", reasonCode: code });
        });

        it("A3.1: a network failure on a later page throws network-timeout", async () => {
            h.drive.pageSizeCap = 2;
            seedChildren(5);
            h.drive.addFault({ route: "list", match: request => request.query.get("pageToken") !== null, times: 1, action: driveFaults.dropRequest() });
            await expect(collect(dest.listChildren(rootId))).rejects.toMatchObject({ reasonCode: "network-timeout" });
        });
    });
});
