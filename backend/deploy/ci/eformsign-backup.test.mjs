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
const key = (doc) => `doc:${doc.docId}:${doc.files[0].sha256}:${doc.files[1].sha256}`;
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
    assert.equal(state.version, 1);
    for (const unit of Object.values(state.units)) {
        assert.equal(Object.keys(unit.files).length, 2);
        for (const [path, bytes] of Object.entries(unit.files)) {
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
    assert.deepEqual(JSON.parse(await readFile(env.rcloneLog, 'utf8')), ['copy', '--immutable', env.archiveDir, 'fake:archive']);
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

test('3. naming uses createdAt, keeps names on run two, document-only reissue takes (3)', async (t) => {
    const early = document('1');
    const late = document('2');
    const env = await setup(t, [late, early]);
    assert.equal((await env.run()).code, 0);
    const before = await env.state();
    assert.equal((await env.run()).code, 0);
    early.files[0] = { ...early.files[0], content: Buffer.from('reissued') };
    early.files[0].sha256 = sha(early.files[0].content);
    early.files[0].byteSize = early.files[0].content.length;
    assert.equal((await env.run()).code, 0);
    for (const [suffix, content] of [['', '1:document'], [' (2)', '2:document'], [' (3)', 'reissued']]) {
        assert.equal(await env.bytes(`서비스계약서/${base}${suffix}.pdf`), content);
        assert.equal(await env.bytes(`서비스계약서/감사추적/[감사추적]_${base}${suffix}.pdf`), suffix === ' (2)' ? '2:audit_trail' : '1:audit_trail');
    }
    const after = await env.state();
    for (const [unitKey, unit] of Object.entries(before.units)) assert.deepEqual(after.units[unitKey], unit);
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
    const mergedKey = `merged:${chunk.caseId}:${chunk.snapshotVersion}:${ordered.map((doc) => doc.files[0].sha256).join(',')}`;
    assert.deepEqual(state.units[mergedKey], { files: Object.fromEntries(['', '감사추적/[감사추적]_'].map((folder, i) =>
        [`제공기록지/${folder}${srBase}.pdf`, docs.reduce((bytes, doc) => bytes + doc.files[i].byteSize, 0)])) });
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
