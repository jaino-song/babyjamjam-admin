import { promises as fs } from "node:fs";
import path from "node:path";

import { artifactKey, completionKey, manifestKey, runKey, WorkerError } from "domain/eformsign-backup/worker";
import { ExportClient, ExportFailure } from "infrastructure/eformsign-backup/worker/export-client";
import { NFS_SUPER_MAGIC } from "infrastructure/eformsign-backup/worker/fs-probe";

import {
    TEST_ARCHIVE_ID, TEST_INSTALLATION_ID, installationMarkerBytes, makeArchive, makeDestination, makeTestBase, probeFor, publishInput,
    restoreDirectoryModes, sha256Of, snapshotTree, streamOf, type ArchiveFixture,
} from "./helpers/destination-support";
import { FakeExportServer } from "./helpers/destination-fake-export-server";
import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

const UUID_RUN = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f";
const pdf = buildMinimalPdf("main");

describe("LocalDestination", () => {
    let base: string;
    let fixture: ArchiveFixture;
    beforeEach(async () => {
        base = await makeTestBase();
        fixture = await makeArchive(base);
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await restoreDirectoryModes(fixture.root);
        await fs.rm(base, { recursive: true, force: true });
    });

    /** Rename the archive away and put a fresh directory (same path, new inode) in its place. */
    async function swapRoot(withMarker = true): Promise<string> {
        await fs.rename(fixture.root, path.join(base, "original"));
        await fs.mkdir(fixture.root, { mode: 0o700 });
        if (withMarker) {
            await fs.mkdir(path.join(fixture.root, ".bjj-backup"), { mode: 0o700 });
            await fs.writeFile(path.join(fixture.root, ".bjj-backup", "installation.json"), installationMarkerBytes(), { mode: 0o600 });
        }
        return path.join(base, "original");
    }

    describe("checkArchive", () => {
        it("should accept a healthy archive and create nothing", async () => {
            const before = await snapshotTree(base);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: true });
            expect(await snapshotTree(base)).toEqual(before);
        });
        it("should never create a missing root", async () => {
            await fs.rm(fixture.root, { recursive: true });
            const result = await makeDestination(fixture).checkArchive();
            expect(result.ok).toBe(false);
            await expect(fs.lstat(fixture.root)).rejects.toMatchObject({ code: "ENOENT" });
        });
        it("should refuse a root whose inode changed even if a valid marker is copied into it", async () => {
            await swapRoot(true);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
        });
        it("should refuse a root replaced by a symlink to the original", async () => {
            const original = await swapRoot(true);
            await fs.rm(fixture.root, { recursive: true });
            await fs.symlink(original, fixture.root);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
        });
        it("should refuse a path reached through a symlinked ancestor", async () => {
            await fs.symlink(base, path.join(base, "via-link"));
            const viaLink = makeDestination(fixture, { archivePath: path.join(base, "via-link", "archive") });
            expect(await viaLink.checkArchive()).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
        });
        it("should require a mount point by default and write nothing", async () => {
            const before = await snapshotTree(base);
            const strict = makeDestination(fixture, { requireMountPoint: undefined });
            expect(await strict.checkArchive()).toEqual({ ok: false, reasonCode: "archive-not-mount-point" });
            expect(await strict.publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-not-mount-point" });
            expect(await snapshotTree(base)).toEqual(before);
        });
        it.each([
            ["missing", async (f: ArchiveFixture) => fs.rm(path.join(f.root, ".bjj-backup"), { recursive: true })],
            ["wrong archiveId", async (f: ArchiveFixture) => fs.writeFile(path.join(f.root, ".bjj-backup", "installation.json"), installationMarkerBytes("22222222-2222-4222-8222-222222222222"))],
            ["not JSON", async (f: ArchiveFixture) => fs.writeFile(path.join(f.root, ".bjj-backup", "installation.json"), "nope")],
            ["extra field", async (f: ArchiveFixture) => fs.writeFile(path.join(f.root, ".bjj-backup", "installation.json"), JSON.stringify({ schemaVersion: 1, installationId: "i", archiveId: TEST_ARCHIVE_ID, createdAt: "2026-10-19T00:00:00.000Z", extra: 1 }))],
            ["a symlink", async (f: ArchiveFixture) => {
                await fs.rename(path.join(f.root, ".bjj-backup", "installation.json"), path.join(f.root, "elsewhere.json"));
                await fs.symlink(path.join(f.root, "elsewhere.json"), path.join(f.root, ".bjj-backup", "installation.json"));
            }],
            ["in a symlinked directory", async (f: ArchiveFixture) => {
                await fs.rename(path.join(f.root, ".bjj-backup"), path.join(f.root, "real-marker-dir"));
                await fs.symlink(path.join(f.root, "real-marker-dir"), path.join(f.root, ".bjj-backup"));
            }],
        ])("should refuse a marker that is %s", async (_name, break_) => {
            await break_(fixture);
            const before = await snapshotTree(base);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: false, reasonCode: "archive-marker-invalid" });
            expect(await snapshotTree(base)).toEqual(before);
        });
        it("should refuse a filesystem that is not on the allowlist", async () => {
            for (const type of [NFS_SUPER_MAGIC, 0x9123683e]) {
                expect(await makeDestination(fixture, {}, probeFor({ type })).checkArchive()).toEqual({ ok: false, reasonCode: "unsupported-filesystem" });
            }
        });
        it("should refuse low space in bytes or inodes, counting the incoming bytes", async () => {
            // 300 blocks * 4096 = 1,228,800 bytes available; the 1 MiB reserve (1,048,576) leaves 180,224.
            const lowBytes = makeDestination(fixture, {}, probeFor({ bavail: 100 }));
            expect(await lowBytes.checkArchive()).toEqual({ ok: false, reasonCode: "archive-space" });
            const lowInodes = makeDestination(fixture, {}, probeFor({ ffree: 5 }));
            expect(await lowInodes.checkArchive()).toEqual({ ok: false, reasonCode: "archive-space" });
            const tight = makeDestination(fixture, {}, probeFor({ bavail: 300 }));
            expect(await tight.checkArchive()).toEqual({ ok: true });
            expect(await tight.checkArchive(180_224)).toEqual({ ok: true });
            expect(await tight.checkArchive(180_224 + 1)).toEqual({ ok: false, reasonCode: "archive-space" });
        });
        it("should report a statfs failure as archive-unavailable", async () => {
            const probe = { statfs: async () => { throw new Error("EIO"); }, readProcLocks: async () => "" };
            expect(await makeDestination(fixture, {}, probe).checkArchive()).toEqual({ ok: false, reasonCode: "archive-unavailable" });
        });
        it("should refuse a read-only root (chmod 0500)", async () => {
            await fs.chmod(fixture.root, 0o500);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: false, reasonCode: "archive-unavailable" });
        });
        it("should refuse a group- or other-writable root", async () => {
            await fs.chmod(fixture.root, 0o770);
            expect(await makeDestination(fixture).checkArchive()).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
        });
    });

    describe("writeMarker", () => {
        const installation = { schemaVersion: 1 as const, installationId: TEST_INSTALLATION_ID, archiveId: TEST_ARCHIVE_ID, createdAt: "2026-10-19T00:00:00.000Z" };
        let blank: ArchiveFixture;
        beforeEach(async () => { blank = await makeArchive(base, { name: "blank", marker: false }); });
        afterEach(async () => { await restoreDirectoryModes(blank.root); });

        it("should write the marker into an empty root and then pass checkArchive", async () => {
            const destination = makeDestination(blank);
            expect(await destination.writeMarker(installation)).toEqual({ ok: true });
            const markerPath = path.join(blank.root, ".bjj-backup", "installation.json");
            expect(JSON.parse(await fs.readFile(markerPath, "utf8"))).toEqual(installation);
            expect((await fs.stat(markerPath)).mode & 0o777).toBe(0o600);
            expect((await fs.stat(path.dirname(markerPath))).mode & 0o777).toBe(0o700);
            expect(await destination.checkArchive()).toEqual({ ok: true });
        });
        it.each([["an empty eformsign/", ["eformsign"]], ["lost+found from mkfs", ["lost+found"]]])("should accept a root holding %s", async (_name, dirs) => {
            for (const dir of dirs) await fs.mkdir(path.join(blank.root, dir), { mode: 0o700 });
            expect(await makeDestination(blank).writeMarker(installation)).toEqual({ ok: true });
        });
        it.each([
            ["a non-empty eformsign/", async (r: string) => { await fs.mkdir(path.join(r, "eformsign", "C001"), { recursive: true, mode: 0o700 }); }],
            ["a stray file", async (r: string) => { await fs.writeFile(path.join(r, "stray.txt"), "x"); }],
            ["an existing .bjj-backup", async (r: string) => { await fs.mkdir(path.join(r, ".bjj-backup"), { mode: 0o700 }); }],
            ["eformsign as a file", async (r: string) => { await fs.writeFile(path.join(r, "eformsign"), "x"); }],
        ])("should refuse a root holding %s and change nothing", async (_name, prepare) => {
            await prepare(blank.root);
            const before = await snapshotTree(blank.root);
            expect(await makeDestination(blank).writeMarker(installation)).toEqual({ ok: false, reasonCode: "archive-conflict" });
            expect(await snapshotTree(blank.root)).toEqual(before);
        });
        it("should refuse an installation for another archive or a bad shape", async () => {
            const destination = makeDestination(blank);
            expect(await destination.writeMarker({ ...installation, archiveId: "22222222-2222-4222-8222-222222222222" }))
                .toEqual({ ok: false, reasonCode: "archive-marker-invalid" });
            expect(await destination.writeMarker({ ...installation, extra: 1 } as never)).toEqual({ ok: false, reasonCode: "archive-marker-invalid" });
            expect(await fs.readdir(blank.root)).toEqual([]);
        });
        it("should refuse a swapped root and a root that is not a mount point", async () => {
            await fs.rename(blank.root, path.join(base, "blank-original"));
            await fs.mkdir(blank.root, { mode: 0o700 });
            expect(await makeDestination(blank).writeMarker(installation)).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
            expect(await fs.readdir(blank.root)).toEqual([]);
            const fresh = await makeArchive(base, { name: "blank2", marker: false });
            expect(await makeDestination(fresh, { requireMountPoint: undefined }).writeMarker(installation))
                .toEqual({ ok: false, reasonCode: "archive-not-mount-point" });
        });
        it("should refuse an unsupported filesystem and low space", async () => {
            expect(await makeDestination(blank, {}, probeFor({ type: NFS_SUPER_MAGIC })).writeMarker(installation)).toEqual({ ok: false, reasonCode: "unsupported-filesystem" });
            expect(await makeDestination(blank, {}, probeFor({ bavail: 1 })).writeMarker(installation)).toEqual({ ok: false, reasonCode: "archive-space" });
            expect(await fs.readdir(blank.root)).toEqual([]);
        });
    });

    describe("publishArtifact", () => {
        it("should publish a PDF under the contract path with private modes and no leftover temp", async () => {
            const input = publishInput(pdf);
            const result = await makeDestination(fixture).publishArtifact(input, streamOf(pdf));
            const key = artifactKey({ companyId: "C001", documentId: "D001", artifactType: "document", sha256: sha256Of(pdf) });
            expect(result).toEqual({ ok: true, relativeKey: key, disposition: "created" });
            const finalPath = path.join(fixture.root, key);
            expect((await fs.readFile(finalPath)).equals(pdf)).toBe(true);
            expect((await fs.stat(finalPath)).mode & 0o777).toBe(0o600);
            for (const dir of ["eformsign", "eformsign/C001", "eformsign/C001/D001", "eformsign/C001/D001/artifacts", "eformsign/C001/D001/artifacts/document"]) {
                expect((await fs.stat(path.join(fixture.root, dir))).mode & 0o777).toBe(0o700);
            }
            expect((await fs.readdir(path.dirname(finalPath)))).toEqual([`${sha256Of(pdf)}.pdf`]);
        });
        it("should reuse the same artifact on a second publish and for the audit-trail type", async () => {
            const destination = makeDestination(fixture);
            await destination.publishArtifact(publishInput(pdf), streamOf(pdf));
            expect(await destination.publishArtifact(publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: true, disposition: "reused" });
            const audit = buildMinimalPdf("audit");
            const result = await destination.publishArtifact(publishInput(audit, { artifactType: "audit-trail" }), streamOf(audit));
            expect(result).toMatchObject({ ok: true, disposition: "created" });
            expect(result.ok && result.relativeKey).toContain("/artifacts/audit-trail/");
        });
        it("should check the archive before consuming the source", async () => {
            await fs.rm(path.join(fixture.root, ".bjj-backup"), { recursive: true });
            let consumed = false;
            async function* source() { consumed = true; yield pdf; }
            expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), source())).toEqual({ ok: false, reasonCode: "archive-marker-invalid" });
            expect(consumed).toBe(false);
        });

        describe("T-WRK-08: archive faults write nothing", () => {
            async function expectNothingWritten(prepare: () => Promise<void>, reasonCode: string, destination = makeDestination(fixture)) {
                await prepare();
                const before = await snapshotTree(base);
                expect(await destination.publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode });
                expect(await snapshotTree(base)).toEqual(before);
                expect(await destination.publishJson(manifestKey({ companyId: "C001", documentId: "D001", metadataRevision: "a".repeat(64) }), Buffer.from("{}")))
                    .toEqual({ ok: false, reasonCode });
                expect(await snapshotTree(base)).toEqual(before);
            }
            it("should refuse a root renamed and recreated (inode change)", async () => {
                await expectNothingWritten(async () => { await swapRoot(true); }, "archive-identity-mismatch");
            });
            it("should refuse a root renamed and recreated without a marker", async () => {
                await expectNothingWritten(async () => { await swapRoot(false); }, "archive-identity-mismatch");
            });
            it("should refuse a read-only root (chmod 0500)", async () => {
                await expectNothingWritten(async () => fs.chmod(fixture.root, 0o500), "archive-unavailable");
            });
            it.each([
                ["low free bytes", { bavail: 100 }, "archive-space"],
                ["low free inodes", { ffree: 5 }, "archive-space"],
                ["NFS", { type: NFS_SUPER_MAGIC }, "unsupported-filesystem"],
            ])("should refuse on %s", async (_name, statfs, reasonCode) => {
                await expectNothingWritten(async () => undefined, reasonCode, makeDestination(fixture, {}, probeFor(statfs)));
            });
            it("should refuse a missing marker and a marker of another archive", async () => {
                await expectNothingWritten(async () => fs.rm(path.join(fixture.root, ".bjj-backup"), { recursive: true }), "archive-marker-invalid");
            });
            it("should refuse a root swapped while the bytes stream in, leaving the new root without files", async () => {
                async function* swapping() {
                    yield pdf.subarray(0, 10);
                    await swapRoot(true);
                    yield pdf.subarray(10);
                }
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf), swapping());
                expect(result.ok).toBe(false);
                expect((await snapshotTree(fixture.root)).filter(line => line.includes(".pdf"))).toEqual([]);
                expect((await snapshotTree(fixture.root)).filter(line => line.includes("|f|") && !line.includes("installation.json"))).toEqual([]);
            });
            it("should refuse when the root is swapped while the leaf directories are being created", async () => {
                let calls = 0;
                const original = probeFor();
                const probe = {
                    readProcLocks: original.readProcLocks,
                    statfs: async (p: string) => {
                        if (++calls === 1) await swapRoot(true);
                        return original.statfs(p);
                    },
                };
                const result = await makeDestination(fixture, {}, probe).publishArtifact(publishInput(pdf), streamOf(pdf));
                expect(result).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
                expect((await snapshotTree(base)).filter(line => line.includes(".pdf"))).toEqual([]);
            });
        });

        describe("T-WRK-09: bad bytes and bad paths are rejected without a final file", () => {
            const finalFiles = async () => (await snapshotTree(base)).filter(line => line.endsWith(".pdf") || line.includes(".pdf|"));
            it("should refuse a truncated stream", async () => {
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf.subarray(0, pdf.length - 20)));
                expect(result).toEqual({ ok: false, reasonCode: "artifact-integrity" });
                expect(await finalFiles()).toEqual([]);
            });
            it("should refuse bytes whose sha256 differs from the claim", async () => {
                const other = buildMinimalPdf("other");
                const claimed = publishInput(pdf, { byteLength: other.length });
                const result = await makeDestination(fixture).publishArtifact(claimed, streamOf(other));
                expect(result).toEqual({ ok: false, reasonCode: "artifact-integrity" });
                expect(await finalFiles()).toEqual([]);
            });
            it("should refuse extra bytes beyond the claimed length", async () => {
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(Buffer.concat([pdf, Buffer.from("EXTRA")])));
                expect(result).toEqual({ ok: false, reasonCode: "artifact-integrity" });
                expect(await finalFiles()).toEqual([]);
            });
            it("should refuse non-PDF bytes even when the sha256 matches them", async () => {
                const text = Buffer.from("this is plain text, not a pdf file at all ".repeat(5));
                const result = await makeDestination(fixture).publishArtifact(publishInput(text), streamOf(text));
                expect(result).toEqual({ ok: false, reasonCode: "pdf-shape" });
                expect(await finalFiles()).toEqual([]);
            });
            it.each([[".."], ["a/b"], ["%2F"], ["a%2Fb"], ["."], [""], ["completions"], ["runs"], ["x".repeat(256)], ["a\u0000b"]])(
                "should refuse documentId %j and create no directory", async documentId => {
                    const before = await snapshotTree(base);
                    const result = await makeDestination(fixture).publishArtifact(publishInput(pdf, { documentId }), streamOf(pdf));
                    expect(result).toEqual({ ok: false, reasonCode: "invalid-path-segment" });
                    expect(await snapshotTree(base)).toEqual(before);
                });
            it.each([["../C001"], ["C/001"], [""]])("should refuse companyId %j", async companyId => {
                const before = await snapshotTree(base);
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf, { companyId }), streamOf(pdf)))
                    .toEqual({ ok: false, reasonCode: "invalid-path-segment" });
                expect(await snapshotTree(base)).toEqual(before);
            });
            it("should refuse a claim whose identity does not match its fields", async () => {
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf, { artifactIdentity: "f".repeat(64) }), streamOf(pdf));
                expect(result).toEqual({ ok: false, reasonCode: "export-response-invalid" });
                expect(await finalFiles()).toEqual([]);
            });
            it("should refuse more than 64 MiB before reading the source", async () => {
                let consumed = false;
                async function* source() { consumed = true; yield pdf; }
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf, { byteLength: 64 * 1024 * 1024 + 1 }), source());
                expect(result).toEqual({ ok: false, reasonCode: "artifact-too-large" });
                expect(consumed).toBe(false);
            });
            it.each(["artifacts", "D001", "C001", "eformsign"])("should refuse a symlinked %s segment and not write through it", async segment => {
                const outside = path.join(base, "outside");
                await fs.mkdir(outside, { mode: 0o700 });
                const dirs: Record<string, string> = {
                    eformsign: "eformsign", C001: "eformsign/C001", D001: "eformsign/C001/D001", artifacts: "eformsign/C001/D001/artifacts",
                };
                const target = dirs[segment]!;
                const parent = path.dirname(target);
                if (parent !== ".") await fs.mkdir(path.join(fixture.root, parent), { recursive: true, mode: 0o700 });
                await fs.symlink(outside, path.join(fixture.root, target));
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf));
                expect(result).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
                expect(await fs.readdir(outside)).toEqual([]);
                expect(await finalFiles()).toEqual([]);
            });
            it("should refuse a regular file where a directory is expected", async () => {
                await fs.mkdir(path.join(fixture.root, "eformsign", "C001"), { recursive: true, mode: 0o700 });
                await fs.writeFile(path.join(fixture.root, "eformsign", "C001", "D001"), "x");
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
            });
            it("should refuse a leaf directory that is group-writable", async () => {
                await fs.mkdir(path.join(fixture.root, "eformsign"), { mode: 0o700 });
                await fs.chmod(path.join(fixture.root, "eformsign"), 0o770);
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
            });
        });

        describe("review fixes", () => {
            it("should report a connection dropped mid-download as network-timeout, never as an integrity error", async () => {
                const server = new FakeExportServer();
                try {
                    const baseUrl = await server.start();
                    const identity = "a".repeat(64);
                    server.handler = (_req, res) => {
                        res.writeHead(200, { "Content-Length": String(pdf.length), "X-Artifact-Identity": identity, "X-Content-Sha256": sha256Of(pdf) });
                        res.write(pdf.subarray(0, 40));
                        setTimeout(() => res.destroy(), 20);
                    };
                    const client = new ExportClient({ baseUrl, token: `ebx_${"A".repeat(43)}`, companyId: "C001", requestTimeoutMs: 3000 });
                    const source = await client.openArtifact("7c1f6f0e-2a3b-4c5d-8e9f-0a1b2c3d4e5f", { artifactIdentity: identity, sha256: sha256Of(pdf), byteLength: pdf.length });
                    const before = await snapshotTree(base);
                    expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), source)).toEqual({ ok: false, reasonCode: "network-timeout" });
                    expect((await snapshotTree(base)).filter(line => line.includes(".pdf|"))).toEqual((before).filter(line => line.includes(".pdf|")));
                } finally { await server.stop(); }
            });
            it("should refuse a directory segment that sits on another device than the archive root", async () => {
                const realLstat = fs.lstat.bind(fs);
                jest.spyOn(fs, "lstat").mockImplementation((async (target: Parameters<typeof fs.lstat>[0], ...rest: unknown[]) => {
                    const stat = await (realLstat as (...a: unknown[]) => Promise<import("node:fs").Stats>)(target, ...rest);
                    return String(target).endsWith("/eformsign/C001") ? Object.create(stat, { dev: { value: stat.dev + 1 } }) : stat;
                }) as typeof fs.lstat);
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
                expect((await snapshotTree(base)).filter(line => line.includes(".pdf|"))).toEqual([]);
            });
            it("should apply the same device check to JSON publishing", async () => {
                const realLstat = fs.lstat.bind(fs);
                jest.spyOn(fs, "lstat").mockImplementation((async (target: Parameters<typeof fs.lstat>[0], ...rest: unknown[]) => {
                    const stat = await (realLstat as (...a: unknown[]) => Promise<import("node:fs").Stats>)(target, ...rest);
                    return String(target).endsWith("/manifests") ? Object.create(stat, { dev: { value: stat.dev + 1 } }) : stat;
                }) as typeof fs.lstat);
                const key = manifestKey({ companyId: "C001", documentId: "D001", metadataRevision: "a".repeat(64) });
                expect(await makeDestination(fixture).publishJson(key, Buffer.from("{}"))).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
            });
            it("should not report a successful publish as archive-space when room drops only after the file is published", async () => {
                let low = false;
                const healthy = probeFor();
                const probe = { readProcLocks: healthy.readProcLocks, statfs: async (p: string) => ({ ...(await healthy.statfs(p)), bavail: low ? 1 : 1_000_000, ffree: low ? 1 : 1_000_000 }) };
                const destination = makeDestination(fixture, {}, probe, point => { if (point === "directory-sync") low = true; });
                const result = await destination.publishArtifact(publishInput(pdf), streamOf(pdf));
                expect(low).toBe(true);
                expect(result).toMatchObject({ ok: true, disposition: "created" });
                expect((await fs.readFile(path.join(fixture.root, (result as { relativeKey: string }).relativeKey))).equals(pdf)).toBe(true);
            });
        });

        describe("failure classification of the archive primitive", () => {
            const finalDir = () => path.join(fixture.root, "eformsign", "C001", "D001", "artifacts", "document");
            const finalName = () => `${sha256Of(pdf)}.pdf`;
            async function preplace(content: Buffer | "directory" | "symlink") {
                await fs.mkdir(finalDir(), { recursive: true, mode: 0o700 });
                const target = path.join(finalDir(), finalName());
                if (content === "directory") await fs.mkdir(target, { mode: 0o700 });
                else if (content === "symlink") { await fs.writeFile(path.join(base, "target"), pdf); await fs.symlink(path.join(base, "target"), target); }
                else await fs.writeFile(target, content, { mode: 0o600 });
                return target;
            }
            it("should report archive-conflict and keep the file when different bytes already sit at the final path", async () => {
                const different = Buffer.alloc(pdf.length, 0x41);
                const target = await preplace(different);
                const result = await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf));
                expect(result).toEqual({ ok: false, reasonCode: "archive-conflict" });
                expect((await fs.readFile(target)).equals(different)).toBe(true);
            });
            it("should report archive-conflict for a shorter existing file too", async () => {
                const target = await preplace(Buffer.from("short"));
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-conflict" });
                expect((await fs.readFile(target)).toString()).toBe("short");
            });
            it("should reuse identical existing bytes (no-clobber, same content)", async () => {
                await preplace(pdf);
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: true, disposition: "reused" });
            });
            it("should report a symlink at the final path as unsafe and leave its target alone", async () => {
                await preplace("symlink");
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
                expect((await fs.readFile(path.join(base, "target"))).equals(pdf)).toBe(true);
            });
            it("should report a directory at the final path as a conflict", async () => {
                await preplace("directory");
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-conflict" });
            });
            it("should report an I/O failure as archive-unavailable without a final file", async () => {
                const destination = makeDestination(fixture, {}, probeFor(), point => { if (point === "write") throw new Error("injected EIO"); });
                expect(await destination.publishArtifact(publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-unavailable" });
                expect((await snapshotTree(base)).filter(line => line.includes(".pdf|"))).toEqual([]);
            });
            it("should keep a published file when a late fault fires and then reuse it on retry", async () => {
                const faulty = makeDestination(fixture, {}, probeFor(), point => { if (point === "directory-sync") throw new Error("injected"); });
                expect(await faulty.publishArtifact(publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: false });
                expect(await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: true, disposition: "reused" });
            });
            it("should carry the reason of a failing source: integrity from the client, network, or unknown", async () => {
                const failing = (error: unknown) => (async function* () { yield pdf.subarray(0, 5); throw error; })();
                const destination = makeDestination(fixture);
                expect(await destination.publishArtifact(publishInput(pdf), failing(new WorkerError("artifact-integrity")))).toEqual({ ok: false, reasonCode: "artifact-integrity" });
                expect(await destination.publishArtifact(publishInput(pdf), failing(new ExportFailure(0, "NETWORK", true, null)))).toEqual({ ok: false, reasonCode: "network-timeout" });
                expect(await destination.publishArtifact(publishInput(pdf), failing(new Error("private detail")))).toEqual({ ok: false, reasonCode: "internal" });
                expect((await snapshotTree(base)).filter(line => line.includes(".pdf|"))).toEqual([]);
            });
        });
    });

    describe("staging", () => {
        let control: string;
        beforeEach(async () => {
            control = path.join(base, "control");
            await fs.mkdir(control, { mode: 0o700 });
        });

        it("should create the staging directory 0700 and return its identity, idempotently", async () => {
            const destination = makeDestination(fixture);
            const first = await destination.ensureStaging(control);
            expect(first.ok).toBe(true);
            const stat = await fs.lstat(path.join(control, "staging"));
            expect(first.ok && first.root).toEqual({ path: path.join(control, "staging"), dev: stat.dev, ino: stat.ino });
            expect(stat.mode & 0o777).toBe(0o700);
            expect(await destination.ensureStaging(control)).toEqual(first);
        });
        it.each([
            ["a symlink", async (c: string) => { await fs.mkdir(path.join(c, "real")); await fs.symlink(path.join(c, "real"), path.join(c, "staging")); }],
            ["a regular file", async (c: string) => { await fs.writeFile(path.join(c, "staging"), "x"); }],
            ["group-writable", async (c: string) => { await fs.mkdir(path.join(c, "staging"), { mode: 0o700 }); await fs.chmod(path.join(c, "staging"), 0o770); }],
            ["other-writable", async (c: string) => { await fs.mkdir(path.join(c, "staging"), { mode: 0o700 }); await fs.chmod(path.join(c, "staging"), 0o702); }],
        ])("should refuse a staging path that is %s", async (_name, prepare) => {
            await prepare(control);
            expect(await makeDestination(fixture).ensureStaging(control)).toEqual({ ok: false, reasonCode: "control-unavailable" });
        });
        it("should refuse a missing control directory without creating it", async () => {
            expect(await makeDestination(fixture).ensureStaging(path.join(base, "no-control"))).toEqual({ ok: false, reasonCode: "control-unavailable" });
            await expect(fs.lstat(path.join(base, "no-control"))).rejects.toMatchObject({ code: "ENOENT" });
        });

        it("should stage a PDF as a flat <identity>.bin and stream it back", async () => {
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            const input = publishInput(pdf);
            const result = await destination.stageArtifact(staging.root, input, streamOf(pdf));
            expect(result).toEqual({ ok: true, relativeKey: `${input.artifactIdentity}.bin`, disposition: "created" });
            const chunks: Buffer[] = [];
            for await (const chunk of destination.openStaged(staging.root, input.artifactIdentity)) chunks.push(Buffer.from(chunk));
            expect(Buffer.concat(chunks).equals(pdf)).toBe(true);
            expect(await destination.stageArtifact(staging.root, input, streamOf(pdf))).toMatchObject({ ok: true, disposition: "reused" });
            expect(await fs.readdir(staging.root.path)).toEqual([`${input.artifactIdentity}.bin`]);
        });
        it("should publish from staged bytes into the archive end to end", async () => {
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            const input = publishInput(pdf);
            await destination.stageArtifact(staging.root, input, streamOf(pdf));
            expect(await destination.publishArtifact(input, destination.openStaged(staging.root, input.artifactIdentity)))
                .toMatchObject({ ok: true, disposition: "created" });
        });
        it("should stage even while the archive is unavailable (control is independent)", async () => {
            await swapRoot(false);
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            expect(await destination.stageArtifact(staging.root, publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: true });
        });
        it("should refuse non-PDF bytes, wrong hashes and short streams in staging with no file", async () => {
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            const text = Buffer.from("not a pdf, just text. ".repeat(10));
            expect(await destination.stageArtifact(staging.root, publishInput(text), streamOf(text))).toEqual({ ok: false, reasonCode: "pdf-shape" });
            expect(await destination.stageArtifact(staging.root, publishInput(pdf), streamOf(pdf.subarray(0, 30)))).toEqual({ ok: false, reasonCode: "artifact-integrity" });
            expect(await destination.stageArtifact(staging.root, publishInput(pdf, { byteLength: pdf.length + 1 }), streamOf(pdf))).toEqual({ ok: false, reasonCode: "artifact-integrity" });
            expect(await fs.readdir(staging.root.path)).toEqual([]);
        });
        it("should report a control I/O failure as control-unavailable and a corrupt staged file as a conflict", async () => {
            const staging = await makeDestination(fixture).ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            const faulty = makeDestination(fixture, {}, probeFor(), point => { if (point === "file-sync") throw new Error("EIO"); });
            expect(await faulty.stageArtifact(staging.root, publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "control-unavailable" });
            await fs.writeFile(path.join(staging.root.path, `${publishInput(pdf).artifactIdentity}.bin`), Buffer.alloc(pdf.length, 0x41), { mode: 0o600 });
            expect(await makeDestination(fixture).stageArtifact(staging.root, publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "archive-conflict" });
        });
        it("should refuse a staging root whose identity changed", async () => {
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            await fs.rename(staging.root.path, path.join(control, "old-staging"));
            await fs.mkdir(staging.root.path, { mode: 0o700 });
            expect(await destination.stageArtifact(staging.root, publishInput(pdf), streamOf(pdf))).toEqual({ ok: false, reasonCode: "control-unavailable" });
            expect(await fs.readdir(staging.root.path)).toEqual([]);
        });
        it("should refuse to open a staged file that is a symlink or missing", async () => {
            const destination = makeDestination(fixture);
            const staging = await destination.ensureStaging(control);
            if (!staging.ok) throw new Error("staging");
            const identity = "9".repeat(64);
            const read = async () => { for await (const chunk of destination.openStaged(staging.root, identity)) void chunk; };
            await expect(read()).rejects.toMatchObject({ reasonCode: "control-unavailable" });
            await fs.writeFile(path.join(base, "elsewhere"), pdf);
            await fs.symlink(path.join(base, "elsewhere"), path.join(staging.root.path, `${identity}.bin`));
            await expect(read()).rejects.toMatchObject({ reasonCode: "control-unavailable" });
            const bad = async () => { for await (const chunk of destination.openStaged(staging.root, "../x")) void chunk; };
            await expect(bad()).rejects.toBeInstanceOf(WorkerError);
        });
    });

    describe("reverify and quarantineCorrupt", () => {
        const key = artifactKey({ companyId: "C001", documentId: "D001", artifactType: "document", sha256: sha256Of(pdf) });
        async function publish() {
            const destination = makeDestination(fixture);
            const result = await destination.publishArtifact(publishInput(pdf), streamOf(pdf));
            if (!result.ok) throw new Error("publish");
            return destination;
        }

        it("should say ok for an intact file", async () => {
            const destination = await publish();
            expect(await destination.reverify(key, sha256Of(pdf), pdf.length)).toBe("ok");
        });
        it("should say missing when the file or any directory is absent", async () => {
            const destination = makeDestination(fixture);
            expect(await destination.reverify(key, sha256Of(pdf), pdf.length)).toBe("missing");
            await publish();
            await fs.rename(path.join(fixture.root, key), path.join(fixture.root, "moved.pdf"));
            expect(await destination.reverify(key, sha256Of(pdf), pdf.length)).toBe("missing");
        });
        it.each([
            ["same length, different bytes", async (f: string) => { await fs.writeFile(f, Buffer.alloc(pdf.length, 0x41)); }],
            ["truncated", async (f: string) => { await fs.truncate(f, pdf.length - 5); }],
            ["extended", async (f: string) => { await fs.appendFile(f, "x"); }],
            ["replaced by a directory", async (f: string) => { await fs.rm(f); await fs.mkdir(f); }],
            ["replaced by a symlink", async (f: string) => { await fs.rm(f); await fs.writeFile(path.join(base, "t"), pdf); await fs.symlink(path.join(base, "t"), f); }],
        ])("should say mismatch for a file that is %s", async (_name, tamper) => {
            const destination = await publish();
            await tamper(path.join(fixture.root, key));
            expect(await destination.reverify(key, sha256Of(pdf), pdf.length)).toBe("mismatch");
        });
        it("should say mismatch when the claimed sha256 is not the one in the key", async () => {
            const destination = await publish();
            expect(await destination.reverify(key, "e".repeat(64), pdf.length)).toBe("mismatch");
        });
        it("should say mismatch for bytes that match the hash but are not PDF-shaped", async () => {
            const text = Buffer.from("plain text content that is long enough to pass the length rule. ".repeat(3));
            const textKey = artifactKey({ companyId: "C001", documentId: "D002", artifactType: "document", sha256: sha256Of(text) });
            const dir = path.join(fixture.root, path.dirname(textKey));
            await fs.mkdir(dir, { recursive: true, mode: 0o700 });
            await fs.writeFile(path.join(fixture.root, textKey), text, { mode: 0o600 });
            expect(await makeDestination(fixture).reverify(textKey, sha256Of(text), text.length)).toBe("mismatch");
        });
        it("should throw for an invalid key and for a symlinked directory on the way", async () => {
            const destination = await publish();
            await expect(destination.reverify("../x.pdf", sha256Of(pdf), 1)).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
            await fs.rename(path.join(fixture.root, "eformsign", "C001", "D001", "artifacts"), path.join(base, "moved-artifacts"));
            await fs.symlink(path.join(base, "moved-artifacts"), path.join(fixture.root, "eformsign", "C001", "D001", "artifacts"));
            await expect(destination.reverify(key, sha256Of(pdf), pdf.length)).rejects.toMatchObject({ reasonCode: "archive-unsafe-path" });
        });
        it("should refuse to verify in a swapped root", async () => {
            const destination = await publish();
            await swapRoot(true);
            await expect(destination.reverify(key, sha256Of(pdf), pdf.length)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
        });

        it("should quarantine by rename in the same directory, keeping every byte", async () => {
            const destination = await publish();
            await fs.writeFile(path.join(fixture.root, key), Buffer.alloc(pdf.length, 0x41));
            const quarantined = await destination.quarantineCorrupt(key, UUID_RUN);
            expect(quarantined).toBe(`${key}.corrupt-${UUID_RUN}`);
            await expect(fs.lstat(path.join(fixture.root, key))).rejects.toMatchObject({ code: "ENOENT" });
            expect((await fs.readFile(path.join(fixture.root, quarantined))).equals(Buffer.alloc(pdf.length, 0x41))).toBe(true);
            expect(await destination.reverify(key, sha256Of(pdf), pdf.length)).toBe("missing");
            // V10: a fresh publish after quarantine recreates the good file.
            expect(await destination.publishArtifact(publishInput(pdf), streamOf(pdf))).toMatchObject({ ok: true, disposition: "created" });
        });
        it("should never overwrite an earlier quarantine file", async () => {
            const destination = await publish();
            await destination.quarantineCorrupt(key, UUID_RUN);
            await destination.publishArtifact(publishInput(pdf), streamOf(pdf));
            const before = await snapshotTree(fixture.root);
            await expect(destination.quarantineCorrupt(key, UUID_RUN)).rejects.toMatchObject({ reasonCode: "archive-conflict" });
            expect(await snapshotTree(fixture.root)).toEqual(before);
        });
        it("should reject a bad run id, a missing file and a non-artifact key", async () => {
            const destination = await publish();
            await expect(destination.quarantineCorrupt(key, "../x")).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
            await expect(destination.quarantineCorrupt("eformsign/C001/D001/manifests/" + "a".repeat(64) + ".json", UUID_RUN)).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
            await destination.quarantineCorrupt(key, UUID_RUN);
            await expect(destination.quarantineCorrupt(key, "4f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f")).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
        it("should refuse to quarantine in a swapped root", async () => {
            const destination = await publish();
            await swapRoot(true);
            await expect(destination.quarantineCorrupt(key, UUID_RUN)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
        });
    });

    describe("publishJson", () => {
        const manifest = manifestKey({ companyId: "C001", documentId: "D001", metadataRevision: "a".repeat(64) });
        const completion = completionKey({ companyId: "C001", sequence: 1, contentDigest: "b".repeat(64) });
        const run = runKey({ companyId: "C001", runId: UUID_RUN });
        const bytes = Buffer.from('{"synthetic":1}\n');

        it.each([["manifest", manifest], ["completion", completion], ["run", run]])("should publish a %s file, reuse it, and refuse different bytes", async (_name, key) => {
            const destination = makeDestination(fixture);
            expect(await destination.publishJson(key, bytes)).toEqual({ ok: true, relativeKey: key, disposition: "created" });
            expect((await fs.readFile(path.join(fixture.root, key))).equals(bytes)).toBe(true);
            expect((await fs.stat(path.dirname(path.join(fixture.root, key)))).mode & 0o777).toBe(0o700);
            expect(await destination.publishJson(key, bytes)).toMatchObject({ ok: true, disposition: "reused" });
            expect(await destination.publishJson(key, Buffer.from("different"))).toEqual({ ok: false, reasonCode: "archive-conflict" });
            expect((await fs.readFile(path.join(fixture.root, key))).equals(bytes)).toBe(true);
            expect((await fs.readdir(path.dirname(path.join(fixture.root, key)))).filter(e => e.endsWith(".tmp"))).toEqual([]);
        });
        it.each([
            ["an artifact key", artifactKey({ companyId: "C001", documentId: "D001", artifactType: "document", sha256: "a".repeat(64) })],
            ["a traversal", "eformsign/C001/../D001/manifests/" + "a".repeat(64) + ".json"],
            ["an absolute path", "/etc/passwd"],
            ["a wrong extension", "eformsign/C001/D001/manifests/" + "a".repeat(64) + ".txt"],
            ["a non-hex name", "eformsign/C001/D001/manifests/revision.json"],
            ["a marker key", ".bjj-backup/installation.json"],
            ["an upper-case hex name", "eformsign/C001/D001/manifests/" + "A".repeat(64) + ".json"],
        ])("should refuse %s", async (_name, key) => {
            const before = await snapshotTree(base);
            expect(await makeDestination(fixture).publishJson(key, bytes)).toEqual({ ok: false, reasonCode: "invalid-path-segment" });
            expect(await snapshotTree(base)).toEqual(before);
        });
        it("should refuse a symlinked manifests directory", async () => {
            await fs.mkdir(path.join(fixture.root, "eformsign", "C001", "D001"), { recursive: true, mode: 0o700 });
            await fs.mkdir(path.join(base, "outside"));
            await fs.symlink(path.join(base, "outside"), path.join(fixture.root, "eformsign", "C001", "D001", "manifests"));
            expect(await makeDestination(fixture).publishJson(manifest, bytes)).toEqual({ ok: false, reasonCode: "archive-unsafe-path" });
            expect(await fs.readdir(path.join(base, "outside"))).toEqual([]);
        });
        it("should refuse to write into a swapped root", async () => {
            await swapRoot(true);
            const before = await snapshotTree(base);
            expect(await makeDestination(fixture).publishJson(run, bytes)).toEqual({ ok: false, reasonCode: "archive-identity-mismatch" });
            expect(await snapshotTree(base)).toEqual(before);
        });
        it("should reject a file larger than 64 MiB", async () => {
            expect(await makeDestination(fixture).publishJson(run, Buffer.alloc(64 * 1024 * 1024 + 1))).toEqual({ ok: false, reasonCode: "artifact-too-large" });
        });
    });

    describe("read helpers for restore", () => {
        const completionOne = completionKey({ companyId: "C001", sequence: 1, contentDigest: "b".repeat(64) });
        const completionTwo = completionKey({ companyId: "C001", sequence: 2, contentDigest: "c".repeat(64) });

        it("should list the completions with parsed content, null for unparseable bytes, and ignore directories", async () => {
            const destination = makeDestination(fixture);
            await destination.publishJson(completionOne, Buffer.from('{"a":1}'));
            await destination.publishJson(completionTwo, Buffer.from("not json"));
            await fs.mkdir(path.join(fixture.root, "eformsign", "C001", "completions", "subdir"), { mode: 0o700 });
            const list = await destination.listCompletions("C001");
            expect(list).toEqual([
                { name: path.basename(completionOne), content: { a: 1 } },
                { name: path.basename(completionTwo), content: null },
            ]);
        });
        it("should return an empty list when there is no completions directory, and reject a bad company id", async () => {
            const destination = makeDestination(fixture);
            expect(await destination.listCompletions("C001")).toEqual([]);
            await expect(destination.listCompletions("../x")).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
        });
        it("should reject a symlink in completions/ or on the way", async () => {
            const destination = makeDestination(fixture);
            await destination.publishJson(completionOne, Buffer.from("{}"));
            await fs.writeFile(path.join(base, "secret"), "{}");
            await fs.symlink(path.join(base, "secret"), path.join(fixture.root, "eformsign", "C001", "completions", path.basename(completionTwo)));
            await expect(destination.listCompletions("C001")).rejects.toMatchObject({ reasonCode: "archive-unsafe-path" });
            await expect(destination.readArchiveFile(completionTwo)).rejects.toMatchObject({ reasonCode: "archive-unsafe-path" });
        });
        it("should read an archive file, return null when missing, and refuse unsafe keys", async () => {
            const destination = makeDestination(fixture);
            await destination.publishJson(completionOne, Buffer.from('{"a":1}'));
            expect((await destination.readArchiveFile(completionOne))!.toString()).toBe('{"a":1}');
            expect(await destination.readArchiveFile(completionTwo)).toBeNull();
            for (const key of ["../x", "/etc/passwd", "a\\b", "", "a//b", "./a"]) {
                await expect(destination.readArchiveFile(key)).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
            }
        });
        it("should read without the archive marker or a supported filesystem (restore of a copied archive)", async () => {
            const destination = makeDestination(fixture);
            await destination.publishJson(completionOne, Buffer.from('{"a":1}'));
            await fs.rm(path.join(fixture.root, ".bjj-backup"), { recursive: true });
            const reader = makeDestination(fixture, {}, probeFor({ type: NFS_SUPER_MAGIC }));
            expect((await reader.readArchiveFile(completionOne))!.toString()).toBe('{"a":1}');
            expect(await reader.listCompletions("C001")).toHaveLength(1);
        });
        it("should refuse to read from a swapped root", async () => {
            await makeDestination(fixture).publishJson(completionOne, Buffer.from("{}"));
            await swapRoot(true);
            await expect(makeDestination(fixture).readArchiveFile(completionOne)).rejects.toMatchObject({ reasonCode: "archive-identity-mismatch" });
        });
    });
});
