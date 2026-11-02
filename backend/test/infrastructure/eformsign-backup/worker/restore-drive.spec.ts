import { promises as fs } from "node:fs";
import path from "node:path";

import { DriveDestination, type DriveBinding, type DriveNodeLedger } from "infrastructure/eformsign-backup/worker/drive-destination";
import { runRestoreDriveCli } from "infrastructure/eformsign-backup/worker/cli-restore-drive";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";

import { startDriveFakes, makeDriveClient, bytesFrom, type DriveHarness } from "./helpers/drive-support";
import { driveFaults } from "./helpers/fake-drive-server";
import {
    ARCHIVE_ID, COMPANY, configJson, createHarness, destroyHarness, initArchive, listFiles, makeBase, pairDoc, readJsonFile, runOnce, sha256Of, singleDoc,
    type Harness,
} from "./helpers/runner-support";

/** M1: D001, D002 (pairs) and D004 (one artifact). M2 changes D001's metadata and adds D003 (only in the latest snapshot). */
const m1 = () => [pairDoc("D001"), pairDoc("D002"), singleDoc("D004")];
const m2 = () => [pairDoc("D001", "D001", { documentKind: "contract-v2" }), pairDoc("D002"), pairDoc("D003"), singleDoc("D004")];

const BINDING_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_FILE = "restore-drive-report.json";

/** The node records of a populate: in memory only, the restore never touches a ledger. */
function memoryLedger(): DriveNodeLedger {
    const nodes = new Map<string, { kind: "folder" | "file"; fileId: string; parentFileId: string; status: "reserved" | "created" }>();
    return {
        current: (key) => nodes.get(key) ?? null,
        async reserve(kind, key, fileId, parentFileId) { nodes.set(key, { kind, fileId, parentFileId, status: "reserved" }); },
        async created(key, fileId) { nodes.set(key, { ...nodes.get(key)!, status: "created", fileId }); },
    };
}

interface Populated {
    rootId: string;
    /** archive relativeKey -> Drive file id */
    ids: Map<string, string>;
    /** archive relativeKey -> bytes the local archive held */
    bytes: Map<string, Buffer>;
    installationId: string;
}

function expectOk<T>(step: { ok: true; value: T } | { ok: false }): T {
    if (!step.ok) throw new Error("expected an ok step");
    return step.value;
}

/** Copies every file of the local archive onto the fake Drive through the real destination code (reserve-first, ids from generateIds). */
async function createRoot(dh: DriveHarness, installationId: string, name = "bjj-eformsign-backup"): Promise<{ rootId: string; destination: DriveDestination }> {
    const { client } = makeDriveClient(dh);
    const generated = await client.generateIds(1);
    if (!generated.ok) throw new Error("generateIds failed");
    const rootId = generated.value[0]!;
    expectOk(await DriveDestination.createRootWithId(client, { id: rootId, name, parentId: "root", installationId, archiveId: ARCHIVE_ID, bindingId: BINDING_ID }));
    const binding: DriveBinding = { rootFolderId: rootId, rootName: name, rootParentId: dh.drive.myDriveId, bindingId: BINDING_ID, installationId, archiveId: ARCHIVE_ID };
    return { rootId, destination: new DriveDestination(client, binding) };
}

async function populate(h: Harness, dh: DriveHarness): Promise<Populated> {
    const marker = await readJsonFile<{ installationId: string }>(path.join(h.archive, ".bjj-backup", "installation.json"));
    const { rootId, destination } = await createRoot(dh, marker.installationId);
    const ledger = memoryLedger();
    const ids = new Map<string, string>();
    const bytes = new Map<string, Buffer>();
    for (const key of await listFiles(h.archive)) {
        const content = await fs.readFile(path.join(h.archive, key));
        bytes.set(key, content);
        if (key.endsWith(".pdf")) {
            const parent = expectOk(await destination.ensureFolderChain(key, ledger));
            const sha256 = sha256Of(content);
            const put = expectOk(await destination.uploadArtifact(
                { relativeKey: key, sha256, byteLength: content.length, artifactIdentity: sha256 }, parent, ledger, bytesFrom(content),
            ));
            ids.set(key, put.fileId);
        } else {
            ids.set(key, expectOk(await destination.publishJson(key, content, ledger)).fileId);
        }
    }
    return { rootId, ids, bytes, installationId: marker.installationId };
}

describe("T-WRK-12/BJJ-456 U7: restore-drive, a verified mirror of the Drive archive (V13, T25, T30)", () => {
    let h: Harness;
    let dh: DriveHarness;
    let driveConfigPath: string;
    let outBase: string;

    beforeEach(async () => {
        h = await createHarness({ docs: m1() });
        dh = await startDriveFakes();
        outBase = await makeBase("bjj456-restore-drive-out-");
        driveConfigPath = path.join(h.base, "worker-drive.json");
        await fs.writeFile(driveConfigPath, JSON.stringify(configJson(h, { drive: dh.config } as never)), { mode: 0o600 });
    });
    afterEach(async () => {
        await dh.close();
        await destroyHarness(h);
        await fs.rm(outBase, { recursive: true, force: true });
    });

    async function twoSnapshots(): Promise<Populated> {
        await initArchive(h);
        await runOnce(h);
        h.api.docs = m2();
        await runOnce(h);
        return populate(h, dh);
    }

    async function cli(args: string[], environment: { fetchImpl?: typeof fetch } = {}): Promise<{ code: number; out: string[]; err: string[] }> {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runRestoreDriveCli(args, { out: (line) => out.push(line), err: (line) => err.push(line), ...environment });
        return { code, out, err };
    }
    const restoreArgs = (outDir: string, extra: string[] = []): string[] => ["--config", driveConfigPath, "--out", outDir, ...extra];
    const outDir = (name: string): string => path.join(outBase, name);

    /** The files a restore-drive wrote into `dir` (the tmp directory excluded), as archive relative keys. */
    async function mirrorFiles(dir: string): Promise<string[]> {
        return (await listFiles(dir)).filter((file) => !file.startsWith(".restore-drive-tmp/") && file !== REPORT_FILE);
    }
    const readReport = (dir: string) => readJsonFile<{ verified: number; failed: number; failures: Array<{ relativeKey: string; reason: string }> }>(path.join(dir, REPORT_FILE));
    const exists = (file: string): Promise<boolean> => fs.lstat(file).then(() => true, () => false);

    /** The snapshot of the oldest completion in the local archive (read before a test deletes the archive). */
    async function firstSnapshotId(): Promise<string> {
        const dir = path.join(h.archive, "eformsign", COMPANY, "completions");
        const first = (await fs.readdir(dir)).sort()[0]!;
        return (await readJsonFile<Record<string, string>>(path.join(dir, first)))["snapshotId"]!;
    }

    function artifactKeyOf(populated: Populated, documentId: string, artifactType: "document" | "audit-trail"): string {
        const key = [...populated.ids.keys()].find((candidate) => candidate.includes(`/${documentId}/artifacts/${artifactType}/`));
        if (key === undefined) throw new Error("no such artifact");
        return key;
    }

    it("should rebuild the same documents as the local restore from Drive alone, writing nothing on Drive", async () => {
        const populated = await twoSnapshots();
        const refBase = path.join(outBase, "ref");
        await fs.mkdir(refBase, { mode: 0o700 });
        const ref = (name: string, selector: { latest: true } | { snapshotId: string }) => {
            const dir = path.join(refBase, name);
            return fs.mkdir(dir, { mode: 0o700 }).then(() => restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector, outDir: dir }));
        };
        const refLatest = await ref("latest", { latest: true });
        const refFirst = await ref("first", { snapshotId: await firstSnapshotId() });
        const localFileCount = (await listFiles(h.archive)).length;
        await fs.rm(h.archive, { recursive: true, force: true });
        await fs.rm(h.control, { recursive: true, force: true });
        const before = { creates: dh.drive.creates, uploads: dh.drive.uploadsCompleted, sessions: dh.drive.sessionsStarted, requests: dh.drive.requests.length };

        const mirror = outDir("mirror");
        const result = await cli(restoreArgs(mirror));

        expect(result.err).toEqual([]);
        expect(result.code).toBe(0);
        expect(result.out).toHaveLength(1);
        expect(JSON.parse(result.out[0]!)).toMatchObject({ event: "restore_drive_verified", rootFolderId: populated.rootId, counts: { verified: localFileCount, failed: 0 } });
        expect(await mirrorFiles(mirror)).toEqual([...populated.ids.keys()].sort());
        for (const [key, content] of populated.bytes) expect((await fs.readFile(path.join(mirror, key))).equals(content)).toBe(true);
        const fileMode = (await fs.lstat(path.join(mirror, ...artifactKeyOf(populated, "D001", "document").split("/")))).mode & 0o777;
        const dirMode = (await fs.lstat(path.join(mirror, "eformsign", COMPANY))).mode & 0o777;
        expect([fileMode, dirMode]).toEqual([0o600, 0o700]);
        expect(await readReport(mirror)).toMatchObject({ verified: localFileCount, failed: 0, failures: [] });
        // Read-only on Drive: no create, no upload, and no request that is not a GET.
        expect([dh.drive.creates, dh.drive.uploadsCompleted, dh.drive.sessionsStarted]).toEqual([before.creates, before.uploads, before.sessions]);
        expect(dh.drive.requests.slice(before.requests).length).toBeGreaterThan(0);
        expect(dh.drive.requests.slice(before.requests).every((request) => request.method === "GET")).toBe(true);

        // The existing restore on the mirror gives what it gave on the archive.
        const latestDir = path.join(outBase, "from-mirror-latest");
        const firstDir = path.join(outBase, "from-mirror-first");
        await fs.mkdir(latestDir, { mode: 0o700 });
        await fs.mkdir(firstDir, { mode: 0o700 });
        const mirrorLatest = await restoreFromArchive({ archivePath: mirror, companyId: COMPANY, selector: { latest: true }, outDir: latestDir });
        const mirrorFirst = await restoreFromArchive({ archivePath: mirror, companyId: COMPANY, selector: { snapshotId: refFirst.snapshotId! }, outDir: firstDir });
        expect(mirrorLatest).toEqual(refLatest);
        expect(mirrorFirst).toEqual(refFirst);
        expect(mirrorLatest.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002", "D003", "D004"]);
        for (const doc of mirrorLatest.documents) {
            for (const artifact of doc.artifacts) {
                const mine = await fs.readFile(path.join(latestDir, artifact.file));
                const theirs = await fs.readFile(path.join(refBase, "latest", artifact.file));
                expect(mine.equals(theirs)).toBe(true);
            }
        }
    }, 180_000);

    it("should not write an artifact whose bytes do not match its name, list it, exit 65; latest then fails and an earlier snapshot restores (A2.7)", async () => {
        const populated = await twoSnapshots();
        // D003 exists only in the latest snapshot. Flip one byte in the middle: the shape stays a PDF, only the digest tells.
        const flippedKey = artifactKeyOf(populated, "D003", "document");
        const stored = dh.drive.node(populated.ids.get(flippedKey)!)!;
        stored.bytes![20] = stored.bytes![20]! ^ 0xff;
        // A second artifact whose name is the digest of its own bytes, but that is no PDF at all.
        const junk = Buffer.from("this is not a pdf, but its name is the digest of exactly these bytes ".repeat(2));
        const junkKey = `eformsign/${COMPANY}/D003/artifacts/audit-trail/${sha256Of(junk)}.pdf`;
        const auditKey = artifactKeyOf(populated, "D003", "audit-trail");
        const auditNode = dh.drive.node(populated.ids.get(auditKey)!)!;
        dh.drive.seed({ id: "JunkArtifactId000000001", name: `${sha256Of(junk)}.pdf`, mimeType: "application/pdf", parents: auditNode.parents, bytes: junk });
        const mirror = outDir("mirror");

        const result = await cli(restoreArgs(mirror));

        expect(result.code).toBe(65);
        expect(result.err).toEqual(["artifact-integrity"]);
        expect(JSON.parse(result.out[0]!)).toMatchObject({ event: "restore_drive_failed", counts: { failed: 2 } });
        expect(await exists(path.join(mirror, flippedKey))).toBe(false);
        expect(await exists(path.join(mirror, junkKey))).toBe(false);
        const report = await readReport(mirror);
        expect(report.failures).toEqual([
            { relativeKey: junkKey, reason: "artifact-integrity" },
            { relativeKey: flippedKey, reason: "artifact-integrity" },
        ].sort((a, b) => (a.relativeKey < b.relativeKey ? -1 : 1)));
        // Nothing unverified is left at a mirrored path: the tmp area holds no bytes of the failed files.
        for (const file of (await listFiles(mirror)).filter((name) => name.startsWith(".restore-drive-tmp/"))) {
            const content = await fs.readFile(path.join(mirror, file));
            expect(content.equals(stored.bytes!)).toBe(false);
            expect(content.equals(junk)).toBe(false);
        }

        const latestDir = path.join(outBase, "latest");
        const firstDir = path.join(outBase, "first");
        await fs.mkdir(latestDir, { mode: 0o700 });
        await fs.mkdir(firstDir, { mode: 0o700 });
        await expect(restoreFromArchive({ archivePath: mirror, companyId: COMPANY, selector: { latest: true }, outDir: latestDir }))
            .rejects.toMatchObject({ reasonCode: "artifact-integrity" });
        const restored = await restoreFromArchive({ archivePath: mirror, companyId: COMPANY, selector: { snapshotId: await firstSnapshotId() }, outDir: firstDir });
        expect(restored.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002", "D004"]);
    }, 180_000);

    it("should report a file that disappeared as mirror-missing: listed but gone at download, and named by a manifest but absent", async () => {
        const populated = await twoSnapshots();
        const goneAtDownload = artifactKeyOf(populated, "D001", "document");
        const goneId = populated.ids.get(goneAtDownload)!;
        dh.drive.addFault({ route: "download", match: (request) => request.id === goneId, action: driveFaults.status(404, "notFound") });
        const absent = artifactKeyOf(populated, "D002", "audit-trail");
        dh.drive.trash(populated.ids.get(absent)!);
        const mirror = outDir("mirror");

        const result = await cli(restoreArgs(mirror));

        expect(result.code).toBe(65);
        expect((await readReport(mirror)).failures).toEqual([
            { relativeKey: goneAtDownload, reason: "mirror-missing" },
            { relativeKey: absent, reason: "mirror-missing" },
        ].sort((a, b) => (a.relativeKey < b.relativeKey ? -1 : 1)));
        expect(await exists(path.join(mirror, goneAtDownload))).toBe(false);
        expect(await exists(path.join(mirror, absent))).toBe(false);
    }, 180_000);

    it("should refuse to overwrite: two Drive files with one name in one folder write one and report drive-conflict for the second (u7-overwrite)", async () => {
        const populated = await twoSnapshots();
        const key = artifactKeyOf(populated, "D004", "document");
        const original = dh.drive.node(populated.ids.get(key)!)!;
        // Drive allows a second file of the same name in the folder; its bytes verify as well, so only the path can refuse it.
        dh.drive.seed({ id: "TwinArtifactId00000001", name: original.name, mimeType: original.mimeType, parents: original.parents, bytes: Buffer.from(original.bytes!) });
        const mirror = outDir("mirror");

        const result = await cli(restoreArgs(mirror));

        expect(result.code).toBe(65);
        expect((await readReport(mirror)).failures).toEqual([{ relativeKey: key, reason: "drive-conflict" }]);
        expect((await fs.readFile(path.join(mirror, key))).equals(populated.bytes.get(key)!)).toBe(true);
        expect(result.err).toEqual(["drive-conflict"]);
    }, 180_000);

    it("should not write a forged manifest, a completion whose name disagrees with its content, or a file that is not part of the archive", async () => {
        const populated = await twoSnapshots();
        const manifestKey = [...populated.ids.keys()].find((key) => key.includes("/D001/manifests/"))!;
        const manifest = JSON.parse(populated.bytes.get(manifestKey)!.toString("utf8")) as { metadataRevision: string; artifacts: Array<{ artifactIdentity: string }> };
        const identity = manifest.artifacts[0]!.artifactIdentity;
        manifest.artifacts[0]!.artifactIdentity = `${identity.slice(0, -1)}${identity.endsWith("0") ? "1" : "0"}`;
        // Named by its own digest, so the name rule passes and only the identity derivation can catch it.
        const forged = Buffer.from(JSON.stringify(manifest));
        const forgedName = `${manifest.metadataRevision}-${sha256Of(forged)}.json`;
        const manifestsFolder = dh.drive.node(populated.ids.get(manifestKey)!)!.parents;
        dh.drive.seed({ id: "ForgedManifestId0000001", name: forgedName, mimeType: "application/json", parents: manifestsFolder, bytes: forged });
        const completionKey = [...populated.ids.keys()].filter((key) => key.includes("/completions/")).sort()[0]!;
        const wrongName = `000000000099-${completionKey.split("/").pop()!.split("-")[1]!}`;
        dh.drive.seed({
            id: "WrongNameCompletion0001", name: wrongName, mimeType: "application/json",
            parents: dh.drive.node(populated.ids.get(completionKey)!)!.parents, bytes: Buffer.from(populated.bytes.get(completionKey)!),
        });
        dh.drive.seed({ id: "StrayTextFile0000000001", name: "notes.txt", mimeType: "text/plain", parents: [populated.rootId], bytes: Buffer.from("hello") });
        const mirror = outDir("mirror");

        const result = await cli(restoreArgs(mirror));

        expect(result.code).toBe(65);
        const forgedKey = `${manifestKey.slice(0, manifestKey.lastIndexOf("/") + 1)}${forgedName}`;
        const wrongKey = `${completionKey.slice(0, completionKey.lastIndexOf("/") + 1)}${wrongName}`;
        expect((await readReport(mirror)).failures.map((failure) => `${failure.relativeKey}|${failure.reason}`).sort()).toEqual([
            `${forgedKey}|artifact-integrity`, "notes.txt|artifact-integrity", `${wrongKey}|artifact-integrity`,
        ].sort());
        for (const key of [forgedKey, wrongKey, "notes.txt"]) expect(await exists(path.join(mirror, key))).toBe(false);
        // Every real file was still verified and written.
        for (const key of populated.ids.keys()) expect(await exists(path.join(mirror, key))).toBe(true);
    }, 180_000);

    it("should refuse a --out that is not new or empty, or lies in the archive or control, with exit 64 and without a single Drive request", async () => {
        await twoSnapshots();
        const before = dh.drive.requests.length;
        const filled = outDir("filled");
        await fs.mkdir(filled, { mode: 0o700 });
        await fs.writeFile(path.join(filled, "keep.txt"), "x");
        const inArchive = path.join(h.archive, "mirror");
        const intoControl = path.join(h.control, "mirror");

        for (const target of [filled, inArchive, intoControl, h.archive]) {
            const result = await cli(restoreArgs(target));
            expect(result.code).toBe(64);
            expect(result.err).toEqual(["restore-output-invalid"]);
            expect(result.out).toEqual([]);
        }
        expect(await fs.readdir(filled)).toEqual(["keep.txt"]);
        expect(dh.drive.requests.length).toBe(before);
        // An empty directory is fine.
        const empty = outDir("empty");
        await fs.mkdir(empty, { mode: 0o700 });
        expect((await cli(restoreArgs(empty))).code).toBe(0);
    }, 180_000);

    it("should refuse usage mistakes with 64 and a missing drive block with 78, before any request", async () => {
        const before = dh.drive.requests.length;
        const cases: string[][] = [
            [], ["--config", driveConfigPath], ["--out", outDir("a")], ["--config", "relative.json", "--out", outDir("a")],
            ["--config", driveConfigPath, "--out", "relative"], ["--config", driveConfigPath, "--out", outDir("a"), "--out", outDir("b")],
            ["--config", driveConfigPath, "--out", outDir("a"), "--bogus", "1"], ["--config", driveConfigPath, "--out", outDir("a"), "--root-folder-id", "short"],
            ["--config", driveConfigPath, "--out", outDir("a"), "--root-folder-id"],
        ];
        for (const args of cases) {
            const result = await cli(args);
            expect([result.code, result.err]).toEqual([64, ["config-invalid"]]);
        }
        const noDrive = await cli(["--config", h.configPath, "--out", outDir("a")]);
        expect([noDrive.code, noDrive.err]).toEqual([78, ["drive-not-configured"]]);
        expect(dh.drive.requests.length).toBe(before);
    });

    it("should stop with drive-root-changed (69) and the candidate ids when two roots carry the archive id, unless --root-folder-id picks one", async () => {
        const populated = await twoSnapshots();
        const second = await createRoot(dh, populated.installationId, "bjj-eformsign-backup-second");
        const mirror = outDir("mirror");

        const refused = await cli(restoreArgs(mirror));

        expect(refused.code).toBe(69);
        expect(refused.err).toEqual(["drive-root-changed"]);
        expect(JSON.parse(refused.out[0]!)).toEqual({ event: "restore_drive_root_ambiguous", reasonCode: "drive-root-changed", candidates: [populated.rootId, second.rootId].sort() });
        expect(await exists(mirror)).toBe(false);

        const chosen = await cli(restoreArgs(mirror, ["--root-folder-id", populated.rootId]));
        expect(chosen.code).toBe(0);
        expect(JSON.parse(chosen.out[0]!)).toMatchObject({ event: "restore_drive_verified", rootFolderId: populated.rootId });
        expect(await mirrorFiles(mirror)).toEqual([...populated.ids.keys()].sort());
    }, 180_000);

    it("should stop with drive-root-changed (69) when there is no root, or the chosen folder is trashed, not a folder or of another archive", async () => {
        const none = await cli(restoreArgs(outDir("none")));
        expect([none.code, none.err]).toEqual([69, ["drive-root-changed"]]);
        expect(JSON.parse(none.out[0]!)).toEqual({ event: "restore_drive_root_ambiguous", reasonCode: "drive-root-changed", candidates: [] });
        expect(await exists(outDir("none"))).toBe(false);

        const populated = await twoSnapshots();
        const file = populated.ids.get([...populated.ids.keys()].find((key) => key.endsWith(".pdf"))!)!;
        const foreign = dh.drive.seed({ id: "ForeignArchiveRoot00001", name: "other", appProperties: { bjjArchiveId: "33333333-3333-4333-8333-333333333333" } });
        for (const id of [file, foreign.id, "NoSuchFolderIdAtAll0001"]) {
            const result = await cli(restoreArgs(outDir(`bad-${id}`), ["--root-folder-id", id]));
            expect([result.code, result.err]).toEqual([69, ["drive-root-changed"]]);
        }
        dh.drive.trash(populated.rootId);
        const trashed = await cli(restoreArgs(outDir("trashed"), ["--root-folder-id", populated.rootId]));
        expect([trashed.code, trashed.err]).toEqual([69, ["drive-root-changed"]]);
        expect((await cli(restoreArgs(outDir("trashed-discovered")))).code).toBe(69);
    }, 180_000);

    it("should exit 78 with drive-token-invalid when the refresh token is revoked between page 1 and page 2 of a listing (A3.1)", async () => {
        await twoSnapshots();
        dh.drive.pageSizeCap = 1;
        let revoked = false;
        const fetchImpl: typeof fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            if (!revoked && url.includes("pageToken=")) {
                revoked = true;
                dh.oauth.revoke();
            }
            return fetch(input, init);
        };

        const result = await cli(restoreArgs(outDir("mirror")), { fetchImpl });

        expect(revoked).toBe(true);
        expect([result.code, result.err]).toEqual([78, ["drive-token-invalid"]]);
    }, 180_000);

    it("should map Drive being down to 69 and never print a token, a url or a response body", async () => {
        await twoSnapshots();
        dh.drive.addFault({ route: "*", action: driveFaults.canary("CANARY-SECRET-BODY-7f3a") });
        dh.drive.addFault({ route: "list", action: driveFaults.status(503, "backendError") });

        const result = await cli(restoreArgs(outDir("mirror")));

        expect(result.code).toBe(69);
        expect(result.err).toEqual(["drive-unavailable"]);
        const everything = JSON.stringify([result.out, result.err]);
        for (const secret of ["CANARY-SECRET-BODY-7f3a", dh.oauth.refreshToken, dh.oauth.clientSecret, "127.0.0.1", "Bearer"]) expect(everything).not.toContain(secret);
    }, 180_000);
});
