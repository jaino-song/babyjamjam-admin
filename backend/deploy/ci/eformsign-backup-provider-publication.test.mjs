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

const { link, rename, unlink, rm, writeFile } = fs;
let count = 0;
let firstSource;
const crash = () => process.exit(137);
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
        await real(path, ...args);
        if (interrupt === 'during cleanup' && path === firstSource) crash();
    };
}
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

async function expectArchive(f, entries) {
    const expectedPaths = entries.flatMap(([paths]) => paths).sort();
    for (const root of [f.archive, f.drive]) {
        const tree = await fs.readdir(root, { recursive: true, withFileTypes: true });
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
