import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { restoreFromArchive, type RestoreReport } from "infrastructure/eformsign-backup/worker/restore";

import { pdfjsPageCount } from "./helpers/pdfjs-open";
import {
    COMPANY, archivePdfs, createHarness, destroyHarness, initArchive, listFiles, makeBase, pairDoc, readCompletions, readJsonFile, runOnce, sha256Of,
    singleDoc, treeSignature, type Harness,
} from "./helpers/runner-support";

/** M1: D001, D002 (pairs) and D004 (one artifact). M2 changes D001's metadata and adds D003. */
const m1 = () => [pairDoc("D001"), pairDoc("D002"), singleDoc("D004")];
const m2 = () => [pairDoc("D001", "D001", { documentKind: "contract-v2" }), pairDoc("D002"), pairDoc("D003"), singleDoc("D004")];

describe("T-WRK-12: restore from the archive alone (V13, T25)", () => {
    let h: Harness;
    let out: string;
    let outBase: string;
    afterEach(async () => {
        await destroyHarness(h);
        if (outBase) await fs.rm(outBase, { recursive: true, force: true });
    });

    async function freshOut(): Promise<string> {
        outBase = await makeBase("bjj455-restore-out-");
        out = path.join(outBase, "restored");
        await fs.mkdir(out, { mode: 0o700 });
        return out;
    }
    const restore = (selector: { latest: true } | { snapshotId: string }, extra: { allowIncomplete?: boolean } = {}, dir?: string): Promise<RestoreReport> =>
        restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector, outDir: dir ?? out, ...extra });

    async function twoSnapshots(): Promise<{ s1: string; s2: string }> {
        h = await createHarness({ docs: m1() });
        await initArchive(h);
        await runOnce(h);
        h.api.docs = m2();
        await runOnce(h);
        const completions = await readCompletions(h.archive);
        return { s1: completions[0]!.value["snapshotId"], s2: completions[1]!.value["snapshotId"] };
    }

    it("should restore snapshot M1 exactly and --latest = M2 after the control directory, the ledger and the database are gone", async () => {
        const { s1, s2 } = await twoSnapshots();
        await fs.rm(h.control, { recursive: true, force: true });
        await freshOut();

        const first = await restore({ snapshotId: s1 });

        expect(first).toMatchObject({ status: "unverified-archive", companyId: COMPANY, snapshotId: s1, sequence: 1 });
        expect(first.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002", "D004"]);
        const byId = Object.fromEntries(first.documents.map((doc) => [doc.documentId, doc]));
        expect(byId["D001"]!.consistency).toBe("unverified");
        expect(byId["D004"]!.consistency).toBe("incomplete");
        expect(byId["D004"]!.artifacts.map((artifact) => artifact.artifactType)).toEqual(["document"]);
        expect((await listFiles(out)).sort()).toEqual([
            "D001/audit-trail.pdf", "D001/document.pdf", "D002/audit-trail.pdf", "D002/document.pdf", "D004/document.pdf", "restore-report.json",
        ]);
        const m1D001 = await fs.readFile(path.join(out, "D001", "document.pdf"));
        expect(sha256Of(m1D001)).toBe(byId["D001"]!.artifacts.find((artifact) => artifact.artifactType === "document")!.sha256);
        for (const file of (await listFiles(out)).filter((name) => name.endsWith(".pdf"))) {
            expect(await pdfjsPageCount(path.join(out, file))).toBeGreaterThanOrEqual(1);
        }
        expect(await readJsonFile(path.join(out, "restore-report.json"))).toMatchObject({ status: "unverified-archive", sequence: 1 });

        const latestOut = path.join(outBase, "latest");
        await fs.mkdir(latestOut, { mode: 0o700 });
        const latest = await restore({ latest: true }, {}, latestOut);

        expect(latest).toMatchObject({ status: "unverified-archive", snapshotId: s2, sequence: 2 });
        expect(latest.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002", "D003", "D004"]);
        const latestD001 = latest.documents.find((doc) => doc.documentId === "D001")!;
        expect(latestD001.metadataRevision).not.toBe(byId["D001"]!.metadataRevision);
        for (const file of (await listFiles(latestOut)).filter((name) => name.endsWith(".pdf"))) {
            expect(await pdfjsPageCount(path.join(latestOut, file))).toBeGreaterThanOrEqual(1);
        }
    }, 120_000);

    it("should ignore a bogus latest.json and backwards file times: the sequence in the completion name decides", async () => {
        const { s2 } = await twoSnapshots();
        await freshOut();
        for (const bogus of [path.join(h.archive, "latest.json"), path.join(h.archive, "eformsign", COMPANY, "latest.json")]) {
            await fs.writeFile(bogus, JSON.stringify({ sequence: 1, snapshotId: "00000000-0000-4000-8000-000000000000" }));
        }
        const completions = await readCompletions(h.archive);
        const past = new Date("2001-01-01T00:00:00Z");
        const future = new Date("2040-01-01T00:00:00Z");
        const dir = path.join(h.archive, "eformsign", COMPANY, "completions");
        await fs.utimes(path.join(dir, completions[1]!.name), past, past);
        await fs.utimes(path.join(dir, completions[0]!.name), future, future);

        const report = await restore({ latest: true });

        expect(report).toMatchObject({ snapshotId: s2, sequence: 2 });
    });

    it("should refuse with restore-conflict (exit 65 class) and write nothing when two different completions share a sequence", async () => {
        await twoSnapshots();
        const completions = await readCompletions(h.archive);
        const rival = { ...completions[1]!.value, snapshotId: "rival-snapshot", runId: "00000000-0000-4000-8000-0000000000aa" };
        const { completionContentDigest } = await import("domain/eformsign-backup/worker");
        const digest = completionContentDigest(rival as never);
        await fs.writeFile(path.join(h.archive, "eformsign", COMPANY, "completions", `000000000002-${digest}.json`), JSON.stringify(rival));
        await freshOut();
        const before = await treeSignature(h.archive);

        await expect(restore({ latest: true })).rejects.toMatchObject({ reasonCode: "restore-conflict" });

        expect(await listFiles(out)).toEqual([]);
        expect(await treeSignature(h.archive)).toBe(before);
    });

    it("should quarantine a completion whose name and content disagree and still restore from the valid ones", async () => {
        await twoSnapshots();
        await fs.writeFile(path.join(h.archive, "eformsign", COMPANY, "completions", `000000000009-${"b".repeat(64)}.json`), "{\"not\":\"a completion\"}");
        await freshOut();
        const report = await restore({ latest: true });
        expect(report.sequence).toBe(2);
        expect(report.quarantined).toEqual([{ name: `000000000009-${"b".repeat(64)}.json`, reason: "content-invalid" }]);
    });

    it("should write nothing when an artifact in the archive was tampered with, a manifest changed, or a file is missing", async () => {
        const { s1 } = await twoSnapshots();
        const pdfs = await archivePdfs(h.archive);
        const target = path.join(h.archive, pdfs.find((file) => file.includes("/D004/"))!);
        const original = await fs.readFile(target);
        await freshOut();

        const flipped = Buffer.from(original);
        flipped[20] = flipped[20]! ^ 0xff;
        await fs.writeFile(target, flipped);
        await expect(restore({ snapshotId: s1 })).rejects.toMatchObject({ reasonCode: "artifact-integrity" });
        expect(await listFiles(out)).toEqual([]);

        await fs.writeFile(target, original);
        await fs.rename(target, `${target}.away`);
        await expect(restore({ snapshotId: s1 })).rejects.toBeInstanceOf(WorkerError);
        expect(await listFiles(out)).toEqual([]);
        await fs.rename(`${target}.away`, target);

        const manifest = (await listFiles(h.archive)).find((file) => file.includes("/D002/manifests/"))!;
        const manifestPath = path.join(h.archive, manifest);
        const manifestBytes = await fs.readFile(manifestPath);
        await fs.writeFile(manifestPath, Buffer.concat([manifestBytes, Buffer.from(" ")]));
        await expect(restore({ snapshotId: s1 })).rejects.toBeInstanceOf(WorkerError);
        expect(await listFiles(out)).toEqual([]);
        await fs.writeFile(manifestPath, manifestBytes);

        const ok = await restore({ snapshotId: s1 });
        expect(ok.status).toBe("unverified-archive");
    });

    it("should refuse an unknown snapshot and, without --allow-incomplete, an archive that has no completion", async () => {
        await twoSnapshots();
        await freshOut();
        await expect(restore({ snapshotId: "no-such-snapshot" })).rejects.toBeInstanceOf(WorkerError);
        expect(await listFiles(out)).toEqual([]);

        const dir = path.join(h.archive, "eformsign", COMPANY, "completions");
        for (const name of await fs.readdir(dir)) await fs.rename(path.join(dir, name), path.join(h.base, `${name}.away`));
        await expect(restore({ latest: true })).rejects.toBeInstanceOf(WorkerError);
        expect(await listFiles(out)).toEqual([]);
    });

    it("should restore by manifest as incomplete-archive when there is no completion and --allow-incomplete is given", async () => {
        h = await createHarness({ docs: m1() });
        await initArchive(h);
        await runOnce(h);
        const dir = path.join(h.archive, "eformsign", COMPANY, "completions");
        for (const name of await fs.readdir(dir)) await fs.rename(path.join(dir, name), path.join(h.base, `${name}.away`));
        await freshOut();

        const report = await restore({ latest: true }, { allowIncomplete: true });

        expect(report).toMatchObject({ status: "incomplete-archive", snapshotId: null, sequence: null });
        expect(report.documents.map((doc) => doc.documentId)).toEqual(["D001", "D002", "D004"]);
        expect(report.documents.find((doc) => doc.documentId === "D004")!.consistency).toBe("incomplete");
        for (const file of (await listFiles(out)).filter((name) => name.endsWith(".pdf"))) {
            expect(await pdfjsPageCount(path.join(out, file))).toBeGreaterThanOrEqual(1);
        }
    }, 120_000);

    it("should never report a complete archive, and report gaps from the completion", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        h.api.addFault({ route: "artifact", times: 99, match: (info) => info.documentId === "D001" && info.fileType === "audit_trail", fault: { kind: "status", status: 410, code: "SOURCE_REMOVED" } });
        await initArchive(h);
        await runOnce(h);
        await freshOut();
        const report = await restore({ latest: true });
        expect(report.status).toBe("unverified-archive");
        expect(report.gaps).toEqual([{ documentId: "D001", reasonCode: "source-removed" }]);
        expect(report.documents.map((doc) => doc.documentId)).toEqual(["D002"]);
        expect(JSON.stringify(report)).not.toContain("\"complete\"");
        const text = await fs.readFile(path.join(out, "restore-report.json"), "utf8");
        expect(text).not.toContain("\"complete\"");
    });

    describe("output directory", () => {
        beforeEach(async () => {
            h = await createHarness({ docs: m1() });
            await initArchive(h);
            await runOnce(h);
            await freshOut();
        });

        it.each([
            ["a relative path", () => "restored"],
            ["a directory that already holds a file", async () => { await fs.writeFile(path.join(out, "keep.txt"), "x"); return out; }],
            ["the archive itself", () => h.archive],
            ["a directory inside the archive", async () => { const inside = path.join(h.archive, "restored"); await fs.mkdir(inside, { mode: 0o700 }); return inside; }],
            ["a parent of the archive", () => h.base],
            ["a symlink", async () => { const link = path.join(outBase, "link"); await fs.symlink(out, link); return link; }],
            ["a path with ..", () => `${out}/../restored`],
        ])("should refuse %s with restore-output-invalid and write nothing", async (_name, pick) => {
            const dir = await pick();
            const before = await treeSignature(h.archive);
            await expect(restore({ latest: true }, {}, dir)).rejects.toMatchObject({ reasonCode: "restore-output-invalid" });
            expect(await treeSignature(h.archive)).toBe(before);
            expect((await listFiles(out)).filter((file) => file !== "keep.txt")).toEqual([]);
        });
    });
});
