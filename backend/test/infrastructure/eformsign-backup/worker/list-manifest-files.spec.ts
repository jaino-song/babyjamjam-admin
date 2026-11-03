import { promises as fs } from "node:fs";
import path from "node:path";

import { listManifestFiles } from "infrastructure/eformsign-backup/worker/restore";

import { makeBase } from "./helpers/runner-support";

const COMPANY = "C001";
const REVISION = "a".repeat(64);
const OTHER_REVISION = "b".repeat(64);
const DIGEST = "c".repeat(64);

/**
 * PF1c: the manifest listing is complete-or-error. Its result is negative evidence (a recovered artifact with no manifest is
 * terminal), so a listing that failed part-way must never come back as an empty or partial list.
 */
describe("BJJ-456 PF1c: listManifestFiles is complete-or-error", () => {
    let base: string;
    let archive: string;

    beforeEach(async () => {
        base = await makeBase("bjj456-list-manifests-");
        archive = path.join(base, "archive");
        await fs.mkdir(archive, { mode: 0o700 });
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.rm(base, { recursive: true, force: true });
    });

    const company = (): string => path.join(archive, "eformsign", COMPANY);
    const manifestsDir = (documentId: string): string => path.join(company(), documentId, "manifests");
    async function addManifest(documentId: string, name: string): Promise<void> {
        await fs.mkdir(manifestsDir(documentId), { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(manifestsDir(documentId), name), "{}", { mode: 0o600 });
    }
    const keyOf = (documentId: string, name: string): string => `eformsign/${COMPANY}/${documentId}/manifests/${name}`;
    const list = () => listManifestFiles(archive, COMPANY);

    type Method = "readdir" | "lstat";
    /** Every call of `method` on `target` fails with `code`; every other call is the real one. */
    function failOn(method: Method, target: string, code = "EIO"): void {
        const real = fs[method].bind(fs) as (...args: unknown[]) => Promise<unknown>;
        jest.spyOn(fs, method).mockImplementation(((candidate: unknown, ...rest: unknown[]) =>
            String(candidate) === target ? Promise.reject(Object.assign(new Error("synthetic"), { code })) : real(candidate, ...rest)) as never);
    }
    /** A directory listing that names `extra` as well: the child is there when it is listed and gone when it is opened. */
    function listAlso(target: string, extra: string): void {
        const real = fs.readdir.bind(fs) as (...args: unknown[]) => Promise<string[]>;
        jest.spyOn(fs, "readdir").mockImplementation((async (candidate: unknown, ...rest: unknown[]) => {
            const names = await real(candidate, ...rest);
            return String(candidate) === target ? [...names, extra] : names;
        }) as never);
    }

    describe("a listing that completes", () => {
        it("should list legacy and versioned manifests sorted by document, then name, and ignore what is not a manifest", async () => {
            await addManifest("D002", `${REVISION}.json`);
            await addManifest("D001", `${OTHER_REVISION}-${DIGEST}.json`);
            await addManifest("D001", `${REVISION}.json`);
            await fs.writeFile(path.join(manifestsDir("D001"), "notes.txt"), "x", { mode: 0o600 });
            await fs.writeFile(path.join(company(), "stray-file"), "x", { mode: 0o600 });
            await fs.mkdir(path.join(company(), "bad id"), { recursive: true });

            expect(await list()).toEqual([
                { documentId: "D001", metadataRevision: REVISION, key: keyOf("D001", `${REVISION}.json`) },
                { documentId: "D001", metadataRevision: OTHER_REVISION, key: keyOf("D001", `${OTHER_REVISION}-${DIGEST}.json`) },
                { documentId: "D002", metadataRevision: REVISION, key: keyOf("D002", `${REVISION}.json`) },
            ]);
        });

        it("should still refuse a symbolic link in place of a document directory", async () => {
            await addManifest("D001", `${REVISION}.json`);
            await fs.symlink(path.join(company(), "D001"), path.join(company(), "D002"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unsafe-path" });
        });
    });

    describe("genuine absence keeps its empty-list meaning", () => {
        it("should return an empty list for an empty archive", async () => {
            expect(await list()).toEqual([]);
        });
        it("should return an empty list when the archive has no company directory", async () => {
            await fs.mkdir(path.join(archive, "eformsign"), { recursive: true });
            await fs.mkdir(path.join(archive, "eformsign", "OTHER"), { recursive: true });

            expect(await list()).toEqual([]);
        });
        it("should return an empty list for a company with no documents", async () => {
            await fs.mkdir(company(), { recursive: true });

            expect(await list()).toEqual([]);
        });
        it("should skip a document with no manifests directory and one with an empty manifests directory", async () => {
            await fs.mkdir(path.join(company(), "D001"), { recursive: true });
            await fs.mkdir(manifestsDir("D002"), { recursive: true });
            await addManifest("D003", `${REVISION}.json`);

            expect(await list()).toEqual([{ documentId: "D003", metadataRevision: REVISION, key: keyOf("D003", `${REVISION}.json`) }]);
        });
    });

    describe("a listing that could not be completed is an error, never a shorter list", () => {
        it("should reject when the archive root is gone", async () => {
            await fs.rm(archive, { recursive: true, force: true });

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the archive root cannot be listed", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", archive);

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the eformsign directory cannot be listed", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", path.join(archive, "eformsign"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the company directory cannot be listed (EIO)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", company());

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the company directory cannot be listed (ENOENT after the parent listed it)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", company(), "ENOENT");

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when a document directory cannot be listed", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", path.join(company(), "D001"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when a manifests directory cannot be listed (EIO)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", manifestsDir("D001"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when a manifests directory its document listed is gone when it is opened (ENOENT)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("readdir", manifestsDir("D001"), "ENOENT");

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when a document cannot be examined (EIO)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            failOn("lstat", path.join(company(), "D001"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when a listed document is gone when it is examined (ENOENT)", async () => {
            await addManifest("D001", `${REVISION}.json`);
            listAlso(company(), "D002");

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the company directory the eformsign listing named is gone", async () => {
            await fs.mkdir(path.join(archive, "eformsign"), { recursive: true });
            listAlso(path.join(archive, "eformsign"), COMPANY);

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should reject when the manifests directory a document listing named is gone", async () => {
            await fs.mkdir(path.join(company(), "D001"), { recursive: true });
            listAlso(path.join(company(), "D001"), "manifests");

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should not let a valid earlier document hide the failure of a later one", async () => {
            await addManifest("D001", `${REVISION}.json`);
            await addManifest("D002", `${REVISION}.json`);
            await addManifest("D003", `${REVISION}.json`);
            failOn("readdir", manifestsDir("D002"));

            await expect(list()).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
    });
});
