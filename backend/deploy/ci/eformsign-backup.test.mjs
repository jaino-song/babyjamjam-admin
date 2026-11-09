import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, chmod, readdir, rm, mkdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../eformsign-backup/backup.mjs', import.meta.url));
const token = 'local-test-token';
const sha = (body) => createHash('sha256').update(body).digest('hex');
const base = '서비스계약서_홍길동_2026-11-01';
const srBase = '제공기록지_홍길동_2026-11-01';
function document(id, overrides = {}) {
    const doc = { docId: id, kind: 'contract', customerName: '홍길동', serviceStartDate: '2026-11-01',
        createdAt: `2026-10-${String(Number(id) || 1).padStart(2, '0')}T01:00:00.000Z`, serviceRecordChunk: null, ...overrides };
    doc.files ??= ['document', 'audit_trail'].map((fileType) => {
        const content = Buffer.from(`${id}:${fileType}`);
        return { fileId: `${id}-${fileType}`, fileType, content, sha256: sha(content), byteSize: content.length };
    });
    return doc;
}
function chunks() {
    return [2, 0, 1].map((i) => document(String(i + 1), { kind: 'service_record',
        serviceRecordChunk: { caseId: 'case-1', snapshotVersion: 1, chunkIndex: i, chunkCount: 3, firstSessionIndex: i * 10 + 1 } }));
}
const key = (doc) => `doc:${doc.docId}`;
const fingerprint = (doc) => ['document', 'audit_trail'].map((type) => doc.files.find((file) => file.fileType === type)?.sha256 ?? '').join(':');
// Replace a document's files in place (same fileIds, new content); a null body removes that file.
function setFiles(doc, bodies) {
    doc.files = Object.entries(bodies).filter(([, body]) => body !== null).map(([fileType, body]) => {
        const content = Buffer.from(body);
        return { fileId: `${doc.docId}-${fileType}`, fileType, content, sha256: sha(content), byteSize: content.length };
    });
    return doc;
}
const reviewDoc = (id, overrides = {}) => setFiles(document(id, { completed: false, ...overrides }), { document: `${id}:review`, audit_trail: null });
async function tree(root, prefix = '') {
    const result = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
        const path = join(prefix, entry.name);
        if (entry.isDirectory()) result.push(...await tree(root, path)); else result.push(path);
    }
    return result.sort();
}
async function setup(t, docs) {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'bjj-backup-unit-')));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const api = { docs, reports: [], fileRequests: [], listRequests: [], postStatus: 201, pageSize: 200,
        listFailure: null, fileFailure: null, hang: null, postRequests: 0 };
    const server = createServer((req, res) => {
        assert.equal(req.headers.authorization, `Bearer ${token}`);
        const url = new URL(req.url, 'http://local');
        if (req.method === 'GET' && url.pathname === '/internal/eformsign-backup/documents') {
            api.listRequests.push(url.search);
            const offset = Number(url.searchParams.get('cursor') || 0);
            if (api.listFailure === offset) { res.writeHead(500).end(); return; }
            assert.equal(url.searchParams.get('limit'), '200');
            const items = api.docs.slice(offset, offset + api.pageSize).map((doc) => ({ ...doc,
                files: doc.files.map(({ fileId, fileType, byteSize, sha256 }) => ({ fileId, fileType, byteSize, sha256 })) }));
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items,
                nextCursor: offset + api.pageSize < api.docs.length ? offset + api.pageSize : null }));
        } else if (req.method === 'GET' && url.pathname.startsWith('/internal/eformsign-backup/files/')) {
            const id = decodeURIComponent(url.pathname.split('/').at(-1));
            api.fileRequests.push(id);
            if (api.hang === id) return;
            if (api.fileFailure === id) { res.writeHead(404).end(); return; }
            const file = api.docs.flatMap((doc) => doc.files).find((file) => file.fileId === id);
            if (!file) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'content-type': 'application/pdf', 'x-content-sha256': file.sha256,
                'content-length': file.content.length }).end(file.content);
        } else if (req.method === 'POST' && url.pathname === '/internal/eformsign-backup/runs') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                api.postRequests += 1;
                api.reports.push(JSON.parse(body));
                res.writeHead(api.postStatus, { 'content-type': 'application/json' }).end('{"id":"run"}');
            });
        } else { res.writeHead(404).end(); }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
    });
    const qpdf = join(dir, 'qpdf.mjs');
    const rclone = join(dir, 'rclone.mjs');
    const qpdfLog = join(dir, 'qpdf-argv.json');
    const rcloneLog = join(dir, 'rclone-argv.json');
    const rcloneExit = join(dir, 'rclone-exit');
    await writeFile(qpdf, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const a = process.argv.slice(2), log = ${JSON.stringify(qpdfLog)};
const calls = existsSync(log) ? JSON.parse(readFileSync(log)) : [];
calls.push(a); writeFileSync(log, JSON.stringify(calls));
const i = a.indexOf('--pages'), j = a.indexOf('--');
writeFileSync(a[j + 1], Buffer.concat(a.slice(i + 1, j).map(p => readFileSync(p))));
`);
    await writeFile(rclone, `#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(rcloneLog)}, JSON.stringify(process.argv.slice(2)));
process.exit(Number(readFileSync(${JSON.stringify(rcloneExit)}, 'utf8')));
`);
    await Promise.all([chmod(qpdf, 0o755), chmod(rclone, 0o755), writeFile(rcloneExit, '0'), writeFile(join(dir, 'token'), `  ${token}\n`)]);
    const settingsPath = join(dir, 'settings.json');
    const settings = { apiBaseUrl: `http://127.0.0.1:${server.address().port}`, tokenFile: join(dir, 'token'),
        archiveDir: join(dir, 'archive'), stateDir: join(dir, 'state'), rcloneRemote: 'fake:archive', rcloneBin: rclone, qpdfBin: qpdf };
    const run = async (args = [], env = {}) => {
        await writeFile(settingsPath, JSON.stringify(settings));
        const result = await new Promise((done) => execFile(process.execPath, [script, '--settings', settingsPath, ...args],
            { env: { ...process.env, ...env }, timeout: 10000 }, (error, stdout, stderr) => done({ code: error?.code ?? 0, stdout, stderr })));
        assert.equal(result.stderr, '');
        assert.ok(!result.stdout.includes(token), 'token is never logged');
        return result;
    };
    return { ...settings, dir, api, settings, run, qpdfLog, rcloneLog, rcloneExit,
        state: async () => JSON.parse(await readFile(join(settings.stateDir, 'state.json'), 'utf8')),
        files: () => tree(settings.archiveDir), bytes: (path) => readFile(join(settings.archiveDir, path), 'utf8') };
}
async function assertReport(env, expected) {
    const body = env.api.reports.at(-1);
    assert.deepEqual(Object.keys(body).sort(), ['startedAt', 'finishedAt', 'status', 'limited', 'totalDocs', 'savedFiles',
        'skippedFiles', 'failedFiles', 'driveStatus', 'failures'].sort());
    assert.ok(Date.parse(body.finishedAt) >= Date.parse(body.startedAt));
    for (const [field, value] of Object.entries(expected)) assert.deepEqual(body[field], value, field);
    const state = await env.state();
    assert.equal(state.version, 2);
    for (const unit of Object.values(state.units)) {
        assert.equal(Object.keys(unit.files).length, 2);
        assert.equal(typeof unit.fingerprint, 'string');
        assert.equal(typeof unit.completed, 'boolean');
        for (const [path, bytes] of Object.entries(unit.files)) {
            if (bytes === null) continue;
            try { assert.equal((await stat(join(env.archiveDir, path))).size, bytes); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    assert.ok(!(await env.files()).some((path) => path.endsWith('.tmp')));
    assert.ok(!(await tree(env.stateDir)).some((path) => path.endsWith('.tmp')));
}

test('1. two contracts and single record: exact paths, times, state, Drive argv', async (t) => {
    const docs = [document('1'), document('2', { customerName: '김산모' }), document('3', { kind: 'service_record' })];
    const env = await setup(t, docs);
    env.api.pageSize = 1;
    assert.equal((await env.run()).code, 0);
    const expected = [`서비스계약서/${base}.pdf`, `서비스계약서/감사추적/[감사추적]_${base}.pdf`,
        '서비스계약서/서비스계약서_김산모_2026-11-01.pdf', '서비스계약서/감사추적/[감사추적]_서비스계약서_김산모_2026-11-01.pdf',
        `제공기록지/${srBase}.pdf`, `제공기록지/감사추적/[감사추적]_${srBase}.pdf`];
    await assert.rejects(env.bytes(`서비스계약서/감사추적/${base}.pdf`), { code: 'ENOENT' });
    assert.deepEqual(await env.files(), expected.sort());
    const state = await env.state();
    for (const doc of docs) {
        const paths = Object.keys(state.units[key(doc)].files);
        for (let i = 0; i < 2; i += 1) {
            const info = await stat(join(env.archiveDir, paths[i]));
            assert.equal(info.mtimeMs, Date.parse(doc.createdAt));
            assert.equal(info.atimeMs, Date.parse(doc.createdAt));
            assert.equal(await env.bytes(paths[i]), doc.files[i].content.toString());
        }
    }
    assert.equal(env.api.listRequests.length, 3);
    await assertReport(env, { status: 'success', driveStatus: 'ok', totalDocs: 3, savedFiles: 6, skippedFiles: 0, failedFiles: 0, limited: false, failures: [] });
    assert.deepEqual(JSON.parse(await readFile(env.rcloneLog, 'utf8')), ['copy', '--checksum', env.archiveDir, 'fake:archive']);
});

test('2. second run skips all six files without any file request', async (t) => {
    const env = await setup(t, [document('1'), document('2'), document('3', { kind: 'service_record' })]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    const disk = await env.files();
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, []);
    assert.deepEqual(await env.state(), before);
    assert.deepEqual(await env.files(), disk);
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 6 });
});

test('3. naming uses createdAt, keeps names on run two, a changed completed document takes (3) and archives its old entry', async (t) => {
    const early = document('1');
    const late = document('2');
    const env = await setup(t, [late, early]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    const originals = await Promise.all((await env.files()).map(async (path) => [path, await env.bytes(path)]));
    assert.equal((await env.run()).code, 0);
    const oldFingerprint = fingerprint(early);
    setFiles(early, { document: 'reissued', audit_trail: '1:audit_trail' });
    assert.equal((await env.run()).code, 0);
    for (const [path, content] of originals) assert.equal(await env.bytes(path), content);
    for (const [suffix, content] of [['', '1:document'], [' (2)', '2:document'], [' (3)', 'reissued']]) {
        assert.equal(await env.bytes(`서비스계약서/${base}${suffix}.pdf`), content);
        assert.equal(await env.bytes(auditPath(suffix)), suffix === ' (2)' ? '2:audit_trail' : '1:audit_trail');
    }
    const after = await env.state();
    assert.deepEqual(after.units[`doc:1@${oldFingerprint}`], before.units[key(early)]);
    assert.deepEqual(after.units[key(late)], before.units[key(late)]);
    assert.equal(after.units[key(early)].fingerprint, fingerprint(early));
    assert.ok(Object.keys(after.units[key(early)].files).every((path) => path.includes(' (3)')));
    assert.equal(Object.keys(after.units).length, 3);
    await assertReport(env, { status: 'success', savedFiles: 2, skippedFiles: 2 });
});

test('4. malicious customer names are sanitized and confined to the archive', async (t) => {
    const env = await setup(t, [document('1', { customerName: '../../evil' }), document('2', { customerName: '/:*?"<>|' })]);
    assert.equal((await env.run()).code, 0);
    const paths = await env.files();
    assert.equal(paths.length, 4);
    assert.ok(paths.some((path) => path.endsWith('서비스계약서__.._evil_2026-11-01.pdf')));
    assert.ok(paths.some((path) => path.endsWith('서비스계약서__________2026-11-01.pdf')));
    for (const path of paths) assert.ok(!relative(env.archiveDir, join(env.archiveDir, path)).startsWith('..'));
    assert.deepEqual((await readdir(env.dir)).filter((name) => name.includes('evil')), []);
    await assertReport(env, { status: 'success', savedFiles: 4, failedFiles: 0 });
});

test('5. sha256 mismatch removes temporary file and continues to the next document', async (t) => {
    const bad = document('1');
    bad.files[0].sha256 = '0'.repeat(64);
    const good = document('2');
    const env = await setup(t, [bad, good]);
    assert.equal((await env.run()).code, 2);
    assert.equal((await env.files()).length, 2);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), '2:document');
    assert.ok(!Object.hasOwn((await env.state()).units, key(bad)));
    assert.equal(env.api.reports.at(-1).failures[0].docId, '1');
    assert.match(env.api.reports.at(-1).failures[0].reason, /sha256/);
    await assertReport(env, { status: 'partial', savedFiles: 2, failedFiles: 1 });
});

test('6. missing required audit saves nothing and reports the exact reason', async (t) => {
    const bad = document('1');
    bad.files.pop();
    const env = await setup(t, [bad]);
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(await env.files(), []);
    assert.deepEqual((await env.state()).units, {});
    await assertReport(env, { status: 'partial', savedFiles: 0, failedFiles: 1, failures: [{ docId: '1', reason: '필수 파일 없음' }] });
});

async function assertMerge(env, docs) {
    const ordered = [...docs].sort((a, b) => a.serviceRecordChunk.firstSessionIndex - b.serviceRecordChunk.firstSessionIndex);
    for (const [i, type] of ['document', 'audit_trail'].entries()) {
        const path = `제공기록지/${i ? '감사추적/[감사추적]_' : ''}${srBase}.pdf`;
        const info = await stat(join(env.archiveDir, path));
        assert.equal(info.mtimeMs, Date.parse(ordered[0].createdAt));
        assert.equal(info.atimeMs, Date.parse(ordered[0].createdAt));
        assert.equal(await env.bytes(path), ordered.map((doc) => doc.files[i].content.toString()).join(''));
        for (const doc of docs) {
            assert.equal(await env.bytes(`제공기록지/원본/${i ? '감사추적/[감사추적]_' : ''}${srBase}_${doc.serviceRecordChunk.chunkIndex + 1}장.pdf`), doc.files[i].content.toString());
        }
        const args = JSON.parse(await readFile(env.qpdfLog, 'utf8'))[i];
        assert.deepEqual(args.slice(0, 2), ['--empty', '--pages']);
        assert.deepEqual(args.slice(2, -2), ordered.map((doc) => join(env.archiveDir,
            `제공기록지/원본/${type === 'audit_trail' ? '감사추적/[감사추적]_' : ''}${srBase}_${doc.serviceRecordChunk.chunkIndex + 1}장.pdf`)));
        assert.equal(args.at(-2), '--');
    }
    const state = await env.state();
    const chunk = ordered[0].serviceRecordChunk;
    const mergedKey = `merged:${chunk.caseId}:${chunk.snapshotVersion}`;
    assert.deepEqual(state.units[mergedKey], { files: Object.fromEntries(['', '감사추적/[감사추적]_'].map((folder, i) =>
        [`제공기록지/${folder}${srBase}.pdf`, docs.reduce((bytes, doc) => bytes + doc.files[i].byteSize, 0)])),
        fingerprint: ordered.map(fingerprint).join(','), completed: true });
    assert.equal(Object.keys(state.units).length, 4);
}

test('7. three chunks merge in firstSessionIndex order and preserve signed originals', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    assert.equal((await env.files()).length, 8);
    await assertMerge(env, docs);
    await assertReport(env, { status: 'success', savedFiles: 8, failedFiles: 0 });
});

test('merge order and file times follow firstSessionIndex when chunkIndex and createdAt orders differ', async (t) => {
    // Listing: 2,0,1; chunkIndex: 0,1,2; createdAt: 0,2,1; firstSessionIndex: 1,2,0.
    // The first session belongs to the latest-created chunk, not chunkIndex 0.
    const docs = [
        { id: '3', chunkIndex: 2, firstSessionIndex: 11, createdAt: '2026-10-02T01:00:00.000Z' },
        { id: '1', chunkIndex: 0, firstSessionIndex: 21, createdAt: '2026-10-01T01:00:00.000Z' },
        { id: '2', chunkIndex: 1, firstSessionIndex: 1, createdAt: '2026-10-03T01:00:00.000Z' },
    ].map(({ id, chunkIndex, firstSessionIndex, createdAt }) => document(id, { kind: 'service_record', createdAt,
        serviceRecordChunk: { caseId: 'case-1', snapshotVersion: 1, chunkIndex, chunkCount: 3, firstSessionIndex } }));
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    assert.equal((await env.files()).length, 8);
    await assertMerge(env, docs);
    await assertReport(env, { status: 'success', driveStatus: 'ok', totalDocs: 3, savedFiles: 8, skippedFiles: 0,
        failedFiles: 0, limited: false, failures: [] });
});

test('8. incomplete group is successful, merges when the third chunk appears', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs.slice(0, 2));
    assert.equal((await env.run()).code, 0);
    assert.equal((await env.files()).length, 4);
    assert.equal(Object.keys((await env.state()).units).length, 2);
    await assert.rejects(readFile(env.qpdfLog), { code: 'ENOENT' });
    await assertReport(env, { status: 'success', savedFiles: 4, failedFiles: 0 });
    env.api.docs = docs;
    assert.equal((await env.run()).code, 0);
    await assertMerge(env, docs);
    await assertReport(env, { status: 'success', savedFiles: 4, skippedFiles: 4, failedFiles: 0 });
});

test('9. --limit 1 processes just one document and reports limited true', async (t) => {
    const env = await setup(t, [document('1'), document('2')]);
    assert.equal((await env.run(['--limit', '1'])).code, 0);
    assert.equal(env.api.fileRequests.length, 2);
    assert.equal((await env.files()).length, 2);
    assert.equal(Object.keys((await env.state()).units).length, 1);
    await assertReport(env, { status: 'success', limited: true, totalDocs: 1, savedFiles: 2 });
});

test('10. rclone failure and omitted remote both produce partial and exit 2', async (t) => {
    const env = await setup(t, [document('1')]);
    await writeFile(env.rcloneExit, '1');
    assert.equal((await env.run()).code, 2);
    assert.equal((await env.files()).length, 2);
    await assertReport(env, { status: 'partial', driveStatus: 'failed', savedFiles: 2 });
    await rm(env.rcloneLog);
    delete env.settings.rcloneRemote;
    assert.equal((await env.run()).code, 2);
    await assert.rejects(readFile(env.rcloneLog), { code: 'ENOENT' });
    await assertReport(env, { status: 'partial', driveStatus: 'skipped', savedFiles: 0, skippedFiles: 2 });
});

test('11. listing page two HTTP 500 stops listing but posts failed result', async (t) => {
    const env = await setup(t, [document('1'), document('2'), document('3')]);
    env.api.pageSize = 1;
    env.api.listFailure = 1;
    assert.equal((await env.run()).code, 1);
    assert.equal(env.api.listRequests.length, 2);
    assert.equal((await env.files()).length, 2);
    assert.equal(Object.keys((await env.state()).units).length, 1);
    await assertReport(env, { status: 'failed', totalDocs: 1, savedFiles: 2 });
});

test('12. result POST failure retries once then overrides exit code to 3', async (t) => {
    const env = await setup(t, [document('1')]);
    env.api.postStatus = 500;
    assert.equal((await env.run()).code, 3);
    assert.equal(env.api.postRequests, 2);
    assert.deepEqual(env.api.reports[0], env.api.reports[1]);
    assert.equal((await env.files()).length, 2);
    await assertReport(env, { status: 'success', savedFiles: 2 });
});

test('13. timed out file records failure and continues', async (t) => {
    const env = await setup(t, [document('1'), document('2')]);
    env.api.hang = '1-document';
    assert.equal((await env.run([], { EFORMSIGN_BACKUP_TIMEOUT_MS: '200' })).code, 2);
    assert.equal((await env.files()).length, 2);
    assert.equal(Object.keys((await env.state()).units).length, 1);
    assert.equal(env.api.reports.at(-1).failures[0].docId, '1');
    assert.match(env.api.reports.at(-1).failures[0].reason, /timeout/i);
    await assertReport(env, { status: 'partial', savedFiles: 2, failedFiles: 1 });
});

test('14. insecure remote URL, unknown key, missing setting and blank token fail before requests', async (t) => {
    const env = await setup(t, [document('1')]);
    const localUrl = env.settings.apiBaseUrl;
    env.settings.apiBaseUrl = 'http://example.com';
    assert.equal((await env.run()).code, 1);
    env.settings.apiBaseUrl = localUrl;
    env.settings.unknown = true;
    assert.equal((await env.run()).code, 1);
    delete env.settings.unknown;
    delete env.settings.archiveDir;
    assert.equal((await env.run()).code, 1);
    env.settings.archiveDir = env.archiveDir;
    await writeFile(env.settings.tokenFile, ' \n');
    assert.equal((await env.run()).code, 1);
    assert.deepEqual(env.api.listRequests, []);
    assert.deepEqual(env.api.fileRequests, []);
    assert.deepEqual(env.api.reports, []);
    await assert.rejects(stat(env.archiveDir), { code: 'ENOENT' });
    await assert.rejects(env.state(), { code: 'ENOENT' });
});

test('missing recorded files recover at the same paths; wrong size never overwrites', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    const path = `서비스계약서/${base}.pdf`;
    await rm(join(env.archiveDir, path));
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, ['1-document']);
    assert.deepEqual(await env.state(), before);
    await assertReport(env, { status: 'success', savedFiles: 1, skippedFiles: 0 });
    await writeFile(join(env.archiveDir, path), 'wrong size existing content');
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 2);
    assert.equal(await env.bytes(path), 'wrong size existing content');
    assert.deepEqual(env.api.fileRequests, []);
    assert.deepEqual(await env.state(), before);
    assert.equal(env.api.reports.at(-1).status, 'partial');
    assert.equal(env.api.reports.at(-1).failedFiles, 1);
});

test('file HTTP 404 and byte mismatch continue; partial pair is recovered with its recorded name', async (t) => {
    const bad = document('1');
    const env = await setup(t, [bad, document('2')]);
    env.api.fileFailure = '1-audit_trail';
    assert.equal((await env.run()).code, 2);
    assert.equal((await env.files()).length, 3);
    await assertReport(env, { status: 'partial', savedFiles: 3, failedFiles: 1 });
    assert.match(env.api.reports.at(-1).failures[0].reason, /404/);
    const before = await env.state();
    env.api.fileFailure = null;
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, ['1-audit_trail']);
    assert.deepEqual(await env.state(), before);
    await assertReport(env, { status: 'success', savedFiles: 1, skippedFiles: 2 });
    const third = document('3');
    third.files[0].byteSize += 1;
    env.api.docs.push(third);
    assert.equal((await env.run()).code, 2);
    assert.equal((await env.files()).length, 4);
    await assertReport(env, { status: 'partial', savedFiles: 0, skippedFiles: 4, failedFiles: 1 });
});

test('a preexisting untracked audit path reserves the pair number', async (t) => {
    const env = await setup(t, [document('1')]);
    await mkdir(join(env.archiveDir, '서비스계약서', '감사추적'), { recursive: true });
    await writeFile(join(env.archiveDir, '서비스계약서', '감사추적', `[감사추적]_${base}.pdf`), 'preserve');
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/감사추적/[감사추적]_${base}.pdf`), 'preserve');
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), '1:document');
    await assertReport(env, { status: 'success', savedFiles: 2 });
});

test('archive directory symlink cannot create files or directories outside the archive', async (t) => {
    const env = await setup(t, [document('1')]);
    const outside = join(env.dir, 'outside');
    await mkdir(outside);
    await mkdir(env.archiveDir);
    await symlink(outside, join(env.archiveDir, '서비스계약서'));
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual((await env.state()).units, {});
    assert.equal(env.api.reports.at(-1).failedFiles, 1);
    assert.equal(env.api.reports.at(-1).status, 'partial');
});

test('failed qpdf cleans temps, reports a group failure and still copies originals to Drive', async (t) => {
    const env = await setup(t, chunks());
    await writeFile(env.qpdfBin, '#!/usr/bin/env node\nprocess.exit(1);\n');
    assert.equal((await env.run()).code, 2);
    assert.equal((await env.files()).length, 6);
    assert.equal(Object.keys((await env.state()).units).length, 3);
    await assertReport(env, { status: 'partial', driveStatus: 'ok', savedFiles: 6, failedFiles: 1 });
});

test('merged pair is skipped on repeat and a missing merged audit recovers at the recorded path', async (t) => {
    const env = await setup(t, chunks());
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    await rm(env.qpdfLog);
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    await assert.rejects(readFile(env.qpdfLog), { code: 'ENOENT' });
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 8 });
    const auditPath = `제공기록지/감사추적/[감사추적]_${srBase}.pdf`;
    await rm(join(env.archiveDir, auditPath));
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(auditPath), '1:audit_trail2:audit_trail3:audit_trail');
    assert.deepEqual(await env.state(), before);
    assert.deepEqual(env.api.fileRequests, []);
    assert.equal(JSON.parse(await readFile(env.qpdfLog, 'utf8')).length, 1);
    await assertReport(env, { status: 'success', savedFiles: 1, skippedFiles: 6 });
});

test('single and merged service units reserve names in common createdAt order', async (t) => {
    const single = document('4', { kind: 'service_record' });
    const env = await setup(t, [single, ...chunks()]);
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`제공기록지/${srBase}.pdf`), '1:document2:document3:document');
    assert.equal(await env.bytes(`제공기록지/${srBase} (2).pdf`), '4:document');
    await assertReport(env, { status: 'success', savedFiles: 10 });
});

test('limited walk with unread pages reports partial without a document failure', async (t) => {
    const env = await setup(t, [document('1'), document('2')]);
    env.api.pageSize = 1;
    assert.equal((await env.run(['--limit', '1'])).code, 2);
    assert.equal(env.api.listRequests.length, 1);
    assert.equal((await env.files()).length, 2);
    await assertReport(env, { status: 'partial', limited: true, totalDocs: 1, failedFiles: 0, savedFiles: 2 });
});

test('createdAt ties use docId and absent customer/date use fallback names', async (t) => {
    const first = document('a', { customerName: null, serviceStartDate: null });
    const second = document('b', { customerName: null, serviceStartDate: null });
    const env = await setup(t, [second, first]);
    assert.equal((await env.run()).code, 0);
    const name = '서비스계약서_고객미상_시작일미상';
    assert.equal(await env.bytes(`서비스계약서/${name}.pdf`), 'a:document');
    assert.equal(await env.bytes(`서비스계약서/${name} (2).pdf`), 'b:document');
    await assertReport(env, { status: 'success', savedFiles: 4 });
});

const auditPath = (suffix = '') => `서비스계약서/감사추적/[감사추적]_${base}${suffix}.pdf`;
const reviewChunks = () => chunks().map((doc) => setFiles(Object.assign(doc, { completed: false }), { document: `${doc.docId}:review`, audit_trail: null }));
const complete = (doc) => { doc.completed = true; return setFiles(doc, { document: `${doc.docId}:final`, audit_trail: `${doc.docId}:audit_trail` }); };

test('review-stage document is saved with its document only, then skipped on the next run', async (t) => {
    const doc = reviewDoc('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(await env.files(), [`서비스계약서/${base}.pdf`]);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:review');
    const state = await env.state();
    assert.deepEqual(state.units[key(doc)], { files: { [`서비스계약서/${base}.pdf`]: doc.files[0].byteSize, [auditPath()]: null }, fingerprint: fingerprint(doc), completed: false });
    await assertReport(env, { status: 'success', savedFiles: 1, skippedFiles: 0, failedFiles: 0 });
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, []);
    assert.deepEqual(await env.state(), state);
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 1 });
});

test('a saved review document that completes overwrites the same file and adds the reserved audit trail', async (t) => {
    const doc = reviewDoc('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    complete(doc);
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(await env.files(), [auditPath(), `서비스계약서/${base}.pdf`].sort());
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:final');
    assert.equal(await env.bytes(auditPath()), '1:audit_trail');
    for (const path of [`서비스계약서/${base}.pdf`, auditPath()]) {
        assert.equal((await stat(join(env.archiveDir, path))).mtimeMs, Date.parse(doc.createdAt));
    }
    const after = await env.state();
    assert.deepEqual(Object.keys(after.units[key(doc)].files), Object.keys(before.units[key(doc)].files));
    assert.deepEqual(after.units[key(doc)], { files: { [`서비스계약서/${base}.pdf`]: doc.files[0].byteSize, [auditPath()]: doc.files[1].byteSize }, fingerprint: fingerprint(doc), completed: true });
    await assertReport(env, { status: 'success', savedFiles: 2, skippedFiles: 0 });
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, []);
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 2 });
});

test('a failed overwrite download leaves the old file and state, and the next run completes it', async (t) => {
    const doc = reviewDoc('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    complete(doc);
    env.api.fileFailure = '1-audit_trail';
    assert.equal((await env.run()).code, 2);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:review');
    assert.deepEqual(await env.files(), [`서비스계약서/${base}.pdf`]);
    assert.deepEqual(await env.state(), before);
    await assertReport(env, { status: 'partial', savedFiles: 0, failedFiles: 1 });
    env.api.fileFailure = null;
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:final');
    assert.equal(await env.bytes(auditPath()), '1:audit_trail');
    await assertReport(env, { status: 'success', savedFiles: 2 });
});

test('review documents need exactly one document file; an audit file is accepted', async (t) => {
    const noDocument = setFiles(document('1', { completed: false }), { document: null, audit_trail: '1:audit_trail' });
    const twoDocuments = reviewDoc('2');
    twoDocuments.files.push({ ...twoDocuments.files[0], fileId: '2-document-b' });
    const withAudit = setFiles(document('3', { completed: false }), { document: '3:review', audit_trail: '3:audit_trail' });
    const empty = setFiles(document('4', { completed: false }), { document: null, audit_trail: null });
    const env = await setup(t, [noDocument, twoDocuments, withAudit, empty]);
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(env.api.reports.at(-1).failures.map((failure) => failure.docId).sort(), ['1', '2', '4']);
    for (const failure of env.api.reports.at(-1).failures) assert.equal(failure.reason, '필수 파일 없음');
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '3:review');
    assert.equal(await env.bytes(auditPath()), '3:audit_trail');
    assert.deepEqual(Object.keys((await env.state()).units), [key(withAudit)]);
    await assertReport(env, { status: 'partial', savedFiles: 2, failedFiles: 3 });
});

test('a completed document still needs both files', async (t) => {
    const doc = setFiles(document('1', { completed: true }), { document: '1:document', audit_trail: null });
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(await env.files(), []);
    await assertReport(env, { status: 'partial', failures: [{ docId: '1', reason: '필수 파일 없음' }] });
});

test('a document that leaves the listing keeps its saved files and state', async (t) => {
    const env = await setup(t, [reviewDoc('1'), document('2')]);
    assert.equal((await env.run()).code, 0);
    const files = await env.files();
    const state = await env.state();
    env.api.docs = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(await env.files(), files);
    assert.deepEqual(await env.state(), state);
    await assertReport(env, { status: 'success', totalDocs: 0, savedFiles: 0, skippedFiles: 0 });
});

test('review-stage chunks merge into a document only; completion overwrites it and builds the merged audit trail', async (t) => {
    const docs = reviewChunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const merged = `제공기록지/${srBase}.pdf`;
    const mergedAudit = `제공기록지/감사추적/[감사추적]_${srBase}.pdf`;
    assert.equal(await env.bytes(merged), '1:review2:review3:review');
    assert.ok(!(await env.files()).includes(mergedAudit));
    assert.equal((await env.files()).length, 4);
    const state = await env.state();
    const mergedKey = 'merged:case-1:1';
    assert.deepEqual(state.units[mergedKey].files, { [merged]: '1:review2:review3:review'.length, [mergedAudit]: null });
    assert.equal(state.units[mergedKey].completed, false);
    await assertReport(env, { status: 'success', savedFiles: 4 });
    // Unchanged review state: nothing is rebuilt.
    await rm(env.qpdfLog);
    assert.equal((await env.run()).code, 0);
    await assert.rejects(readFile(env.qpdfLog), { code: 'ENOENT' });
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 4 });
    // Only the first chunk completes: its audit exists, the merged audit still cannot.
    complete(docs.find((doc) => doc.docId === '1'));
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(merged), '1:final2:review3:review');
    assert.ok(!(await env.files()).includes(mergedAudit));
    // All chunks complete.
    for (const doc of docs) complete(doc);
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(merged), '1:final2:final3:final');
    assert.equal(await env.bytes(mergedAudit), '1:audit_trail2:audit_trail3:audit_trail');
    assert.equal(await env.bytes(`제공기록지/원본/${srBase}_2장.pdf`), '2:final');
    assert.equal((await env.files()).length, 8);
    const after = await env.state();
    assert.deepEqual(Object.keys(after.units[mergedKey].files), Object.keys(state.units[mergedKey].files));
    assert.equal(after.units[mergedKey].completed, true);
    assert.equal(after.units[mergedKey].fingerprint, [...docs].sort((a, b) => a.serviceRecordChunk.firstSessionIndex - b.serviceRecordChunk.firstSessionIndex).map(fingerprint).join(','));
    await assertReport(env, { status: 'success', failedFiles: 0 });
});

function v1Of(docs, v2) {
    const ordered = docs.filter((doc) => doc.serviceRecordChunk).sort((a, b) => a.serviceRecordChunk.firstSessionIndex - b.serviceRecordChunk.firstSessionIndex);
    const v1 = Object.fromEntries(docs.map((doc) => [`doc:${doc.docId}:${doc.files[0].sha256}:${doc.files[1].sha256}`, { files: v2.units[key(doc)].files }]));
    if (ordered.length) v1[`merged:case-1:1:${ordered.map((doc) => doc.files[0].sha256).join(',')}`] = { files: v2.units['merged:case-1:1'].files };
    return v1;
}
async function writeV1(env, units) {
    await mkdir(env.stateDir, { recursive: true });
    await writeFile(join(env.stateDir, 'state.json'), JSON.stringify({ version: 1, units }));
}

test('a version 1 state file migrates in place: files are skipped and the state is saved as version 2', async (t) => {
    const docs = [document('1'), document('2', { kind: 'service_record' })];
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const v2 = await env.state();
    const v1 = Object.fromEntries(docs.map((doc) => [`doc:${doc.docId}:${doc.files[0].sha256}:${doc.files[1].sha256}`, { files: v2.units[key(doc)].files }]));
    await writeV1(env, v1);
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, []);
    assert.deepEqual(await env.state(), v2);
    await assertReport(env, { status: 'success', savedFiles: 0, skippedFiles: 4 });
});

test('a version 1 merged entry migrates as completed and forks once to a new merged pair; originals stay untouched', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const v2 = await env.state();
    const v1 = v1Of(docs, v2);
    await writeV1(env, v1);
    const originals = await Promise.all((await env.files()).map(async (path) => [path, await env.bytes(path)]));
    env.api.fileRequests = [];
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(env.api.fileRequests, []);
    for (const [path, content] of originals) assert.equal(await env.bytes(path), content);
    assert.equal(await env.bytes(`제공기록지/${srBase} (2).pdf`), '1:document2:document3:document');
    assert.equal(await env.bytes(`제공기록지/감사추적/[감사추적]_${srBase} (2).pdf`), '1:audit_trail2:audit_trail3:audit_trail');
    const after = await env.state();
    const mergedV1Key = Object.keys(v1).find((unitKey) => unitKey.startsWith('merged:'));
    const list = mergedV1Key.split(':').at(-1);
    assert.deepEqual(after.units[`merged:case-1:1@v1:${list}`], { ...v2.units['merged:case-1:1'], fingerprint: `v1:${list}`, completed: true });
    assert.equal(after.units['merged:case-1:1'].completed, true);
    assert.ok(Object.keys(after.units['merged:case-1:1'].files).every((path) => path.includes(' (2)')));
    await assertReport(env, { status: 'success', savedFiles: 2, skippedFiles: 6 });
});

test('a version 1 merged entry whose chunk audit trail alone changed gets a new merged pair built from current inputs', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const v2 = await env.state();
    await writeV1(env, v1Of(docs, v2));
    const merged = `제공기록지/${srBase}.pdf`;
    const mergedAudit = `제공기록지/감사추적/[감사추적]_${srBase}.pdf`;
    const originals = [await env.bytes(merged), await env.bytes(mergedAudit)];
    setFiles(docs.find((doc) => doc.docId === '3'), { document: '3:document', audit_trail: '3:changed:audit' });
    assert.equal((await env.run()).code, 0);
    assert.deepEqual([await env.bytes(merged), await env.bytes(mergedAudit)], originals);
    assert.equal(await env.bytes(`제공기록지/${srBase} (2).pdf`), '1:document2:document3:document');
    assert.equal(await env.bytes(`제공기록지/감사추적/[감사추적]_${srBase} (2).pdf`), '1:audit_trail2:audit_trail3:changed:audit');
    await assertReport(env, { status: 'success' });
});

test('a migrated version 1 document whose content changed is never overwritten: the new content takes (2)', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const v2 = await env.state();
    await writeV1(env, v1Of([doc], v2));
    const original = await env.bytes(`서비스계약서/${base}.pdf`);
    setFiles(doc, { document: 'changed', audit_trail: 'changed:audit_trail' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), original);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'changed');
    assert.equal(await env.bytes(auditPath(' (2)')), 'changed:audit_trail');
    const after = await env.state();
    assert.equal(after.version, 2);
    assert.deepEqual(after.units[`doc:1@${sha(Buffer.from('1:document'))}:${sha(Buffer.from('1:audit_trail'))}`], v2.units[key(doc)]);
    assert.equal(after.units[key(doc)].completed, true);
    await assertReport(env, { status: 'success', savedFiles: 2 });
});

test('two version 1 entries for one document stop the run with a state error', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const files = (await env.state()).units[key(doc)].files;
    await writeV1(env, { [`doc:1:${'a'.repeat(64)}:${'b'.repeat(64)}`]: { files }, [`doc:1:${'c'.repeat(64)}:${'d'.repeat(64)}`]: { files } });
    const before = env.api.reports.length;
    env.api.fileRequests = [];
    const result = await env.run();
    assert.equal(result.code, 1);
    assert.match(result.stdout, /state\.json 형식 오류/);
    assert.equal(env.api.reports.length, before);
    assert.deepEqual(env.api.fileRequests, []);
    assert.equal(JSON.parse(await readFile(join(env.stateDir, 'state.json'), 'utf8')).version, 1);
});

test('unknown state versions and malformed version 2 entries are rejected', async (t) => {
    const env = await setup(t, [document('1')]);
    await mkdir(env.stateDir, { recursive: true });
    const statePath = join(env.stateDir, 'state.json');
    for (const bad of [
        { version: 3, units: {} },
        { version: 2, units: { 'doc:1': { files: { 'a.pdf': 1 }, fingerprint: 'x', completed: true } } },
        { version: 2, units: { 'doc:1': { files: { 'a.pdf': 1, 'b.pdf': -1 }, fingerprint: 'x', completed: true } } },
        { version: 2, units: { 'doc:1': { files: { 'a.pdf': 1, 'b.pdf': null } } } },
        { version: 2, units: { 'doc:1': { files: { 'a.pdf': 1, 'b.pdf': null }, fingerprint: 'x' } } },
        { version: 2, units: { 'doc:1': { files: { 'a.pdf': 1, 'b.pdf': null }, fingerprint: 'x', completed: 'yes' } } },
        { version: 2, units: { 'doc:1': { files: { '../a.pdf': 1, 'b.pdf': null }, fingerprint: 'x', completed: false } } },
    ]) {
        await writeFile(statePath, JSON.stringify(bad));
        assert.equal((await env.run()).code, 1, JSON.stringify(bad));
    }
    assert.deepEqual(env.api.reports, []);
    await writeFile(statePath, JSON.stringify({ version: 2, units: { 'doc:9': { files: { 'a.pdf': 1, 'b.pdf': null }, fingerprint: 'x', completed: false } } }));
    assert.equal((await env.run()).code, 0);
});

test('review content resubmitted before completion overwrites in place and stays review-stage', async (t) => {
    const doc = reviewDoc('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    setFiles(doc, { document: '1:resubmitted', audit_trail: null });
    assert.equal((await env.run()).code, 0);
    assert.deepEqual(await env.files(), [`서비스계약서/${base}.pdf`]);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:resubmitted');
    const state = await env.state();
    assert.deepEqual(Object.keys(state.units), [key(doc)]);
    assert.equal(state.units[key(doc)].completed, false);
    assert.equal(state.units[key(doc)].fingerprint, fingerprint(doc));
    await assertReport(env, { status: 'success', savedFiles: 1 });
});

test('completed backup files are never overwritten: a repeated content change keeps every revision', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const first = await env.state();
    const fp1 = fingerprint(doc);
    setFiles(doc, { document: 'v2', audit_trail: 'v2:audit' });
    assert.equal((await env.run()).code, 0);
    const fp2 = fingerprint(doc);
    setFiles(doc, { document: 'v3', audit_trail: 'v3:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:document');
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'v2');
    assert.equal(await env.bytes(`서비스계약서/${base} (3).pdf`), 'v3');
    const state = await env.state();
    assert.deepEqual(state.units[`doc:1@${fp1}`], first.units[key(doc)]);
    assert.equal(state.units[`doc:1@${fp2}`].fingerprint, fp2);
    assert.equal(state.units[key(doc)].fingerprint, fingerprint(doc));
    assert.equal(Object.keys(state.units).length, 3);
    // Flip-flopping back to an archived revision is also a new revision; archive keys never collide.
    const fp3 = fingerprint(doc);
    setFiles(doc, { document: 'v2', audit_trail: 'v2:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base} (4).pdf`), 'v2');
    setFiles(doc, { document: 'v3', audit_trail: 'v3:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base} (5).pdf`), 'v3');
    const units = (await env.state()).units;
    assert.ok(Object.hasOwn(units, `doc:1@${fp1}`) && Object.hasOwn(units, `doc:1@${fp2}`) && Object.hasOwn(units, `doc:1@${fp3}`));
    assert.ok(Object.hasOwn(units, `doc:1@${fp2}@2`));
    assert.equal(Object.keys(units).length, 5);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:document');
});

test('a failed write of changed completed content leaves the old entry and files untouched', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    setFiles(doc, { document: 'changed', audit_trail: 'changed:audit' });
    env.api.fileFailure = '1-document';
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(await env.state(), before);
    assert.equal((await env.files()).length, 2);
    env.api.fileFailure = null;
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'changed');
});

test('a changed completed merged group is rebuilt under (2) and the original merge is untouched', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    const merged = `제공기록지/${srBase}.pdf`;
    const mergedAudit = `제공기록지/감사추적/[감사추적]_${srBase}.pdf`;
    const originals = await Promise.all((await env.files()).map(async (path) => [path, await env.bytes(path)]));
    const second = docs.find((doc) => doc.docId === '2');
    const oldFingerprint = fingerprint(second);
    setFiles(second, { document: '2:changed', audit_trail: '2:changed:audit' });
    assert.equal((await env.run()).code, 0);
    for (const [path, content] of originals) assert.equal(await env.bytes(path), content);
    assert.equal(await env.bytes(`제공기록지/${srBase} (2).pdf`), '1:document2:changed3:document');
    assert.equal(await env.bytes(`제공기록지/감사추적/[감사추적]_${srBase} (2).pdf`), '1:audit_trail2:changed:audit3:audit_trail');
    assert.equal(await env.bytes(`제공기록지/원본/${srBase}_2장 (2).pdf`), '2:changed');
    const after = await env.state();
    assert.ok(Object.keys(after.units[`merged:case-1:1`].files).every((path) => path.includes(' (2)')));
    const archivedMerged = Object.entries(after.units).filter(([unitKey]) => unitKey.startsWith('merged:case-1:1@'));
    assert.equal(archivedMerged.length, 1);
    assert.deepEqual(archivedMerged[0][1], before.units['merged:case-1:1']);
    assert.deepEqual(after.units[`doc:2@${oldFingerprint}`], before.units[key(second)]);
    assert.ok(Object.keys(before.units['merged:case-1:1'].files).includes(merged) && Object.keys(before.units['merged:case-1:1'].files).includes(mergedAudit));
    await assertReport(env, { status: 'success', savedFiles: 4, skippedFiles: 4 });
});

test('a migrated version 1 merged entry whose chunk content changed is not overwritten', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const v2 = await env.state();
    await writeV1(env, v1Of(docs, v2));
    const merged = `제공기록지/${srBase}.pdf`;
    const original = await env.bytes(merged);
    setFiles(docs.find((doc) => doc.docId === '3'), { document: '3:changed', audit_trail: '3:changed:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(merged), original);
    assert.equal(await env.bytes(`제공기록지/${srBase} (2).pdf`), '1:document2:document3:changed');
    const after = await env.state();
    assert.equal(after.units['merged:case-1:1'].completed, true);
    assert.equal(Object.keys(after.units).filter((unitKey) => unitKey.startsWith('merged:case-1:1@')).length, 1);
});

test('a review-stage merged group becomes completed only once every chunk and the merged audit exist', async (t) => {
    const docs = reviewChunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    for (const doc of docs) complete(doc);
    // One chunk's completion fails to download: the merge is not touched and stays review-stage.
    env.api.fileFailure = '3-audit_trail';
    await env.run();
    assert.equal((await env.state()).units['merged:case-1:1'].completed, false);
    env.api.fileFailure = null;
    assert.equal((await env.run()).code, 0);
    assert.equal((await env.state()).units['merged:case-1:1'].completed, true);
});

test('repairing a completed pair while the API says review-stage never loosens the stored flag (v2 entry)', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const original = await env.bytes(`서비스계약서/${base}.pdf`);
    await rm(join(env.archiveDir, auditPath()));
    doc.completed = false;
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(auditPath()), '1:audit_trail');
    assert.equal((await env.state()).units[key(doc)].completed, true);
    setFiles(doc, { document: 'changed', audit_trail: 'changed:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), original);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'changed');
});

test('repairing a migrated version 1 entry while the API says review-stage never loosens the stored flag', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    await writeV1(env, v1Of([doc], await env.state()));
    const original = await env.bytes(`서비스계약서/${base}.pdf`);
    await rm(join(env.archiveDir, auditPath()));
    doc.completed = false;
    assert.equal((await env.run()).code, 0);
    assert.equal((await env.state()).units[key(doc)].completed, true);
    setFiles(doc, { document: 'changed', audit_trail: 'changed:audit' });
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), original);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'changed');
});

test('a fork whose audit download fails leaves no new files and no state change, and retries next run', async (t) => {
    const doc = document('1');
    const env = await setup(t, [doc]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    const files = await env.files();
    setFiles(doc, { document: 'changed', audit_trail: 'changed:audit' });
    env.api.fileFailure = '1-audit_trail';
    assert.equal((await env.run()).code, 2);
    assert.deepEqual(await env.files(), files);
    assert.deepEqual(await env.state(), before);
    assert.equal(await env.bytes(`서비스계약서/${base}.pdf`), '1:document');
    await assertReport(env, { status: 'partial', savedFiles: 0, failedFiles: 1 });
    env.api.fileFailure = null;
    assert.equal((await env.run()).code, 0);
    assert.equal(await env.bytes(`서비스계약서/${base} (2).pdf`), 'changed');
    assert.equal(await env.bytes(auditPath(' (2)')), 'changed:audit');
    assert.equal(Object.keys((await env.state()).units).length, 2);
});

test('a merged fork whose second rename fails removes the first output and leaves the state unchanged', async (t) => {
    const docs = chunks();
    const env = await setup(t, docs);
    assert.equal((await env.run()).code, 0);
    const mergedBefore = (await env.state()).units['merged:case-1:1'];
    const files = (await env.files()).filter((path) => path.startsWith('제공기록지/') && !path.includes('원본'));
    // The stub makes the merged audit's final path a directory, so its rename fails after the document's succeeded.
    await writeFile(env.qpdfBin, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
const a = process.argv.slice(2), i = a.indexOf('--pages'), j = a.indexOf('--');
writeFileSync(a[j + 1], Buffer.concat(a.slice(i + 1, j).map((p) => readFileSync(p))));
if (basename(a[j + 1]).startsWith('[감사추적]_') && basename(a[j + 1]).includes(' (2).pdf.')) mkdirSync(a[j + 1].replace(/\.[0-9a-f-]{36}\.tmp$/, ''));
`);
    setFiles(docs.find((doc) => doc.docId === '2'), { document: '2:changed', audit_trail: '2:changed:audit' });
    assert.equal((await env.run()).code, 2);
    await assert.rejects(readFile(join(env.archiveDir, `제공기록지/${srBase} (2).pdf`)), { code: 'ENOENT' });
    const after = await env.state();
    assert.deepEqual(after.units['merged:case-1:1'], mergedBefore);
    assert.ok(!Object.keys(after.units).some((unitKey) => unitKey.startsWith('merged:case-1:1@')));
    for (const path of files) assert.ok((await env.files()).includes(path));
    assert.equal(await env.bytes(`제공기록지/${srBase}.pdf`), '1:document2:document3:document');
    assert.equal(env.api.reports.at(-1).failedFiles, 1);
    assert.equal(env.api.reports.at(-1).status, 'partial');
});
