import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const worker = fileURLToPath(new URL('../eformsign-backup/backup.mjs', import.meta.url));
const execute = promisify(execFile);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
const legacyPair = pair('기타', '합성 계약서');
const providerPair = (suffix = '') => pair('제공인력 계약서', `제공인력_계약서_합성_2026-05-01${suffix}`);
const sentinel = '기타/scratch.pdf.7121165c-32a1-4289-9f16-8d26882479a1.tmp';

const preload = `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const { fixtureInput, interrupt, stagedSource } = process.env;
const data = JSON.parse(await fs.readFile(fixtureInput, 'utf8'));
globalThis.fetch = async (url) => {
    const segment = decodeURIComponent(url.pathname.split('/').at(-1));
    if (segment === 'documents') {
        return data.listFailed ? new Response(null, { status: 503 })
            : Response.json({ items: data.items, nextCursor: null });
    }
    if (segment === 'runs') return new Response(null, { status: 201 });
    return data.unavailable?.includes(segment) ? new Response(null, { status: 404 }) : new Response(segment);
};

const { link, open, rename, unlink, rm, rmdir, writeFile } = fs;
let count = 0;
let firstSource;
const crash = () => process.exit(137);
let stages = 0;
fs.open = async (path, flags, ...args) => {
    const handle = await open(path, flags, ...args);
    if (flags !== 'wx' || !path.endsWith('/payload.stage')) return handle;
    stages += 1;
    if (interrupt === 'before ownership receipt') crash();
    const write = handle.writeFile.bind(handle);
    const sync = handle.sync.bind(handle);
    let hasBytes = false;
    handle.writeFile = async (chunk, ...options) => {
        if (interrupt === 'before content write') crash();
        if (interrupt === 'partial stage write') {
            await write(chunk.subarray(0, 5), ...options);
            crash();
        }
        await write(chunk, ...options);
        hasBytes = true;
    };
    handle.sync = async () => {
        await sync();
        if (hasBytes && interrupt === 'after stage ' + stages) crash();
    };
    return handle;
};
fs.link = async (source, target) => {
    count += 1;
    if (count === 1) {
        firstSource = source;
        await writeFile(stagedSource, source);
        if (interrupt === 'before first link') crash();
    }
    if (count === 2 && interrupt === 'fail second link') throw new Error('synthetic second link failure');
    await link(source, target);
    if ((count === 1 && interrupt === 'between links') ||
        (count === 2 && interrupt === 'after both links')) crash();
};
fs.rename = async (source, target) => {
    await rename(source, target);
    if (interrupt === 'after journal rename' && target.endsWith('/provider-contract-publication.json')) crash();
};
for (const [operation, real] of [['unlink', unlink], ['rm', rm]]) {
    fs[operation] = async (path, ...args) => {
        if (operation === 'unlink' && interrupt === 'before ownership removal'
            && path.endsWith('/provider-contract-prepared-stages.json')) crash();
        await real(path, ...args);
        if (interrupt === 'during cleanup' && path === firstSource) crash();
        if (operation === 'unlink' && interrupt === 'after pending payload unlink'
            && path.endsWith('/payload.stage')) crash();
    };
}
fs.rmdir = async (path, ...args) => {
    await rmdir(path, ...args);
    if (interrupt === 'after pending stage rmdir' && path.split('/').at(-1).startsWith('.provider-publication-')) crash();
};
syncBuiltinESMExports();
`;

const fakeDrive = `#!/usr/bin/env node
const fs = require('node:fs');
const { dirname, join } = require('node:path');
const { copyLog } = process.env;
const args = process.argv.slice(2);
const [op, checksum, source, destination, ...flags] = args;
if (op !== 'copy' || checksum !== '--checksum' ||
    (flags.length && JSON.stringify(flags) !== '["--include","*.pdf"]')) process.exit(9);
fs.appendFileSync(copyLog, JSON.stringify(args) + '\\n');
for (const path of fs.readdirSync(source, { recursive: true })) {
    const from = join(source, path);
    if (!fs.lstatSync(from).isFile() || (flags.length && !path.endsWith('.pdf'))) continue;
    const to = join(destination, path);
    const { atime, mtime } = fs.statSync(from);
    fs.mkdirSync(dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.utimesSync(to, atime, mtime);
}
`;

function document(revision, { named = true, completed = true } = {}) {
    return {
        docId: 'synthetic', title: '합성 계약서', kind: 'other', completed,
        createdAt: `2026-05-0${revision + 1}T01:02:03Z`,
        providerContract: named ? { signerName: '합성', signedDate: '2026-05-01' } : undefined,
        files: ['document', 'audit_trail'].map((fileType) => {
            const fileId = `fixture-${revision}-${fileType}`;
            return { fileType, fileId, byteSize: Buffer.byteLength(fileId), sha256: hash(fileId) };
        }),
    };
}

async function fixture(t) {
    const root = await fs.mkdtemp(join(tmpdir(), 'provider-publication-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const archive = join(root, 'archive');
    const stateDir = join(root, 'state');
    const statePath = join(stateDir, 'state.json');
    const lock = join(stateDir, 'run.lock');
    const drive = join(root, 'drive');
    const copyLog = join(root, 'copies');
    const fixtureInput = join(root, 'input.json');
    const stagedSource = join(root, 'staged-source');
    const tokenFile = join(root, 'synthetic-token');
    const settingsPath = join(root, 'settings.json');
    const importPath = join(root, 'preload.mjs');
    const rcloneBin = join(root, 'rclone');
    const env = { ...process.env, copyLog, fixtureInput, stagedSource };
    await fs.mkdir(stateDir);
    await fs.writeFile(copyLog, '');
    await fs.writeFile(tokenFile, 'synthetic-token-only');
    await fs.writeFile(importPath, preload);
    await fs.writeFile(rcloneBin, fakeDrive, { mode: 0o700 });
    await fs.writeFile(settingsPath, JSON.stringify({
        apiBaseUrl: 'http://127.0.0.1', archiveDir: archive, stateDir, tokenFile, rcloneRemote: drive, rcloneBin,
    }));
    const run = async (doc, { interrupt = '', code = 0, listFailed, unavailable } = {}) => {
        await fs.writeFile(fixtureInput, JSON.stringify({ items: doc ? [doc] : [], listFailed, unavailable }));
        const result = await execute('/usr/bin/flock', ['-n', lock, process.execPath, '--import', importPath,
            worker, '--settings', settingsPath], { env: { ...env, interrupt }, timeout: 10000 })
            .then((value) => ({ ...value, code: 0 })).catch((error) => error);
        assert.equal(result.code, code, result.stdout || result.stderr);
        return result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
    };
    const stateBytes = () => fs.readFile(statePath);
    return {
        archive, drive, run, stateBytes, stagedSource: () => fs.readFile(stagedSource, 'utf8'),
        ownershipPath: join(stateDir, 'provider-contract-prepared-stages.json'),
        journalBytes: () => fs.readFile(join(stateDir, 'provider-contract-publication.json')),
        state: async () => JSON.parse(await stateBytes()),
        writeState: (state) => fs.writeFile(statePath, JSON.stringify(state)),
        copies: async () => (await fs.readFile(copyLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
        async seedScratch() {
            const path = join(archive, sentinel);
            await fs.mkdir(dirname(path), { recursive: true });
            await fs.writeFile(path, 'previous scratch');
        },
        async copyWithoutInclude() {
            const destination = join(root, 'unfiltered');
            await execute(rcloneBin, ['copy', '--checksum', archive, destination], { env });
            assert.equal(await fs.readFile(join(destination, sentinel), 'utf8'), 'previous scratch');
        },
    };
}

async function expectArchive(f, entries, retained = []) {
    const expectedPaths = entries.flatMap(([paths]) => paths).sort();
    for (const root of [f.archive, f.drive]) {
        const tree = (await fs.readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => {
            const topLevel = join(entry.parentPath, entry.name).slice(root.length + 1).split('/')[0];
            return root !== f.archive || !retained.includes(topLevel);
        });
        assert.ok(!tree.some((entry) => entry.name.startsWith('.provider-publication-')));
        const files = tree
            .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
        assert.deepEqual(files.sort(), root === f.archive ? [...expectedPaths, sentinel].sort() : expectedPaths);
        for (const [paths, doc] of entries) {
            for (const [index, path] of paths.entries()) {
                const file = join(root, path);
                assert.equal((await fs.stat(file)).mtimeMs, Date.parse(doc.createdAt));
                const bytes = await fs.readFile(file);
                assert.equal(bytes.toString(), doc.files[index].fileId);
                assert.equal(hash(bytes), doc.files[index].sha256);
            }
        }
    }
}

const boundaries = ['after journal rename', 'before first link', 'between links', 'after both links', 'during cleanup'];
for (const [transition, previous, priorPaths, expected] of [
    ['named review transition', document(1, { named: false, completed: false }), legacyPair, providerPair()],
    ['completed-content fork', document(1), providerPair(), providerPair(' (2)')],
]) {
    for (const interrupt of [...boundaries, 'normal run']) {
        test(`${transition} retains its exact pair: ${interrupt}`, async (t) => {
            const f = await fixture(t);
            const current = document(2);
            await f.run(previous);
            const before = await f.stateBytes();
            await f.seedScratch();
            if (interrupt !== 'normal run') {
                await f.run(current, { interrupt, code: 137 });
                assert.equal((await f.copies()).length, 1);
                if (interrupt !== 'during cleanup') assert.deepEqual(await f.stateBytes(), before);
                else assert.deepEqual(Object.keys((await f.state()).units['doc:synthetic'].files), expected);
            } else {
                await f.copyWithoutInclude();
            }
            const result = await f.run(current);
            assert.equal(result.at(-1).status, 'success');
            const after = await f.state();
            // On the unfixed worker the retry reports success but this is the suffixed pair.
            assert.deepEqual(Object.keys(after.units['doc:synthetic'].files), expected);
            assert.equal(Object.keys(after.units).length, 2);
            assert.deepEqual(Object.values(after.units).find((unit) => unit !== after.units['doc:synthetic']),
                JSON.parse(before).units['doc:synthetic']);
            await expectArchive(f, [[priorPaths, previous], [expected, current]]);
            await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
            const stable = await f.stateBytes();
            await f.run(current);
            assert.deepEqual(await f.stateBytes(), stable);
            await expectArchive(f, [[priorPaths, previous], [expected, current]]);
        });
    }
}

test('a second link failure in the same run blocks Drive until the pair is recovered', async (t) => {
    const f = await fixture(t);
    const previous = document(1, { named: false, completed: false });
    const current = document(2);
    const paths = providerPair();
    await f.run(previous);
    await f.seedScratch();
    const state = await f.stateBytes();
    const copies = await f.copies();

    const result = await f.run(current, { interrupt: 'fail second link', code: 1 });
    assert.equal(result[0].reason, 'synthetic second link failure');
    assert.deepEqual(await f.copies(), copies);
    assert.deepEqual(await f.stateBytes(), state);
    assert.deepEqual(Object.keys(JSON.parse(await f.journalBytes()).next.files), paths);
    assert.equal(await fs.readFile(join(f.archive, paths[0]), 'utf8'), current.files[0].fileId);
    await assert.rejects(fs.stat(join(f.archive, paths[1])), { code: 'ENOENT' });
    for (const path of paths) await assert.rejects(fs.stat(join(f.drive, path)), { code: 'ENOENT' });

    await f.run(current);
    await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
    await expectArchive(f, [[legacyPair, previous], [paths, current]]);
});

for (const [reason, changeState] of [
    ['state_changed', (state, intent) => { state.units[intent.key].completed = true; }],
    ['shared_archive_path', (state, intent) => { state.units['doc:other'] = intent.next; }],
]) {
    test(`resume refuses ${reason} and preserves the pending pair without uploading`, async (t) => {
        const f = await fixture(t);
        const previous = document(1, { named: false, completed: false });
        const current = document(2);
        await f.run(previous);
        await f.run(current, { interrupt: 'between links', code: 137 });
        const journal = await f.journalBytes();
        const state = await f.state();
        changeState(state, JSON.parse(journal));
        await f.writeState(state);
        const stateBytes = await f.stateBytes();
        const copies = await f.copies();
        const paths = providerPair();
        const first = join(f.archive, paths[0]);
        const { ino, nlink } = await fs.stat(first);

        const result = await f.run(current, { code: 1 });
        assert.equal(result[0].reason, `provider_publication_${reason}`);
        assert.deepEqual(await f.stateBytes(), stateBytes);
        assert.deepEqual(await f.journalBytes(), journal);
        assert.deepEqual(await f.copies(), copies);
        const after = await fs.stat(first);
        assert.equal(after.ino, ino);
        assert.equal(after.nlink, nlink);
        assert.equal(await fs.readFile(first, 'utf8'), current.files[0].fileId);
        await assert.rejects(fs.stat(join(f.archive, paths[1])), { code: 'ENOENT' });
        for (const path of paths) await assert.rejects(fs.stat(join(f.drive, path)), { code: 'ENOENT' });
    });
}

for (const occupied of ['destination', 'staged file']) {
    test(`pending publication refuses an unrelated same-byte inode at its ${occupied}`, async (t) => {
        const f = await fixture(t);
        const previous = document(1, { named: false, completed: false });
        const current = document(2);
        await f.run(previous);
        await f.run(current, { interrupt: 'between links', code: 137 });
        const target = occupied === 'destination' ? join(f.archive, providerPair()[0]) : await f.stagedSource();
        const owned = await fs.stat(target);
        const replacement = `${target}.replacement`;
        const original = await fs.readFile(target);
        await fs.copyFile(target, replacement);
        await fs.utimes(replacement, owned.atime, owned.mtime);
        await fs.rename(replacement, target);
        const unrelated = await fs.stat(target);
        assert.notEqual(unrelated.ino, owned.ino);
        const state = await f.stateBytes();
        const journal = await f.journalBytes();
        const copies = await f.copies();
        const result = await f.run(current, { code: 1 });
        assert.equal(result[0].reason, 'provider_publication_path_collision');
        assert.deepEqual(await f.stateBytes(), state);
        assert.deepEqual(await f.journalBytes(), journal);
        assert.deepEqual(await f.copies(), copies);
        assert.deepEqual(await fs.readFile(target), original);
        const after = await fs.stat(target);
        assert.equal(after.ino, unrelated.ino);
        assert.equal(after.ctimeMs, unrelated.ctimeMs);
        assert.equal(await fs.readFile(join(f.archive, legacyPair[0]), 'utf8'), previous.files[0].fileId);
        assert.equal(await fs.readFile(join(f.archive, legacyPair[1]), 'utf8'), previous.files[1].fileId);
        await assert.rejects(fs.stat(join(f.archive, providerPair()[1])), { code: 'ENOENT' });
        await assert.rejects(fs.stat(join(f.drive, providerPair()[0])), { code: 'ENOENT' });
    });
}

for (const listing of ['absent', 'failed', 'changed']) {
    test(`recovers verified artifacts when the current listing is ${listing}`, async (t) => {
        const f = await fixture(t);
        const previous = document(1, { named: false, completed: false });
        previous.files.pop(); // Old API review without an audit trail.
        const interrupted = document(2);
        const newer = listing === 'changed' ? document(3) : undefined;
        await f.run(previous);
        await f.seedScratch();
        await f.run(interrupted, { interrupt: 'between links', code: 137 });
        // The original downloads are unavailable. For the changed-listing case the fake
        // serves only the newer document, so replay cannot silently fetch the former bytes.
        const result = await f.run(newer, { listFailed: listing === 'failed',
            unavailable: interrupted.files.map(({ fileId }) => fileId), code: listing === 'failed' ? 1 : 0 });
        assert.equal(result.at(-1).status, listing === 'failed' ? 'failed' : 'success');
        const entries = [[legacyPair.slice(0, 1), previous], [providerPair(), interrupted]];
        if (newer) entries.push([providerPair(' (2)'), newer]);
        await expectArchive(f, entries);
        await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
        const stable = await f.stateBytes();
        assert.equal(Object.keys(JSON.parse(stable).units).length, entries.length);
        await f.run(newer);
        assert.deepEqual(await f.stateBytes(), stable);
    });
}

test('missing staged bytes refuse without upload, then retry the same reservation', async (t) => {
    const f = await fixture(t);
    const previous = document(1, { named: false, completed: false });
    const current = document(2);
    await f.run(previous);
    await f.seedScratch();
    await f.run(current, { interrupt: 'before first link', code: 137 });
    await fs.unlink(await f.stagedSource());
    const state = await f.stateBytes();
    const journal = await f.journalBytes();
    const copies = await f.copies();
    const result = await f.run(undefined, { listFailed: true, unavailable: [current.files[0].fileId], code: 1 });
    assert.equal(result[0].reason, 'provider_publication_staged_file_unavailable');
    assert.deepEqual(await f.stateBytes(), state);
    assert.deepEqual(await f.journalBytes(), journal);
    assert.deepEqual(await f.copies(), copies);
    await assert.rejects(fs.stat(join(f.archive, providerPair()[0])), { code: 'ENOENT' });
    await assert.rejects(fs.stat(join(f.archive, providerPair()[1])), { code: 'ENOENT' });
    await f.run(current);
    await expectArchive(f, [[legacyPair, previous], [providerPair(), current]]);
});

test('a journal-owned stage with altered bytes is preserved and blocks copying', async (t) => {
    const f = await fixture(t);
    const previous = document(1, { named: false, completed: false });
    const current = document(2);
    await f.run(previous);
    await f.run(current, { interrupt: 'before first link', code: 137 });
    const source = await f.stagedSource();
    const info = await fs.stat(source);
    const altered = Buffer.alloc(info.size, 0x41);
    await fs.writeFile(source, altered);
    await fs.utimes(source, info.atime, info.mtime);
    const state = await f.stateBytes();
    const result = await f.run(current, { code: 1 });
    assert.equal(result[0].reason, 'provider_publication_content_mismatch');
    assert.equal((await fs.stat(source)).ino, info.ino);
    assert.deepEqual(await fs.readFile(source), altered);
    assert.deepEqual(await f.stateBytes(), state);
    assert.equal((await f.copies()).length, 1);
    await assert.rejects(fs.stat(join(f.archive, providerPair()[0])), { code: 'ENOENT' });
});

async function forkFixture(t) {
    const f = await fixture(t);
    const previous = document(1, { named: false, completed: false });
    const current = document(2);
    await f.run(previous);
    await f.seedScratch();
    return { ...f, current, entries: [[legacyPair, previous], [providerPair(), current]] };
}

async function stagedPayloads(archive) {
    const entries = await fs.readdir(archive, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('.provider-publication-'))
        .map((entry) => join(archive, entry.name, 'payload.stage'));
}

async function assertStablePublication(f, retained = []) {
    await expectArchive(f, f.entries, retained);
    await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(f.ownershipPath), { code: 'ENOENT' });
    const state = await f.stateBytes();
    await f.run(f.current);
    assert.deepEqual(await f.stateBytes(), state);
    await expectArchive(f, f.entries, retained);
}

for (const [interrupt, expectedContents] of [
    ['after stage 1', (doc) => [doc.files[0].fileId]],
    ['after stage 2', (doc) => doc.files.map(({ fileId }) => fileId)],
    ['partial stage write', (doc) => [doc.files[0].fileId.slice(0, 5)]],
    ['before content write', () => ['']],
]) {
    test(`retry removes orphan payloads from ${interrupt} before the publication journal`, async (t) => {
        const f = await forkFixture(t);
        const state = await f.stateBytes();
        const copies = await f.copies();
        await f.run(f.current, { interrupt, code: 137 });
        const staged = await stagedPayloads(f.archive);
        const contents = await Promise.all(staged.map((path) => fs.readFile(path, 'utf8')));
        assert.deepEqual(contents.sort(), expectedContents(f.current).sort());
        await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
        assert.deepEqual(await f.stateBytes(), state);
        assert.deepEqual(await f.copies(), copies);

        const result = await f.run(f.current);
        assert.equal(result.at(-1).status, 'success');
        for (const path of staged) {
            await assert.rejects(fs.lstat(path), { code: 'ENOENT' }, 'orphan payload survived retry');
            await assert.rejects(fs.lstat(dirname(path)), { code: 'ENOENT' });
        }
        await assertStablePublication(f);
    });
}

async function foreignScratch(f) {
    const names = ['.provider-publication-fake01', '.provider-publication-fake02', '.provider-publication-fake03'];
    const [directory, file, symlink] = names.map((name) => join(f.archive, name));
    const payload = join(directory, 'payload.stage');
    const external = join(dirname(f.archive), 'external-sentinel');
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(payload, f.current.files[0].fileId, { mode: 0o600 });
    await fs.writeFile(file, 'foreign file', { mode: 0o600 });
    await fs.writeFile(external, 'external sentinel', { mode: 0o600 });
    await fs.symlink(external, symlink);
    const paths = [directory, payload, file, symlink, external];
    const inodes = await Promise.all(paths.map(async (path) => (await fs.lstat(path)).ino));
    return {
        names,
        async verify() {
            assert.deepEqual(await Promise.all(paths.map(async (path) => (await fs.lstat(path)).ino)), inodes);
            assert.equal(await fs.readFile(payload, 'utf8'), f.current.files[0].fileId);
            assert.equal(await fs.readFile(file, 'utf8'), 'foreign file');
            assert.equal(await fs.readlink(symlink), external);
            assert.equal(await fs.readFile(external, 'utf8'), 'external sentinel');
        },
    };
}

test('an empty stage allocated before the first ownership receipt remains untouched', async (t) => {
    const f = await forkFixture(t);
    await f.run(f.current, { interrupt: 'before ownership receipt', code: 137 });
    const [path, ...rest] = await stagedPayloads(f.archive);
    assert.deepEqual(rest, []);
    assert.equal((await fs.stat(path)).size, 0);
    const inode = (await fs.stat(path)).ino;
    const directoryInode = (await fs.stat(dirname(path))).ino;
    await assert.rejects(fs.lstat(f.ownershipPath), { code: 'ENOENT' });
    await assert.rejects(f.journalBytes(), { code: 'ENOENT' });

    await f.run(f.current);
    await assertStablePublication(f, [dirname(path).split('/').at(-1)]);
    assert.equal((await fs.stat(dirname(path))).ino, directoryInode);
    assert.equal((await fs.stat(path)).ino, inode);
    assert.equal((await fs.stat(path)).size, 0);
});

test('normal publication ignores independently allocated same-prefix files, directories, and symlinks', async (t) => {
    const f = await forkFixture(t);
    const foreign = await foreignScratch(f);
    await f.run(f.current);
    await foreign.verify();
    await assertStablePublication(f, foreign.names);
    await foreign.verify();
});

for (const interrupt of ['after pending payload unlink', 'after pending stage rmdir']) {
    test(`abandoned stage cleanup is restartable ${interrupt}`, async (t) => {
        const f = await forkFixture(t);
        const foreign = await foreignScratch(f);
        const state = await f.stateBytes();
        const copies = await f.copies();
        await f.run(f.current, { interrupt: 'after stage 2', code: 137 });
        const receipt = await fs.readFile(f.ownershipPath);
        const paths = JSON.parse(receipt).stages.map(({ stage }) => join(f.archive, stage.name, 'payload.stage'));
        await f.run(f.current, { interrupt, code: 137 });

        await assert.rejects(fs.lstat(paths[0]), { code: 'ENOENT' });
        if (interrupt === 'after pending stage rmdir') await assert.rejects(fs.lstat(dirname(paths[0])), { code: 'ENOENT' });
        else assert.deepEqual(await fs.readdir(dirname(paths[0])), []);
        assert.equal(await fs.readFile(paths[1], 'utf8'), f.current.files[1].fileId);
        assert.deepEqual(await fs.readFile(f.ownershipPath), receipt);
        assert.deepEqual(await f.stateBytes(), state);
        assert.deepEqual(await f.copies(), copies);
        await foreign.verify();

        await f.run(f.current);
        for (const path of paths) await assert.rejects(fs.lstat(dirname(path)), { code: 'ENOENT' });
        await assertStablePublication(f, foreign.names);
        await foreign.verify();
    });
}

async function assertReplayUsesJournalInodes(f, intent, indexes) {
    for (const index of indexes) {
        const published = join(f.archive, providerPair()[index]);
        const { dev, ino, birthtimeNs } = await fs.stat(published, { bigint: true });
        assert.deepEqual({ dev: String(dev), ino: String(ino), birthtimeNs: String(birthtimeNs) },
            intent.files[index].inode);
    }
}

test('a durable publication journal takes ownership of both stages before receipt removal', async (t) => {
    const f = await forkFixture(t);
    const copies = await f.copies();
    await f.run(f.current, { interrupt: 'before ownership removal', code: 137 });
    const intent = JSON.parse(await f.journalBytes());
    const receipt = JSON.parse(await fs.readFile(f.ownershipPath));
    assert.deepEqual(receipt.stages, intent.files.map(({ stage, inode }) => ({ stage, inode })));
    assert.deepEqual(await f.copies(), copies);
    await f.run(undefined, { unavailable: f.current.files.map(({ fileId }) => fileId) });
    await assertReplayUsesJournalInodes(f, intent, [0, 1]);
    await assertStablePublication(f);
});

test('an original v1 intent without any ownership receipt still publishes its exact hardlinks', async (t) => {
    const f = await forkFixture(t);
    await f.run(f.current, { interrupt: 'after journal rename', code: 137 });
    const intent = JSON.parse(await f.journalBytes());
    // The original worker wrote this v1 shape with no separate receipt.
    const { archive, key, before, history, next, createdAt, files } = intent;
    assert.deepEqual(intent, { version: 1, archive, key, before, history, next, createdAt, files: files.map(
        ({ fileId, sha256, byteSize, stage: { name, inode: directoryInode }, inode }) =>
            ({ fileId, sha256, byteSize, stage: { name, inode: directoryInode }, inode }),
    ) });
    await fs.unlink(f.ownershipPath);
    await f.run(undefined, { unavailable: f.current.files.map(({ fileId }) => fileId) });
    await assertReplayUsesJournalInodes(f, intent, [0, 1]);
    await assertStablePublication(f);
});

for (const interrupt of ['partial stage write', 'before ownership removal']) {
    test(`a replacement stage can be recovered after ${interrupt} during resume`, async (t) => {
        const f = await forkFixture(t);
        await f.run(f.current, { interrupt: 'before first link', code: 137 });
        const originalJournal = await f.journalBytes();
        const originalIntent = JSON.parse(originalJournal);
        await fs.unlink(await f.stagedSource());
        const state = await f.stateBytes();
        const copies = await f.copies();
        await f.run(undefined, { interrupt, code: 137 });

        const receipt = JSON.parse(await fs.readFile(f.ownershipPath));
        assert.equal(receipt.stages.length, 1);
        const [replacement] = receipt.stages;
        const newPayload = join(f.archive, replacement.stage.name, 'payload.stage');
        const currentJournal = await f.journalBytes();
        const currentIntent = JSON.parse(currentJournal);
        const unavailable = [f.current.files[1].fileId];
        if (interrupt === 'partial stage write') {
            assert.equal(await fs.readFile(newPayload, 'utf8'), f.current.files[0].fileId.slice(0, 5));
            assert.deepEqual(currentJournal, originalJournal);
        } else {
            assert.equal(await fs.readFile(newPayload, 'utf8'), f.current.files[0].fileId);
            assert.notDeepEqual(currentIntent.files[0], originalIntent.files[0]);
            assert.deepEqual(currentIntent.files[0].stage, replacement.stage);
            unavailable.push(f.current.files[0].fileId);
        }
        assert.deepEqual(currentIntent.files[1], originalIntent.files[1]);
        assert.deepEqual(await f.stateBytes(), state);
        assert.deepEqual(await f.copies(), copies);
        await f.run(undefined, { unavailable });
        await assert.rejects(fs.lstat(dirname(newPayload)), { code: 'ENOENT' });
        await assertReplayUsesJournalInodes(f, currentIntent, interrupt === 'partial stage write' ? [1] : [0, 1]);
        await assertStablePublication(f);
    });
}

async function expectRecoveryRefusal(f, reason) {
    const state = await f.stateBytes();
    const copies = await f.copies();
    const result = await f.run(f.current, { code: 1 });
    assert.equal(result[0].reason, `provider_publication_${reason}`);
    assert.deepEqual(await f.stateBytes(), state);
    assert.deepEqual(await f.copies(), copies);
    const [paths, previous] = f.entries[0];
    for (const root of [f.archive, f.drive]) {
        for (const [index, path] of paths.entries()) {
            assert.equal(hash(await fs.readFile(join(root, path))), previous.files[index].sha256);
            assert.equal((await fs.stat(join(root, path))).mtimeMs, Date.parse(previous.createdAt));
        }
        for (const path of providerPair()) await assert.rejects(fs.lstat(join(root, path)), { code: 'ENOENT' });
    }
}

test('an ordinary download failure discards both prepared stages and preserves partial-run behavior', async (t) => {
    const f = await forkFixture(t);
    const state = await f.stateBytes();
    const copies = await f.copies();
    const result = await f.run(f.current, { unavailable: [f.current.files[1].fileId], code: 2 });
    assert.equal(result.at(-1).status, 'partial');
    assert.deepEqual(await f.stateBytes(), state);
    assert.equal((await f.copies()).length, copies.length + 1);
    await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(f.ownershipPath), { code: 'ENOENT' });
    await expectArchive(f, [f.entries[0]]);
    await f.run(f.current);
    await assertStablePublication(f);
});

for (const collision of ['same-byte payload', 'payload symlink', 'replaced directory', 'directory symlink', 'foreign directory entry']) {
    test(`abandoned stage recovery aborts without copying on a ${collision}`, async (t) => {
        const f = await forkFixture(t);
        await f.run(f.current, { interrupt: 'after stage 1', code: 137 });
        const [path] = await stagedPayloads(f.archive);
        const original = await fs.readFile(path);
        const receipt = await fs.readFile(f.ownershipPath);
        const external = join(dirname(f.archive), 'preserved');
        let survivor = path;
        let reason = 'prepared_payload_collision';
        if (collision === 'same-byte payload' || collision === 'payload symlink') {
            await fs.rename(path, external);
            if (collision === 'payload symlink') await fs.symlink(external, path);
            else await fs.writeFile(path, original, { mode: 0o600 });
        } else if (collision === 'foreign directory entry') {
            survivor = join(dirname(path), 'foreign.stage');
            await fs.writeFile(survivor, original, { mode: 0o600 });
            reason = 'prepared_directory_not_empty';
        } else {
            await fs.rename(dirname(path), external);
            if (collision === 'directory symlink') {
                survivor = dirname(path);
                await fs.symlink(external, survivor);
            } else {
                await fs.mkdir(dirname(path), { mode: 0o700 });
                await fs.writeFile(path, original, { mode: 0o600 });
            }
            reason = 'unsafe_staging_directory';
        }
        const { ino } = await fs.lstat(survivor);

        await expectRecoveryRefusal(f, reason);
        await assert.rejects(f.journalBytes(), { code: 'ENOENT' });
        assert.deepEqual(await fs.readFile(f.ownershipPath), receipt);
        assert.equal((await fs.lstat(survivor)).ino, ino);
        if (collision.endsWith('symlink')) assert.equal(await fs.readlink(survivor), external);
        else assert.deepEqual(await fs.readFile(survivor), original);
        if (collision.includes('directory') && collision !== 'foreign directory entry') {
            assert.deepEqual(await fs.readFile(join(external, 'payload.stage')), original);
        } else if (collision === 'foreign directory entry') {
            await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
        } else {
            assert.deepEqual(await fs.readFile(external), original);
        }
    });
}

for (const corruption of ['foreign archive', 'wrong archive inode', 'traversal', 'absolute path', 'unsafe permissions', 'symlink']) {
    test(`a prepared-stage receipt with ${corruption} blocks recovery and Drive`, async (t) => {
        const f = await forkFixture(t);
        await f.run(f.current, { interrupt: 'after stage 1', code: 137 });
        const receipt = JSON.parse(await fs.readFile(f.ownershipPath));
        const [prepared] = receipt.stages;
        let directory = join(f.archive, prepared.stage.name);
        let reason = 'invalid_prepared_stages';
        const external = join(dirname(f.archive), 'external-receipt');
        if (corruption === 'unsafe permissions') {
            await fs.chmod(f.ownershipPath, 0o644);
            reason = 'unsafe_prepared_stages';
        } else if (corruption === 'symlink') {
            await fs.rename(f.ownershipPath, external);
            await fs.symlink(external, f.ownershipPath);
            reason = 'unsafe_prepared_stages';
        } else {
            if (corruption === 'foreign archive') receipt.archive = dirname(f.archive);
            else if (corruption === 'wrong archive inode') receipt.archiveInode = prepared.stage.inode;
            else {
                const outside = join(dirname(f.archive), prepared.stage.name);
                await fs.rename(directory, outside);
                directory = outside;
                prepared.stage.name = corruption === 'traversal' ? `../${prepared.stage.name}` : outside;
            }
            await fs.writeFile(f.ownershipPath, JSON.stringify(receipt));
        }
        const savedReceipt = await fs.readFile(f.ownershipPath);
        const { ino } = await fs.lstat(f.ownershipPath);
        const sentinelPath = join(dirname(f.archive), 'external-sentinel');
        await fs.writeFile(sentinelPath, 'external sentinel');
        const path = join(directory, 'payload.stage');
        const payload = await fs.readFile(path);
        const payloadInode = (await fs.stat(path)).ino;

        await expectRecoveryRefusal(f, reason);
        assert.deepEqual(await fs.readFile(f.ownershipPath), savedReceipt);
        assert.equal((await fs.lstat(f.ownershipPath)).ino, ino);
        if (corruption === 'symlink') assert.equal(await fs.readlink(f.ownershipPath), external);
        assert.deepEqual(await fs.readFile(path), payload);
        assert.equal((await fs.stat(path)).ino, payloadInode);
        assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'external sentinel');
    });
}

test('a conflicting ownership claim never removes a journal-referenced stage', async (t) => {
    const f = await forkFixture(t);
    await f.run(f.current, { interrupt: 'before ownership removal', code: 137 });
    const journal = await f.journalBytes();
    const receipt = JSON.parse(await fs.readFile(f.ownershipPath));
    const second = receipt.stages[1];
    // Use a valid file identity, but pair it with a different journal-owned path.
    second.inode = receipt.stages[0].inode;
    await fs.writeFile(f.ownershipPath, JSON.stringify(receipt));
    await expectRecoveryRefusal(f, 'prepared_journal_collision');
    assert.deepEqual(await f.journalBytes(), journal);
    for (const [index, { stage }] of receipt.stages.entries()) {
        assert.equal(await fs.readFile(join(f.archive, stage.name, 'payload.stage'), 'utf8'),
            f.current.files[index].fileId);
    }
});
