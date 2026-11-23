import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
const exec = promisify(execFile);
const apply = ['--migrate-provider-contracts', '--apply'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
const legacy = (id) => pair('기타', `Fixture ${id}`);
const provider = (id) => pair('제공인력 계약서', `제공인력_계약서_Fixture ${id}_2026-01-02`);

const fakeDrive = `#!/usr/bin/env node
const fs = require('node:fs');
const { dirname, join } = require('node:path');
const { FIXTURE_DRIVE, FIXTURE_INTERRUPT, FIXTURE_COMMANDS } = process.env;
const args = process.argv.slice(2);
const [op] = args;
const operands = args.slice(args.includes('--') ? args.indexOf('--') + 1 : 2);
const remote = (value) => join(FIXTURE_DRIVE, value.slice(value.indexOf(':') + 1));
fs.appendFileSync(FIXTURE_COMMANDS, JSON.stringify([op, ...operands]) + '\\n');
switch (op) {
    case 'copy':
        fs.cpSync(operands[0], remote(operands[1]), { recursive: true });
        break;
    case 'lsjson': {
        const dir = remote(operands[0]);
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        console.log(JSON.stringify(entries.map((entry) => ({
            Name: entry.name, IsDir: entry.isDirectory(), ID: String(fs.statSync(join(dir, entry.name)).ino),
        }))));
        break;
    }
    case 'cat':
        process.stdout.write(fs.readFileSync(remote(operands[0])));
        break;
    case 'copyto': {
        const target = remote(operands[1]);
        fs.mkdirSync(dirname(target), { recursive: true });
        fs.copyFileSync(operands[0], target, fs.constants.COPYFILE_EXCL);
        if (fs.existsSync(FIXTURE_INTERRUPT)) {
            fs.unlinkSync(FIXTURE_INTERRUPT);
            process.exit(9);
        }
        break;
    }
    case 'deletefile':
        fs.unlinkSync(remote(operands[0]));
        break;
    default:
        process.exit(9);
}
`;

async function fixture(t) {
    const home = await fs.mkdtemp(join(tmpdir(), 'eformsign-provider-pending-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const archive = join(home, 'archive');
    const drive = join(home, 'drive');
    const stateDir = join(home, '.local/state/eformsign-backup');
    const statePath = join(stateDir, 'state.json');
    const journalPath = join(stateDir, 'provider-contract-migration/journal.json');
    const interrupt = join(home, 'interrupt');
    const commandLog = join(home, 'commands');
    const tokenFile = join(home, 'fixture-token');
    const rcloneBin = join(home, 'rclone');
    const settings = join(home, 'settings.json');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(join(stateDir, 'run.lock'), '');
    await fs.writeFile(tokenFile, 'synthetic-fixture-only');
    await fs.writeFile(rcloneBin, fakeDrive, { mode: 0o700 });

    const downloads = new Map();
    const listing = { items: [], incomplete: false };
    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname.endsWith('/documents')) {
            if (url.searchParams.has('cursor')) {
                res.writeHead(503).end();
                return;
            }
            res.end(JSON.stringify({ items: listing.items, nextCursor: listing.incomplete ? 'next' : null }));
        } else if (url.pathname.endsWith('/runs')) {
            req.resume();
            res.writeHead(201).end();
        } else {
            const bytes = downloads.get(decodeURIComponent(url.pathname.split('/').at(-1)));
            if (bytes) res.end(bytes);
            else res.writeHead(404).end();
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise((done) => server.close(done));
    });
    await fs.writeFile(settings, JSON.stringify({
        apiBaseUrl: `http://127.0.0.1:${server.address().port}`, tokenFile, archiveDir: archive, stateDir,
        rcloneRemote: 'drive:backup', rcloneBin,
    }));

    const doc = (id, revision = 1) => ({
        docId: id, title: `Fixture ${id}`, kind: 'other', createdAt: '2026-01-03T00:00:00Z', completed: true,
        providerContract: { signerName: `Fixture ${id}`, signedDate: '2026-01-02' },
        files: ['document', 'audit_trail'].map((fileType) => {
            const fileId = `${id}.${fileType}.${revision}`;
            const bytes = Buffer.from(`Synthetic PDF ${fileId}`);
            downloads.set(fileId, bytes);
            return { fileId, fileType, sha256: sha(bytes), byteSize: bytes.length };
        }),
    });
    const run = async (args = [], code = 0) => {
        const result = await exec(process.execPath, [script, '--settings', settings, ...args], {
            env: { ...process.env, HOME: home, FIXTURE_DRIVE: drive, FIXTURE_INTERRUPT: interrupt,
                FIXTURE_COMMANDS: commandLog },
        }).catch((error) => error);
        assert.equal(result.code ?? 0, code, result.stdout + result.stderr);
        return JSON.parse(result.stdout.trim().split('\n').at(-1));
    };
    const a = doc('a');
    const b = doc('b');
    const oldApi = (document) => ({ ...document, providerContract: undefined });
    const healthy = [a, oldApi(b)];
    listing.items = [oldApi(a), oldApi(b)];
    assert.equal((await run()).status, 'success');
    listing.items = healthy;

    const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
    const state = () => readJson(statePath);
    const journal = () => readJson(journalPath);
    const filePath = (path, remote) => join(remote ? join(drive, 'backup') : archive, path);
    const expectFile = async (path, file, remote) => {
        assert.equal(sha(await fs.readFile(filePath(path, remote))), file.sha256);
    };
    const expectMissing = (path, remote) => assert.rejects(fs.stat(filePath(path, remote)), { code: 'ENOENT' });
    const expectPair = async (paths, document) => {
        for (const remote of [false, true]) {
            for (const [index, path] of paths.entries()) await expectFile(path, document.files[index], remote);
        }
    };
    const snapshot = async () => {
        const paths = [statePath];
        for (const root of [archive, drive, dirname(journalPath)]) {
            const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
                .catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
            paths.push(...entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)));
        }
        return Promise.all(paths.sort().map(async (path) => [path, (await fs.stat(path)).ino, sha(await fs.readFile(path))]));
    };
    const commands = async () => (await fs.readFile(commandLog, 'utf8')).trim().split('\n').map(JSON.parse);
    const startPending = async () => {
        const before = await state();
        await fs.writeFile(interrupt, '');
        assert.equal((await run(apply, 1)).reason, 'drive_command_failed');
        const pending = await journal();
        assert.equal(pending.phase, 'applying');
        assert.deepEqual(pending.moves.map((move) => move.key), ['doc:a']);
        assert.deepEqual(pending.moves[0].files.map((file) => file.new), provider('a'));
        assert.deepEqual(await state(), before);
        await expectPair(legacy('a'), a);
        await expectFile(provider('a')[0], a.files[0], false);
        await expectFile(provider('a')[0], a.files[0], true);
        await expectMissing(provider('a')[1], false);
        await expectMissing(provider('a')[1], true);
        return pending;
    };
    return { a, b, doc, oldApi, healthy, listing, run, startPending, journal, journalPath, state, statePath,
        filePath, expectPair, expectMissing, snapshot, commands };
}

const recoveryCases = [
    ['empty listing', () => []],
    ['old API without provider metadata', (f) => [f.oldApi(f.a)]],
    ['changed signer and signing date', (f) => [{ ...f.a, providerContract: {
        signerName: 'Changed Fixture', signedDate: '2026-02-02',
    } }]],
    ['incomplete listing', (f) => [f.a], true],
    ['duplicate document rows', (f) => [f.a, f.a]],
    ['changed revision and newly eligible legacy pair', (f) => [f.doc('a', 2), f.b]],
];

for (const [name, rows, incomplete = false] of recoveryCases) {
    test(`pending apply resumes after first Drive copy with ${name}`, async (t) => {
        const f = await fixture(t);
        const pending = await f.startPending();
        const unrelated = (await f.state()).units['doc:b'];
        f.listing.items = rows(f);
        f.listing.incomplete = incomplete;

        assert.deepEqual(await f.run(apply), { migration: 'apply', pairs: 1, skipped: 0 });
        const applied = await f.journal();
        assert.equal(applied.phase, 'applied');
        assert.equal(applied.id, pending.id);
        assert.equal(applied.moves.length, 1);
        const [move] = applied.moves;
        assert.equal(move.key, 'doc:a');
        assert.deepEqual(move.before, pending.moves[0].before);
        assert.deepEqual(move.after, pending.moves[0].after);
        assert.deepEqual((await f.state()).units, { 'doc:a': move.after, 'doc:b': unrelated });
        await f.expectPair(provider('a'), f.a);
        await f.expectPair(legacy('b'), f.b);
        for (const remote of [false, true]) {
            for (const path of [...legacy('a'), ...provider('b')]) await f.expectMissing(path, remote);
        }
        const mutations = (await f.commands()).filter(([op]) => op === 'copyto' || op === 'deletefile');
        assert.deepEqual(mutations.map(([op, ...paths]) => [op, paths.at(-1)]), [
            ...provider('a').map((path) => ['copyto', `drive:backup/${path}`]),
            ...legacy('a').map((path) => ['deletefile', `drive:backup/${path}`]),
        ]);

        f.listing.items = f.healthy;
        f.listing.incomplete = false;
        assert.equal((await f.run()).status, 'success');
        assert.deepEqual(await f.journal(), applied);
        await f.expectPair(provider('a'), f.a);
        await f.expectPair(legacy('b'), f.b);
    });
}

test('fresh apply refuses an incomplete listing before planning eligible moves', async (t) => {
    const f = await fixture(t);
    const before = await f.snapshot();
    const commands = await f.commands();
    f.listing.incomplete = true;
    assert.equal((await f.run(apply, 1)).reason, 'incomplete_listing');
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual(await f.commands(), commands);
    await assert.rejects(fs.stat(f.journalPath), { code: 'ENOENT' });
});

const refusalCases = [
    ['changed committed state', 'allocation_changed', async (f) => {
        const state = await f.state();
        state.units['doc:a'].fingerprint = f.doc('a', 2).files.map((file) => file.sha256).join(':');
        await fs.writeFile(f.statePath, JSON.stringify(state));
    }],
    ['changed local legacy bytes', 'local_checksum_mismatch', (f) =>
        fs.writeFile(f.filePath(legacy('a')[1], false), Buffer.alloc(f.a.files[1].byteSize))],
    ['changed Drive legacy bytes', 'drive_checksum_mismatch', (f) =>
        fs.writeFile(f.filePath(legacy('a')[1], true), Buffer.alloc(f.a.files[1].byteSize))],
    ['replaced local target inode', 'local_target_collision', (f) =>
        replaceWithCopy(f.filePath(provider('a')[0], false))],
    ['replaced Drive source identity', 'drive_identity_changed', (f) =>
        replaceWithCopy(f.filePath(legacy('a')[0], true))],
];

async function replaceWithCopy(path) {
    const replacement = `${path}.replacement`;
    await fs.copyFile(path, replacement);
    await fs.rename(replacement, path);
}

for (const [name, reason, mutate] of refusalCases) {
    test(`pending apply refuses ${name} and preserves files with an empty listing`, async (t) => {
        const f = await fixture(t);
        const pending = await f.startPending();
        f.listing.items = [];
        await mutate(f);
        const before = await f.snapshot();
        const commandCount = (await f.commands()).length;

        assert.equal((await f.run(apply, 1)).reason, reason);
        assert.deepEqual(await f.snapshot(), before);
        assert.deepEqual(await f.journal(), pending);
        assert.ok((await f.commands()).slice(commandCount).every(([op]) => op === 'lsjson' || op === 'cat'));
    });
}
