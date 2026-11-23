import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(new URL('../eformsign-backup/backup.mjs', import.meta.url));
const runFile = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const migrationArgs = ['--migrate-provider-contracts'];
const metadata = { signerName: '김관리', signedDate: '2026-05-01' };
const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
const providerPair = (name = '김관리', suffix = '') => pair('제공인력 계약서', `제공인력_계약서_${name}_2026-05-01${suffix}`);
const legacyPair = pair('기타', '제공인력 계약서');

const mockDrive = `#!/usr/bin/env node
const fs = require('node:fs');
const { join, dirname, basename } = require('node:path');
const { MOCK_DRIVE, MOCK_COMMANDS, MOCK_CONTROL } = process.env;
const control = JSON.parse(fs.readFileSync(MOCK_CONTROL, 'utf8'));
const args = process.argv.slice(2);
const op = args[0];
const operands = args.includes('--') ? args.slice(args.indexOf('--') + 1) : args.slice(2);
fs.appendFileSync(MOCK_COMMANDS, JSON.stringify(args) + '\\n');
const relative = (remote) => remote.slice(remote.indexOf(':') + 1);
const target = (remote) => join(MOCK_DRIVE, relative(remote));
const fail = () => process.exit(9);
const place = (from, to) => { fs.mkdirSync(dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
if (op === 'copy') {
    if (control.failCopy) fail();
    fs.cpSync(operands[0], target(operands[1]), { recursive: true });
} else if (op === 'lsjson') {
    const p = target(operands[0]);
    const items = fs.readdirSync(p, { withFileTypes: true }).flatMap((entry) => {
        const path = join(relative(operands[0]), entry.name);
        const row = { Name: entry.name, IsDir: entry.isDirectory(), ID: path + ':' + fs.statSync(join(p, entry.name)).ino };
        return path === control.duplicate ? [row, { ...row, ID: 'duplicate' }] : [row];
    });
    console.log(JSON.stringify(items));
} else if (op === 'cat') {
    process.stdout.write(fs.readFileSync(target(operands[0])));
} else if (op === 'copyto') {
    if (!args.includes('--immutable') || !args.includes('--ignore-existing')) fail();
    const to = target(operands[1]);
    if (fs.existsSync(to)) fail();
    place(operands[0], to);
    if (relative(operands[1]) === control.failAfterCopy) fail();
} else if (op === 'deletefile') {
    const file = target(operands[0]);
    fs.unlinkSync(file);
    if (relative(operands[0]) === control.failAfterDelete) fail();
} else fail();
`;

async function fixture(t) {
    const root = await fs.mkdtemp(join(tmpdir(), 'eformsign-provider-test-'));
    const archive = join(root, 'archive');
    const stateDir = join(root, '.local/state/eformsign-backup');
    const statePath = join(stateDir, 'state.json');
    const lock = join(stateDir, 'run.lock');
    const drive = join(root, 'remote');
    const commandLog = join(root, 'commands');
    const driveControl = join(root, 'drive-control.json');
    const tokenFile = join(root, 'synthetic-token');
    const settingsPath = join(root, 'settings.json');
    const rcloneBin = join(root, 'rclone');
    const controls = (data) => fs.writeFile(driveControl, JSON.stringify(data));
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(drive);
    await fs.writeFile(lock, '');
    await fs.writeFile(commandLog, '');
    await controls({});
    await fs.writeFile(tokenFile, 'test-fixture-only');
    await fs.writeFile(rcloneBin, mockDrive, { mode: 0o700 });

    const files = new Map();
    const listing = { items: [], nextCursor: null, corrupt: null, requests: [] };
    const server = createServer((req, res) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        listing.requests.push([req.method, path]);
        if (path.endsWith('/documents')) {
            res.end(JSON.stringify({ items: listing.items, nextCursor: listing.nextCursor }));
        } else if (path.endsWith('/runs')) {
            req.resume();
            res.writeHead(201).end();
        } else {
            const id = decodeURIComponent(path.split('/').at(-1));
            const byteBuffer = files.get(id);
            if (!byteBuffer) res.writeHead(404).end();
            else res.end(listing.corrupt === id ? Buffer.alloc(byteBuffer.length, 255) : byteBuffer);
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise((done) => server.close(done));
        await fs.rm(root, { recursive: true, force: true });
    });
    await fs.writeFile(settingsPath, JSON.stringify({
        apiBaseUrl: `http://127.0.0.1:${server.address().port}`, tokenFile, archiveDir: archive, stateDir,
        rcloneRemote: 'drive:backup', rcloneBin,
    }));
    const doc = (docId, { completed = true, audit = completed, providerContract, title = '제공인력 계약서', revision = 1 } = {}) => ({
        docId, title, createdAt: '2026-05-02T00:00:00Z', kind: 'other', completed, providerContract,
        files: (audit ? ['document', 'audit_trail'] : ['document']).map((fileType) => {
            const fileId = `${docId}.${fileType}.${revision}`;
            const bytes = Buffer.from(`synthetic fixture content ${fileId}`);
            files.set(fileId, bytes);
            return { fileType, fileId, sha256: sha(bytes), byteSize: bytes.length };
        }),
    });
    const run = async (args = [], code = 0) => {
        const result = await runFile(process.execPath, [script, '--settings', settingsPath, ...args], {
            env: { ...process.env, HOME: root, MOCK_DRIVE: drive, MOCK_COMMANDS: commandLog, MOCK_CONTROL: driveControl },
        }).catch((error) => error);
        assert.equal(result.code ?? 0, code, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout + result.stderr, /김관리|최관리/);
        return result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    };
    const state = async () => JSON.parse(await fs.readFile(statePath, 'utf8'));
    const filePath = (path, remote = false) => join(remote ? join(drive, 'backup') : archive, path);
    const expectFile = async (path, file, remote = false) => {
        assert.equal(sha(await fs.readFile(filePath(path, remote))), file.sha256);
    };
    const expectMissing = (path, remote = false) => assert.rejects(fs.stat(filePath(path, remote)), { code: 'ENOENT' });
    const expectPair = (paths, document, remote = false) => Promise.all(paths.map((path, i) => expectFile(path, document.files[i], remote)));
    const write = async (path, bytes, remote = false) => {
        const dest = filePath(path, remote);
        await fs.mkdir(dirname(dest), { recursive: true });
        await fs.writeFile(dest, bytes);
    };
    const commands = async () => (await fs.readFile(commandLog, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    const journalDir = join(stateDir, 'provider-contract-migration');
    const journal = async () => JSON.parse(await fs.readFile(join(journalDir, 'journal.json'), 'utf8'));
    const legacy = async () => {
        const original = doc('a');
        listing.items = [original];
        await run();
        const current = { ...original, title: '새 문서 제목', providerContract: metadata };
        listing.items = [current];
        return current;
    };
    return { archive, drive, controls, state, statePath, journal, journalDir, lock, listing, doc, run, expectPair,
        expectFile, expectMissing, filePath, write, commands, legacy };
}

test('allocates paired provider paths and a stable suffix, with old API and unsafe values using legacy paths', async (t) => {
    const f = await fixture(t);
    const a = f.doc('a', { providerContract: metadata, title: '발급 문서' });
    const b = f.doc('b', { providerContract: metadata });
    const old = f.doc('c');
    const unsafe = f.doc('d', { providerContract: { ...metadata, signerName: '../' }, title: '안내' });
    f.listing.items = [b, a, old, unsafe];
    await f.run();
    await f.expectPair(providerPair(), a);
    await f.expectPair(providerPair('김관리', ' (2)'), b);
    await f.expectPair(legacyPair, old);
    await f.expectPair(pair('기타', '안내'), unsafe);
    const before = await f.state();
    await f.run();
    assert.deepEqual(await f.state(), before);
});

test('a suffixed review allocation survives repeat listings, missing metadata and completion', async (t) => {
    const f = await fixture(t);
    const a = f.doc('a', { completed: false, providerContract: metadata });
    const b = f.doc('b', { completed: false, providerContract: metadata });
    f.listing.items = [a, b];
    await f.run();
    const before = await f.state();
    await f.run();
    assert.deepEqual(await f.state(), before);
    f.listing.items = [a, { ...b, providerContract: undefined }];
    await f.run();
    assert.deepEqual(await f.state(), before);
    const completed = f.doc('b', { providerContract: metadata, revision: 2 });
    f.listing.items = [a, completed];
    await f.run();
    await f.expectPair(providerPair('김관리', ' (2)'), completed);
    const state = await f.state();
    assert.deepEqual(Object.keys(state.units), ['doc:a', 'doc:b']);
    await f.run();
    assert.deepEqual(await f.state(), state);
});

test('review without metadata reallocates on completion and survives a failed Drive copy and retry', async (t) => {
    const f = await fixture(t);
    const review = f.doc('a', { completed: false, audit: true });
    f.listing.items = [review];
    await f.run();
    const completed = f.doc('a', { providerContract: metadata, revision: 2 });
    f.listing.items = [completed];
    f.listing.corrupt = completed.files[1].fileId;
    await f.run([], 2);
    await f.expectMissing(providerPair()[0]);
    assert.equal((await f.state()).units['doc:a'].completed, false);
    f.listing.corrupt = null;
    await f.controls({ failCopy: true });
    await f.run([], 2);
    await f.expectPair(providerPair(), completed);
    await f.expectPair(legacyPair, review);
    await f.expectPair(legacyPair, review, true);
    await f.expectMissing(providerPair()[0], true);
    const state = await f.state();
    assert.equal(Object.keys(state.units).filter((key) => key.startsWith('doc:a@')).length, 1);
    await f.controls({});
    await f.run();
    assert.deepEqual(await f.state(), state);
    await f.expectPair(providerPair(), completed, true);
    await f.expectPair(legacyPair, review);
    await f.expectPair(legacyPair, review, true);
    assert.ok((await f.commands()).every(([op]) => op === 'copy'));
});

test('a changed review name creates a fresh pair and keeps the previous local and Drive bytes', async (t) => {
    const f = await fixture(t);
    const review = f.doc('a', { completed: false, providerContract: metadata });
    f.listing.items = [review];
    await f.run();
    const changedMetadata = { ...metadata, signerName: '최관리' };
    const changed = f.doc('a', { completed: false, providerContract: changedMetadata, revision: 2 });
    f.listing.items = [changed];
    await f.run();
    const completed = f.doc('a', { providerContract: changedMetadata, revision: 3 });
    f.listing.items = [completed];
    await f.run();
    for (const remote of [false, true]) {
        await f.expectFile(providerPair()[0], review.files[0], remote);
        await f.expectPair(providerPair('최관리'), completed, remote);
    }
});

test('explicit migration is read-only by default, moves both verified copies, preserves reservations and supports rollback', async (t) => {
    const f = await fixture(t);
    const current = await f.legacy();
    await f.run(); // Normal timer behavior retains the existing completed legacy allocation.
    const prior = await fs.readFile(f.statePath);
    const commandCount = (await f.commands()).length;
    const reports = f.listing.requests.filter(([method]) => method === 'POST').length;
    assert.deepEqual(await f.run(migrationArgs), [{ migration: 'dry-run', pairs: 1, skipped: 0 }]);
    assert.deepEqual(await fs.readFile(f.statePath), prior);
    assert.ok((await f.commands()).slice(commandCount).every(([op]) => ['lsjson', 'cat'].includes(op)));
    assert.equal(f.listing.requests.filter(([method]) => method === 'POST').length, reports);
    await assert.rejects(fs.stat(f.journalDir), { code: 'ENOENT' });
    await f.expectPair(legacyPair, current);
    await f.expectPair(legacyPair, current, true);
    await f.expectMissing(providerPair()[0]);

    await f.run([...migrationArgs, '--apply']);
    const state = await f.state();
    const after = state.units['doc:a'];
    assert.equal(after.fingerprint, JSON.parse(prior).units['doc:a'].fingerprint);
    assert.equal(after.completed, true);
    assert.deepEqual(after.reservedPaths, legacyPair);
    const journal = await f.journal();
    assert.equal(journal.phase, 'applied');
    assert.equal((await fs.stat(f.journalDir)).mode & 0o777, 0o700);
    const backup = join(f.journalDir, `pre-state-${journal.id}.json`);
    assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readFile(backup), prior);
    for (const remote of [false, true]) {
        await f.expectPair(providerPair(), current, remote);
        for (const old of legacyPair) await f.expectMissing(old, remote);
    }
    const countAfterApply = (await f.commands()).length;
    await f.run([...migrationArgs, '--apply']);
    assert.equal((await f.commands()).length, countAfterApply);
    assert.deepEqual(await f.state(), state);

    const unrelated = f.doc('b');
    f.listing.items = [current, unrelated];
    await f.run();
    const unrelatedAllocation = pair('기타', '제공인력 계약서 (2)');
    await f.expectPair(unrelatedAllocation, unrelated);
    await f.run([...migrationArgs, '--rollback']);
    assert.deepEqual((await f.state()).units['doc:a'], JSON.parse(prior).units['doc:a']);
    assert.equal((await f.journal()).phase, 'rolledBack');
    for (const remote of [false, true]) {
        await f.expectPair(legacyPair, current, remote);
        await f.expectPair(unrelatedAllocation, unrelated, remote);
        for (const path of providerPair()) await f.expectMissing(path, remote);
    }
});

test('resumes after an uploaded file or deleted legacy Drive path was not acknowledged', async (t) => {
    const f = await fixture(t);
    const current = await f.legacy();
    await f.controls({ failAfterCopy: `backup/${providerPair()[0]}` });
    await f.run([...migrationArgs, '--apply'], 1);
    const initial = (await f.state()).units['doc:a'];
    assert.deepEqual(Object.keys(initial.files), legacyPair);
    await f.expectPair(legacyPair, current);
    await f.expectPair(legacyPair, current, true);
    await f.expectFile(providerPair()[0], current.files[0], true);

    await f.controls({ failAfterDelete: `backup/${legacyPair[0]}` });
    await f.run([...migrationArgs, '--apply'], 1);
    await f.expectPair(providerPair(), current);
    await f.expectPair(providerPair(), current, true);
    await f.expectPair(legacyPair, current);
    await f.expectMissing(legacyPair[0], true);
    await f.expectFile(legacyPair[1], current.files[1], true);
    await f.run([], 1); // Timer waits for the operator to finish the journal.
    await f.controls({});
    await f.run([...migrationArgs, '--apply']);
    for (const old of legacyPair) {
        await f.expectMissing(old);
        await f.expectMissing(old, true);
    }
    const deletes = (await f.commands()).filter(([op]) => op === 'deletefile');
    assert.equal(deletes.length, 2);
    assert.deepEqual(Object.keys((await f.state()).units['doc:a'].files), providerPair());
});

test('skips mismatched, unlisted, historical, incomplete, review and unrelated allocations', async (t) => {
    const f = await fixture(t);
    const unrelated = { ...f.doc('x'), kind: 'contract' };
    const review = f.doc('r', { completed: false });
    const incomplete = f.doc('i');
    const archived = f.doc('h');
    f.listing.items = [unrelated, review, incomplete, archived, f.doc('a'), f.doc('unlisted')];
    await f.run();
    const expected = await f.state();
    expected.units['doc:h@historical'] = expected.units['doc:h'];
    delete expected.units['doc:h'];
    await fs.writeFile(f.statePath, JSON.stringify(expected));
    f.listing.items = [
        { ...unrelated, providerContract: metadata }, { ...review, providerContract: metadata },
        { ...incomplete, providerContract: metadata, files: incomplete.files.slice(0, 1) },
        { ...archived, providerContract: metadata }, f.doc('a', { revision: 2, providerContract: metadata }),
    ];
    const count = (await f.commands()).length;
    const before = await fs.readFile(f.statePath);
    await f.run([...migrationArgs, '--apply']);
    assert.deepEqual(await fs.readFile(f.statePath), before);
    assert.equal((await f.commands()).length, count);
});

const refusalCases = {
    'local hash': 'local_checksum_mismatch',
    'Drive hash': 'drive_checksum_mismatch',
    'missing local source': 'missing_local_source',
    'local target': 'local_target_exists',
    'Drive target': 'drive_target_exists',
    'identical Drive target': 'drive_target_exists',
    'duplicate Drive target': 'duplicate_drive_path',
    'shared source': 'shared_archive_path',
};
for (const [conflict, reason] of Object.entries(refusalCases)) {
    test(`refused apply for ${conflict} leaves archive, state and Drive untouched`, async (t) => {
        const f = await fixture(t);
        const current = await f.legacy();
        if (conflict === 'local hash' || conflict === 'Drive hash') {
            await f.write(legacyPair[0], Buffer.alloc(current.files[0].byteSize), conflict === 'Drive hash');
        } else if (conflict === 'missing local source') {
            await fs.unlink(f.filePath(legacyPair[0]));
        } else if (conflict === 'shared source') {
            const state = await f.state();
            state.units['doc:unrelated'] = state.units['doc:a'];
            await fs.writeFile(f.statePath, JSON.stringify(state));
        } else {
            const remote = conflict !== 'local target';
            const bytes = conflict === 'identical Drive target'
                ? await fs.readFile(f.filePath(legacyPair[0]))
                : Buffer.alloc(current.files[0].byteSize);
            await f.write(providerPair()[0], bytes, remote);
            if (conflict === 'duplicate Drive target') await f.controls({ duplicate: `backup/${providerPair()[0]}` });
        }
        const snapshot = async () => {
            const paths = [f.statePath];
            for (const root of [f.archive, f.drive]) {
                const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
                paths.push(...entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)).sort());
            }
            return Promise.all(paths.map(async (path) => [path, sha(await fs.readFile(path))]));
        };
        const before = await snapshot();
        const count = (await f.commands()).length;
        const result = await f.run([...migrationArgs, '--apply'], 1);
        assert.equal(result[0].reason, reason);
        assert.deepEqual(await snapshot(), before);
        assert.ok((await f.commands()).slice(count).every(([op]) => ['lsjson', 'cat'].includes(op)));
        await assert.rejects(fs.stat(f.journalDir), { code: 'ENOENT' });
    });
}

test('migration refuses the timer lock nonblockingly before listing or writing', async (t) => {
    const f = await fixture(t);
    const current = await f.legacy();
    const child = spawn('/usr/bin/flock', ['-n', f.lock, process.execPath, '-e',
        'console.log("locked"); process.stdin.resume()']);
    const exited = once(child, 'exit');
    try {
        await once(child.stdout, 'data');
        const before = await fs.readFile(f.statePath);
        const requestCount = f.listing.requests.length;
        const commandCount = (await f.commands()).length;
        const result = await f.run([...migrationArgs, '--apply'], 1);
        assert.equal(result[0].reason, 'timer_lock_held');
        assert.equal(f.listing.requests.length, requestCount);
        assert.equal((await f.commands()).length, commandCount);
        assert.deepEqual(await fs.readFile(f.statePath), before);
        await f.expectPair(legacyPair, current);
        await assert.rejects(fs.stat(f.journalDir), { code: 'ENOENT' });
    } finally {
        child.stdin.end();
        await exited;
    }
});
