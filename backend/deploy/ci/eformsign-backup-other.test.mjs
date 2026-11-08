// Main-authored contract test (BJJ-570 Phase 5, other documents). Do not edit; if it is wrong, stop and report.
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

const other = (docId, title, createdAt, body) => ({ ...makeDoc({ docId, kind: "other", customerName: "김관리", serviceStartDate: null, createdAt, body }), title });

test("other documents go to 기타 under their own name, numbered on a clash", async () => {
    const env = await setup([
        other("O2", "제공인력 계약서_김관리", "2026-05-02T00:00:00.000Z", "O2"),
        other("O1", "제공인력 계약서_김관리", "2026-05-01T00:00:00.000Z", "O1"),
        other("O3", "안내문: 산모님/전자", "2026-05-03T00:00:00.000Z", "O3"),
        other("O4", null, "2026-05-04T00:00:00.000Z", "O4"),
    ]);
    try {
        assert.equal(await env.run(), 0);
        const base = join(env.archive, "기타");
        assert.equal(await readFile(join(base, "제공인력 계약서_김관리.pdf"), "utf8"), "O1:document");
        assert.equal(await readFile(join(base, "감사추적", "제공인력 계약서_김관리.pdf"), "utf8"), "O1:audit_trail");
        assert.equal(await readFile(join(base, "제공인력 계약서_김관리 (2).pdf"), "utf8"), "O2:document");
        assert.equal(await readFile(join(base, "안내문_ 산모님_전자.pdf"), "utf8"), "O3:document");
        assert.equal(await readFile(join(base, "문서명미상.pdf"), "utf8"), "O4:document");
        assert.ok(!(await readdir(env.archive)).includes("서비스계약서"));
        const report = env.state.reports.at(-1);
        assert.equal(report.status, "success");
        assert.equal(report.savedFiles, 8);
    } finally { env.close(); }
});
