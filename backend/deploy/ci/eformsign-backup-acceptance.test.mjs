// Main-authored acceptance test (BJJ-570 Phase 3, contract §4-§5). Do not edit;
// if it is wrong, stop and report. The worker's own full test lives beside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../eformsign-backup/backup.mjs", import.meta.url));
const TOKEN = "acceptance-token";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

function makeDoc({ docId, kind, customerName, serviceStartDate, createdAt, chunk = null, body }) {
    const files = ["document", "audit_trail"].map((fileType) => {
        const content = Buffer.from(`${body}:${fileType}`);
        return { fileId: `${docId}-${fileType}`, fileType, sha256: sha(content), byteSize: content.length, content };
    });
    return { docId, kind, customerName, serviceStartDate, createdAt, serviceRecordChunk: chunk, files };
}

async function startApi(state) {
    const server = createServer((req, res) => {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
        const url = new URL(req.url, "http://x");
        if (req.method === "GET" && url.pathname === "/internal/eformsign-backup/documents") {
            const items = state.docs.map((doc) => ({
                ...doc,
                files: doc.files.map((f) => ({ fileId: f.fileId, fileType: f.fileType, sha256: f.sha256, byteSize: f.byteSize })),
            }));
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ items, nextCursor: null }));
            return;
        }
        const fileMatch = url.pathname.match(/^\/internal\/eformsign-backup\/files\/(.+)$/);
        if (req.method === "GET" && fileMatch) {
            state.fileRequests += 1;
            const file = state.docs.flatMap((d) => d.files).find((f) => f.fileId === decodeURIComponent(fileMatch[1]));
            if (!file) { res.writeHead(404).end(); return; }
            res.writeHead(200, { "content-type": "application/pdf", "x-content-sha256": file.sha256 });
            res.end(file.content);
            return;
        }
        if (req.method === "POST" && url.pathname === "/internal/eformsign-backup/runs") {
            let raw = "";
            req.on("data", (c) => { raw += c; });
            req.on("end", () => {
                state.reports.push(JSON.parse(raw));
                res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id: "r" }));
            });
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function setup(docs) {
    const dir = await mkdtemp(join(tmpdir(), "bjj-backup-acc-"));
    const state = { docs, fileRequests: 0, reports: [] };
    const api = await startApi(state);
    const qpdf = join(dir, "fake-qpdf.mjs");
    await writeFile(qpdf, [
        "#!/usr/bin/env node",
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const a = process.argv.slice(2); const i = a.indexOf('--pages'); const j = a.indexOf('--');",
        "writeFileSync(a[j + 1], Buffer.concat(a.slice(i + 1, j).map((p) => readFileSync(p))));",
    ].join("\n"));
    const rclone = join(dir, "fake-rclone.mjs");
    await writeFile(rclone, "#!/usr/bin/env node\nprocess.exit(0);\n");
    await chmod(qpdf, 0o755);
    await chmod(rclone, 0o755);
    await writeFile(join(dir, "token"), `${TOKEN}\n`);
    const settings = join(dir, "settings.json");
    await writeFile(settings, JSON.stringify({
        apiBaseUrl: api.base, tokenFile: join(dir, "token"), archiveDir: join(dir, "archive"),
        stateDir: join(dir, "state"), rcloneRemote: "fake:remote", rcloneBin: rclone, qpdfBin: qpdf,
    }));
    const run = () => new Promise((resolve) => {
        execFile(process.execPath, [SCRIPT, "--settings", settings], (error) => {
            resolve(error ? error.code : 0);
        });
    });
    return { dir, archive: join(dir, "archive"), state, run, close: () => api.server.close() };
}

const contractA = makeDoc({ docId: "A", kind: "contract", customerName: "홍길동", serviceStartDate: "2026-11-01", createdAt: "2026-10-20T01:00:00.000Z", body: "A" });
const contractB = makeDoc({ docId: "B", kind: "contract", customerName: "홍길동", serviceStartDate: "2026-11-01", createdAt: "2026-10-25T01:00:00.000Z", body: "B" });

test("contract paths, duplicate numbering, mtime and success", async () => {
    // B is listed first but A is older, so A must get the plain name.
    const env = await setup([contractB, contractA]);
    try {
        assert.equal(await env.run(), 0);
        const base = join(env.archive, "서비스계약서");
        assert.equal(await readFile(join(base, "서비스계약서_홍길동_2026-11-01.pdf"), "utf8"), "A:document");
        assert.equal(await readFile(join(base, "감사추적", "서비스계약서_홍길동_2026-11-01.pdf"), "utf8"), "A:audit_trail");
        assert.equal(await readFile(join(base, "서비스계약서_홍길동_2026-11-01 (2).pdf"), "utf8"), "B:document");
        assert.equal(await readFile(join(base, "감사추적", "서비스계약서_홍길동_2026-11-01 (2).pdf"), "utf8"), "B:audit_trail");
        const mtime = (await stat(join(base, "서비스계약서_홍길동_2026-11-01.pdf"))).mtimeMs;
        assert.equal(Math.round(mtime / 1000), Date.parse(contractA.createdAt) / 1000);
        const report = env.state.reports.at(-1);
        assert.equal(report.status, "success");
        assert.equal(report.driveStatus, "ok");
        assert.equal(report.limited, false);
        assert.equal(report.savedFiles, 4);
        assert.equal(report.totalDocs, 2);

        // Second run: nothing downloaded, names unchanged.
        const before = env.state.fileRequests;
        assert.equal(await env.run(), 0);
        assert.equal(env.state.fileRequests, before);
        assert.equal(env.state.reports.at(-1).skippedFiles, 4);
        assert.equal(env.state.reports.at(-1).savedFiles, 0);
    } finally { env.close(); }
});

test("a reissued document keeps the old file and takes the next number", async () => {
    const env = await setup([contractA]);
    try {
        assert.equal(await env.run(), 0);
        env.state.docs = [makeDoc({ ...contractA, body: "A-v2" })];
        assert.equal(await env.run(), 0);
        const base = join(env.archive, "서비스계약서");
        assert.equal(await readFile(join(base, "서비스계약서_홍길동_2026-11-01.pdf"), "utf8"), "A:document");
        assert.equal(await readFile(join(base, "서비스계약서_홍길동_2026-11-01 (2).pdf"), "utf8"), "A-v2:document");
    } finally { env.close(); }
});

test("a multi-chunk service record is merged oldest first and the originals are kept", async () => {
    const chunk = (chunkIndex, firstSessionIndex, createdAt) => makeDoc({
        docId: `S${chunkIndex}`, kind: "service_record", customerName: "김산모", serviceStartDate: "2026-09-01", createdAt,
        chunk: { caseId: "11111111-1111-1111-1111-111111111111", snapshotVersion: 1, chunkIndex, chunkCount: 3, firstSessionIndex },
        body: `S${chunkIndex}`,
    });
    const docs = [chunk(2, 21, "2026-10-03T00:00:00.000Z"), chunk(0, 1, "2026-10-01T00:00:00.000Z"), chunk(1, 11, "2026-10-02T00:00:00.000Z")];

    // Only two of three chunks completed: originals saved, no merged file, not a failure.
    const env = await setup(docs.slice(0, 2));
    try {
        assert.equal(await env.run(), 0);
        const sr = join(env.archive, "제공기록지");
        assert.deepEqual((await readdir(join(sr, "원본"))).filter((n) => n.endsWith(".pdf")).sort(),
            ["제공기록지_김산모_2026-09-01_1장.pdf", "제공기록지_김산모_2026-09-01_3장.pdf"]);
        assert.ok(!(await readdir(sr)).includes("제공기록지_김산모_2026-09-01.pdf"));

        env.state.docs = docs;
        assert.equal(await env.run(), 0);
        assert.equal(await readFile(join(sr, "제공기록지_김산모_2026-09-01.pdf"), "utf8"), "S0:documentS1:documentS2:document");
        assert.equal(await readFile(join(sr, "감사추적", "제공기록지_김산모_2026-09-01.pdf"), "utf8"), "S0:audit_trailS1:audit_trailS2:audit_trail");
        assert.equal(await readFile(join(sr, "원본", "제공기록지_김산모_2026-09-01_2장.pdf"), "utf8"), "S1:document");
        assert.equal(await readFile(join(sr, "원본", "감사추적", "제공기록지_김산모_2026-09-01_3장.pdf"), "utf8"), "S2:audit_trail");
        const mtime = (await stat(join(sr, "제공기록지_김산모_2026-09-01.pdf"))).mtimeMs;
        assert.equal(Math.round(mtime / 1000), Date.parse("2026-10-01T00:00:00.000Z") / 1000);
        assert.equal(env.state.reports.at(-1).status, "success");
    } finally { env.close(); }
});
