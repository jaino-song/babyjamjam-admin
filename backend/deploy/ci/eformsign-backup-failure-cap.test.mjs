// Main-authored test (BJJ-570 Phase 3 fix). Do not edit; if it is wrong, stop and report.
// The API stores only the first 200 failures, and its JSON body limit is 1 MB, so the
// script must POST at most 200 failures while failedFiles keeps the full count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../eformsign-backup/backup.mjs", import.meta.url));
const TOKEN = "cap-token";

test("the result POST carries at most 200 failures and the full failedFiles count", async () => {
    const docs = Array.from({ length: 250 }, (_, i) => ({
        docId: `D${String(i).padStart(3, "0")}`, kind: "contract", customerName: "홍길동",
        serviceStartDate: "2026-11-01", createdAt: "2026-10-20T01:00:00.000Z", serviceRecordChunk: null, files: [],
    }));
    const reports = [];
    const server = createServer((req, res) => {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
        const url = new URL(req.url, "http://x");
        if (req.method === "GET" && url.pathname === "/internal/eformsign-backup/documents") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ items: docs, nextCursor: null }));
            return;
        }
        if (req.method === "POST" && url.pathname === "/internal/eformsign-backup/runs") {
            let raw = "";
            req.on("data", (c) => { raw += c; });
            req.on("end", () => {
                reports.push(JSON.parse(raw));
                res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id: "r" }));
            });
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const dir = await mkdtemp(join(tmpdir(), "bjj-backup-cap-"));
        const rclone = join(dir, "fake-rclone.mjs");
        await writeFile(rclone, "#!/usr/bin/env node\nprocess.exit(0);\n");
        await chmod(rclone, 0o755);
        await writeFile(join(dir, "token"), `${TOKEN}\n`);
        const settings = join(dir, "settings.json");
        await writeFile(settings, JSON.stringify({
            apiBaseUrl: `http://127.0.0.1:${server.address().port}`, tokenFile: join(dir, "token"),
            archiveDir: join(dir, "archive"), stateDir: join(dir, "state"), rcloneRemote: "fake:remote",
            rcloneBin: rclone, qpdfBin: rclone,
        }));
        const code = await new Promise((resolve) => {
            execFile(process.execPath, [SCRIPT, "--settings", settings], (error) => resolve(error ? error.code : 0));
        });
        assert.equal(code, 2);
        assert.equal(reports.length, 1);
        const report = reports[0];
        assert.equal(report.status, "partial");
        assert.equal(report.totalDocs, 250);
        assert.equal(report.failedFiles, 250);
        assert.equal(report.failures.length, 200);
        for (const failure of report.failures) {
            assert.equal(failure.reason, "필수 파일 없음");
            assert.match(failure.docId, /^D\d{3}$/);
        }
        assert.equal(new Set(report.failures.map((f) => f.docId)).size, 200);
    } finally { server.close(); }
});
