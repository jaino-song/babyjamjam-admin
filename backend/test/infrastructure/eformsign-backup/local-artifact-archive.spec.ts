import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";

import { artifactIdentity, ArtifactClaim } from "domain/eformsign-backup/source-evidence";
import { LocalArtifactArchive, ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";

const bytes = Buffer.from("synthetic archive bytes\u0000\ufffd");
function claim(overrides: Partial<ArtifactClaim> = {}): ArtifactClaim {
    return { companyId: "synthetic-company", documentId: "synthetic-document", artifactKind: "document",
        contentSha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, ...overrides };
}
async function* stream(parts: unknown[] = [bytes.subarray(0, 4), bytes.subarray(4)]): AsyncIterable<Uint8Array> {
    for (const part of parts) yield part as Uint8Array;
}

describe("LocalArtifactArchive", () => {
    let base: string;
    let root: string;
    let config: { rootPath: string; expectedDevice: number; expectedInode: number; maxBytes: number };
    beforeEach(async () => {
        // /tmp and this host's /workspace have writable ancestors, intentionally unacceptable.
        base = await fs.mkdtemp(`${homedir()}/bjj430-archive-test-`);
        root = `${base}/archive`;
        await fs.mkdir(root, { mode: 0o700 });
        const stat = await fs.lstat(root);
        config = { rootPath: root, expectedDevice: stat.dev, expectedInode: stat.ino, maxBytes: 1024 };
    });
    afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });
    const expectFailure = async (promise: ReturnType<LocalArtifactArchive["archive"]>) => {
        expect(await promise).toEqual({ ok: false, error: "ARCHIVE_FAILED" });
    };
    it("should publish exact multi-chunk bytes under recomputed identity with minimal immutable facts", async () => {
        const input = Object.assign(claim(), { artifactId: "untrusted-id" });
        const result = await new LocalArtifactArchive(config).archive(input, stream());
        expect(result).toEqual({ ok: true, artifactId: artifactIdentity(input), relativeKey: `${artifactIdentity(input)}.bin`,
            contentSha256: input.contentSha256, byteLength: bytes.length, disposition: "created" });
        expect(Object.isFrozen(result)).toBe(true);
        expect(await fs.readFile(`${root}/${artifactIdentity(input)}.bin`)).toEqual(bytes);
        expect((await fs.stat(`${root}/${artifactIdentity(input)}.bin`)).mode & 0o777).toBe(0o600);
        expect(await fs.readdir(root)).toEqual([`${artifactIdentity(input)}.bin`]);
    });
    it("should copy bounded actual bytes without trusting chunk subarray methods", async () => {
        const large = Buffer.alloc(160_000, 0x62);
        Object.defineProperty(large, "subarray", { value: () => Buffer.from("wrong") });
        const input = claim({ byteLength: large.length, contentSha256: createHash("sha256").update(large).digest("hex") });
        const result = await new LocalArtifactArchive({ ...config, maxBytes: large.length }).archive(input, stream([large]));
        expect(result).toMatchObject({ ok: true });
        expect(await fs.readFile(`${root}/${artifactIdentity(input)}.bin`)).toEqual(large);
    });
    it("should archive an empty byte stream when the empty digest and zero count agree", async () => {
        const input = claim({ byteLength: 0, contentSha256: createHash("sha256").digest("hex") });
        expect(await new LocalArtifactArchive({ ...config, maxBytes: 0 }).archive(input, stream([]))).toMatchObject({ ok: true, byteLength: 0 });
        expect((await fs.stat(`${root}/${artifactIdentity(input)}.bin`)).size).toBe(0);
    });
    it("should safely reuse verified bytes on retry and simultaneous attempts", async () => {
        const archive = new LocalArtifactArchive(config);
        const results = await Promise.all(Array.from({ length: 5 }, () => archive.archive(claim(), stream())));
        expect(results.every(result => result.ok)).toBe(true);
        expect(results.filter(result => result.ok && result.disposition === "created")).toHaveLength(1);
        expect(await archive.archive(claim(), stream())).toMatchObject({ ok: true, disposition: "reused" });
        expect(await fs.readdir(root)).toHaveLength(1);
    });
    it("should reject an existing object writable by untrusted users", async () => {
        const final = `${root}/${artifactIdentity(claim())}.bin`;
        await fs.writeFile(final, bytes); await fs.chmod(final, 0o666);
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream()));
        expect(await fs.readFile(final)).toEqual(bytes);
    });
    it("should hash an existing same-length object rather than trusting its name and size", async () => {
        const final = `${root}/${artifactIdentity(claim())}.bin`;
        const corrupt = Buffer.alloc(bytes.length, 0x78);
        await fs.writeFile(final, corrupt);
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream()));
        expect(await fs.readFile(final)).toEqual(corrupt);
    });
    it("should require syncing the verified existing object before returning reused facts", async () => {
        await new LocalArtifactArchive(config).archive(claim(), stream());
        let syncs = 0;
        const archive = new LocalArtifactArchive(config, point => {
            if (point === "file-sync" && ++syncs === 2) throw new Error("existing file sync failed");
        });
        await expectFailure(archive.archive(claim(), stream()));
        expect(syncs).toBe(2);
        expect(await fs.readFile(`${root}/${artifactIdentity(claim())}.bin`)).toEqual(bytes);
    });
    it("should preserve a conflicting existing object and unrelated temporary file", async () => {
        const final = `${root}/${artifactIdentity(claim())}.bin`;
        await fs.writeFile(final, "corrupt");
        await fs.writeFile(`${root}/.archive-other.tmp`, "other");
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream()));
        expect(await fs.readFile(final, "utf8")).toBe("corrupt");
        expect((await fs.readdir(root)).sort()).toEqual([".archive-other.tmp", `${artifactIdentity(claim())}.bin`].sort());
    });
    it.each([
        ["hash mismatch", { contentSha256: "0".repeat(64) }, [bytes]],
        ["short stream", {}, [bytes.subarray(1)]],
        ["excess stream", {}, [bytes, Buffer.from("x")]],
        ["non-byte stream", {}, ["secret payload"]],
    ])("should reject %s without publishing", async (_label, overrides, chunks) => {
        await expectFailure(new LocalArtifactArchive(config).archive(claim(overrides as Partial<ArtifactClaim>), stream(chunks as unknown[])));
        expect(await fs.readdir(root)).toEqual([]);
    });
    it("should stop an oversized stream before requesting later chunks", async () => {
        let later = false;
        async function* excessive() { yield Buffer.alloc(bytes.length + 1); later = true; yield bytes; }
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), excessive()));
        expect(later).toBe(false);
        expect(await fs.readdir(root)).toEqual([]);
    });
    it("should sanitize stream exceptions and clean only its own temporary file", async () => {
        await fs.writeFile(`${root}/.archive-other.tmp`, "other");
        async function* broken() { yield bytes.subarray(0, 2); throw new Error(`${root} raw private payload`); }
        const result = await new LocalArtifactArchive(config).archive(claim(), broken());
        expect(result).toEqual({ ok: false, error: "ARCHIVE_FAILED" });
        expect(JSON.stringify(result)).not.toContain(root);
        expect(Object.isFrozen(result)).toBe(true);
        expect(await fs.readdir(root)).toEqual([".archive-other.tmp"]);
    });
    it("should validate and snapshot the entire plain claim before awaiting", async () => {
        const input = claim();
        const result = new LocalArtifactArchive(config).archive(input, stream());
        input.contentSha256 = "0".repeat(64); input.companyId = "mutated"; input.byteLength = 0;
        expect(await result).toMatchObject({ ok: true, artifactId: artifactIdentity(claim()) });
        let accessed = false;
        const unsafe = Object.defineProperty(claim(), "companyId", { enumerable: true, get() { accessed = true; return "unsafe"; } });
        expect(await new LocalArtifactArchive(config).archive(unsafe, stream())).toEqual({ ok: false, error: "INVALID_INPUT" });
        expect(accessed).toBe(false);
        expect(await new LocalArtifactArchive(config).archive(new Proxy(claim(), {}), stream())).toEqual({ ok: false, error: "INVALID_INPUT" });
    });
    it("should bound configured byte lengths before consuming input", async () => {
        let consumed = false;
        async function* source() { consumed = true; yield bytes; }
        expect(await new LocalArtifactArchive({ ...config, maxBytes: 1 }).archive(claim(), source()))
            .toEqual({ ok: false, error: "INVALID_INPUT" });
        expect(consumed).toBe(false);
    });
    it.each(["missing", "replaced", "device", "inode", "relative", "noncanonical", "writable"])("should fail closed for %s root", async kind => {
        if (kind === "missing") await fs.rmdir(root);
        if (kind === "replaced") { await fs.rename(root, `${base}/original`); await fs.mkdir(root); }
        if (kind === "device") config.expectedDevice++;
        if (kind === "inode") config.expectedInode++;
        if (kind === "relative") config.rootPath = "relative";
        if (kind === "noncanonical") config.rootPath = `${root}/../archive`;
        if (kind === "writable") await fs.chmod(base, 0o777);
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream()));
        if (kind === "missing") await expect(fs.lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
    });
    it.each(["root symlink", "object symlink", "object directory"])("should reject %s without touching its target", async kind => {
        const final = `${root}/${artifactIdentity(claim())}.bin`;
        if (kind === "root symlink") { await fs.rename(root, `${base}/original`); await fs.symlink(`${base}/original`, root); }
        if (kind === "object symlink") { await fs.writeFile(`${base}/target`, bytes); await fs.symlink(`${base}/target`, final); }
        if (kind === "object directory") await fs.mkdir(final);
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream()));
        if (kind === "object symlink") expect(await fs.readFile(`${base}/target`)).toEqual(bytes);
    });
    it.each<ArchiveFaultPoint>(["write", "file-sync", "publish", "directory-sync", "cleanup"])("should return no receipt on %s failure", async point => {
        const archive = new LocalArtifactArchive(config, stage => { if (stage === point) throw new Error("private injected error"); });
        await expectFailure(archive.archive(claim(), stream()));
        const entries = await fs.readdir(root);
        const published = point === "directory-sync" || point === "cleanup";
        expect(entries.includes(`${artifactIdentity(claim())}.bin`)).toBe(published);
        if (published) expect(await new LocalArtifactArchive(config).archive(claim(), stream())).toMatchObject({ ok: true, disposition: "reused" });
        if (point !== "cleanup") expect(entries.filter(entry => entry.endsWith(".tmp"))).toEqual([]);
    });
    it("should reject a root replaced while the stream is in progress", async () => {
        async function* replacement() {
            yield bytes.subarray(0, 2);
            await fs.rename(root, `${base}/original`); await fs.mkdir(root);
            yield bytes.subarray(2);
        }
        await expectFailure(new LocalArtifactArchive(config).archive(claim(), replacement()));
        expect(await fs.readdir(root)).toEqual([]);
        // Fail closed: cannot safely clean an attempt via a now-invalid root path.
        expect((await fs.readdir(`${base}/original`)).every(entry => entry.endsWith(".tmp"))).toBe(true);
    });
    describe("objectName option (BJJ-455)", () => {
        const objectName = () => `${claim().contentSha256}.pdf`;
        it("should publish under the object name and report it as the relative key", async () => {
            const result = await new LocalArtifactArchive(config).archive(claim(), stream(), { objectName: objectName() });
            expect(result).toEqual({ ok: true, artifactId: artifactIdentity(claim()), relativeKey: objectName(),
                contentSha256: claim().contentSha256, byteLength: bytes.length, disposition: "created" });
            expect(await fs.readFile(`${root}/${objectName()}`)).toEqual(bytes);
            expect(await fs.readdir(root)).toEqual([objectName()]);
        });
        it.each([
            ["a short name", "abc.pdf"], ["upper-case hex", `${"A".repeat(64)}.pdf`], ["the default extension", `${"a".repeat(64)}.bin`],
            ["a traversal", `../${"a".repeat(64)}.pdf`], ["a nested path", `a/${"a".repeat(64)}.pdf`], ["a trailing newline", `${"a".repeat(64)}.pdf\n`],
            ["a trailing slash", `${"a".repeat(64)}.pdf/`], ["an empty name", ""], ["a non-string", 5 as unknown as string],
        ])("should reject %s as INVALID_INPUT and write nothing", async (_name, name) => {
            expect(await new LocalArtifactArchive(config).archive(claim(), stream(), { objectName: name }))
                .toEqual({ ok: false, error: "INVALID_INPUT" });
            expect(await fs.readdir(root)).toEqual([]);
        });
        it("should keep the default name when the option object has no objectName", async () => {
            const result = await new LocalArtifactArchive(config).archive(claim(), stream(), {});
            expect(result).toMatchObject({ ok: true, relativeKey: `${artifactIdentity(claim())}.bin` });
        });
        it("should reuse verified bytes under the object name without clobbering", async () => {
            const archive = new LocalArtifactArchive(config);
            await archive.archive(claim(), stream(), { objectName: objectName() });
            expect(await archive.archive(claim(), stream(), { objectName: objectName() })).toMatchObject({ ok: true, disposition: "reused" });
            expect(await fs.readdir(root)).toEqual([objectName()]);
        });
        it("should refuse and keep different bytes already sitting at the object name", async () => {
            const corrupt = Buffer.alloc(bytes.length, 0x78);
            await fs.writeFile(`${root}/${objectName()}`, corrupt);
            await expectFailure(new LocalArtifactArchive(config).archive(claim(), stream(), { objectName: objectName() }));
            expect(await fs.readFile(`${root}/${objectName()}`)).toEqual(corrupt);
        });
    });
});
