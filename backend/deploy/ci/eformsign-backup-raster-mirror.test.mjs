import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { describeRasterArchiveError, inspectRasterArchive, prepareRasterArchive, publishRasterArchive, rollbackRasterArchive } from '../eformsign-backup/raster-mirror.mjs';

const raw = (name) => Buffer.from('%PDF-1.7\nsynthetic signed ' + name);
const image = (source) => Buffer.concat([Buffer.from('%PDF-1.7\nimage\0\xff', 'latin1'), Buffer.from(sha(source), 'hex')]);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const mode = async (path) => (await fs.stat(path)).mode & 0o777;

async function assertRenderHandle(outputPath, outputHandle, empty = false) {
    assert.ok(outputHandle, 'the mirror must supply the caller-owned descriptor');
    const file = await fs.lstat(outputPath);
    const opened = await outputHandle.stat();
    assert.ok(file.isFile());
    assert.deepEqual([opened.dev, opened.ino, opened.nlink], [file.dev, file.ino, 1]);
    assert.deepEqual([file.nlink, file.mode & 0o777, file.uid], [1, 0o600, process.getuid()]);
    if (empty) assert.equal(file.size, 0);
    assert.deepEqual(await fs.readdir(dirname(outputPath)), ['output.pdf']);
}

async function writeRender(outputPath, outputHandle, bytes) {
    await assertRenderHandle(outputPath, outputHandle, true);
    assert.equal((await outputHandle.write(bytes, 0, bytes.length, 0)).bytesWritten, bytes.length);
    await outputHandle.sync();
    await assertRenderHandle(outputPath, outputHandle);
}

const localRcloneFlags = [
    '--retries', '1', '--low-level-retries', '2', '--contimeout', '10s', '--timeout', '45s',
    '--log-level', 'ERROR', '--log-file=', '--drive-skip-dangling-shortcuts=false',
    '--drive-use-trash=true', '--local-unicode-normalization=false', '--links=true', '--copy-links=false',
    '--drive-skip-shortcuts=true',
];

const fake = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, 'drive');
const controlPath = path.join(__dirname, 'control.json');
const control = JSON.parse(fs.readFileSync(controlPath));
const [command, ...args] = process.argv.slice(2);
const stop = () => { console.error('private stderr test marker'); process.exit(4); };
const at = args.indexOf('--');
const operands = args.slice(at + 1);
const flags = args.slice(0, at);
const common = ${JSON.stringify(localRcloneFlags)};
const expected = {
    listremotes: [['--long']],
    lsjson: [[], ['--stat'], ['--hash-type', 'MD5'], ['--recursive', '--hash-type', 'MD5']],
    cat: [[]],
    copyto: [['--ignore-times']],
    deletefile: [[]],
};
const valid = Object.hasOwn(expected, command) && expected[command].some((specific) =>
    JSON.stringify(flags) === JSON.stringify(specific.concat(common)));
const operandCount = command === 'listremotes' ? 0 : command === 'copyto' ? 2 : 1;
if (at < 0 || !valid || operands.length !== operandCount) stop();
function getKey(operand) {
    if (!operand.startsWith('fake:')) stop();
    const key = operand.slice(5);
    if (key.startsWith('/') || key.split('/').includes('..')) stop();
    return key;
}
const key = command === 'listremotes' ? null : getKey(operands.at(-1));
let locked = false;
try { fs.fstatSync(3); locked = fs.readlinkSync('/proc/self/fd/3') === path.join(__dirname, 'lock'); } catch {}
const hash = (bytes, kind = 'sha256') => crypto.createHash(kind).update(bytes).digest('hex');
const input = command === 'copyto' ? fs.readFileSync(operands[0]) : null;
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ command, key, locked, sha: input && hash(input), flags }) + '\n');
if (command === 'listremotes') {
    process.stdout.write('fake: local\n');
    process.exit(0);
}
const file = path.join(root, key);
function info(key, relative) {
    const full = path.join(root, key);
    const stat = fs.lstatSync(full);
    const isDir = stat.isDirectory();
    const md5 = flags.includes('--hash-type') && !isDir && !control.noHashes && hash(fs.readFileSync(full), 'md5');
    return {
        Name: path.basename(relative), Path: relative, IsDir: isDir, Size: isDir ? -1 : stat.size,
        ...(control.noMtime ? {} : { ModTime: stat.mtime.toISOString() }),
        ...(control.noIds ? {} : { ID: control.ids?.[key] ?? 'id:' + key }),
        ...(md5
            ? { Hashes: control.hashes === undefined ? { md5 } : JSON.parse(control.hashes.replaceAll('DIGEST', md5)) } : {}),
    };
}
function list(base, prefix = '') {
    return fs.readdirSync(path.join(root, base, prefix)).flatMap((name) => {
        const relative = prefix ? prefix + '/' + name : name;
        const key = base ? base + '/' + relative : relative;
        const entry = info(key, relative);
        const records = control.duplicate === key ? [entry, { ...entry, ID: 'duplicate' }] : [entry];
        return entry.IsDir && flags.includes('--recursive') ? records.concat(list(base, relative)) : records;
    });
}
if (command === 'lsjson') {
    if (control.listFail || !fs.existsSync(file)) stop();
    const result = flags.includes('--stat') ? info(key, key) : list(key);
    process.stdout.write(JSON.stringify(result));
    if (control.warnOnRecursiveList && flags.includes('--recursive')) {
        if (!result.length) stop();
        process.stderr.write('ERROR : QA-synthetic-customer.pdf: incomplete listing\n');
    }
} else if (command === 'cat') {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) stop();
    process.stdout.write(fs.readFileSync(file));
} else {
    if (control.failBefore === command) stop();
    if (command === 'copyto') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, input);
        const source = fs.statSync(operands[0]);
        if (!control.resetMtimeOnCopy) fs.utimesSync(file, source.atime, source.mtime);
        if (control.changeIdOnCopy) {
            control.ids = { ...control.ids, [key]: 'replacement-id' };
            fs.writeFileSync(controlPath, JSON.stringify(control));
        }
        if (control.duplicateOnCopy) {
            control.duplicate = key;
            fs.writeFileSync(controlPath, JSON.stringify(control));
        }
    } else {
        fs.unlinkSync(file);
    }
    if (control.failAfter === command) stop();
}
`;

async function put(root, name, bytes) {
    const path = join(root, name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, bytes);
    return path;
}

async function fixture(t, { localOnly = false, defaultOriginals = false } = {}) {
    const root = await fs.mkdtemp(join(tmpdir(), 'raster-mirror-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const settings = {
        archiveDir: join(root, 'visible'),
        stateDir: join(root, 'state'),
        ...(!defaultOriginals && { originalArchiveDir: join(root, 'separate-private') }),
        ...(!localOnly && { rcloneRemote: 'fake:archive', rcloneBin: join(root, 'rclone') }),
    };
    const original = settings.originalArchiveDir ?? settings.archiveDir + '.originals';
    const remote = join(root, 'drive', 'archive');
    await fs.mkdir(settings.archiveDir);
    await fs.mkdir(remote, { recursive: true });
    await fs.writeFile(join(root, 'rclone'), fake, { mode: 0o700 });
    const control = (options) => fs.writeFile(join(root, 'control.json'), JSON.stringify(options));
    await control({});
    const calls = async () => (await fs.readFile(join(root, 'calls.jsonl'), 'utf8').catch(() => ''))
        .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const renders = [];
    const renderRasterPdf = async ({ sourcePath, outputPath, outputHandle, lockFd }) => {
        const source = await fs.readFile(sourcePath);
        renders.push({ sha: sha(source), lockFd });
        await writeRender(outputPath, outputHandle, image(source));
    };
    const publish = (options) => publishRasterArchive(settings, { renderRasterPdf, ...options });
    return { root, settings, original, remote, control, calls, renders, renderRasterPdf, publish };
}

test('dry-run is read-only, then captures a complete corpus and transforms bytes incrementally', async (t) => {
    const f = await fixture(t, { defaultOriginals: true });
    const docs = {
        'documents/2024/deep/historical.PDF': raw('historical'),
        'merged/final.pdf': raw('merged'),
        'merged/final_audit.pdf': raw('audit'),
    };
    const [localOnly, both, remoteOnly] = Object.keys(docs);
    const local = f.settings.archiveDir;
    const localPath = await put(local, localOnly, docs[localOnly]);
    const baselineTime = new Date('2024-03-01T01:02:03Z');
    await fs.utimes(localPath, baselineTime, baselineTime);
    await put(local, both, docs[both]);
    await put(f.remote, both, docs[both]);
    await put(f.remote, remoteOnly, docs[remoteOnly]);
    await put(local, 'unrelated.txt', 'local sentinel');
    await put(f.remote, 'unrelated.txt', 'remote sentinel');
    const before = await fs.readdir(f.root);
    assert.equal((await prepareRasterArchive(f.settings, { dryRun: true })).captured, 3);
    assert.equal((await f.publish({ dryRun: true })).wouldRender, 3);
    assert.deepEqual((await fs.readdir(f.root)).filter((name) => name !== 'calls.jsonl'), before);
    assert.equal(f.renders.length, 0);
    assert.ok((await f.calls()).every(({ command }) => ['listremotes', 'lsjson', 'cat'].includes(command)));
    assert.deepEqual(await fs.readFile(localPath), docs[localOnly]);
    assert.equal((await prepareRasterArchive(f.settings)).captured, 3);
    assert.equal(await mode(f.original), 0o700);
    assert.equal(await mode(f.settings.stateDir), 0o700);
    assert.equal(await mode(join(f.original, localOnly)), 0o600);
    assert.equal((await fs.stat(join(f.original, localOnly))).mtimeMs, baselineTime.getTime());
    const published = await f.publish();
    assert.deepEqual([published.rendered, published.localPublished, published.remotePublished], [3, 3, 3]);
    for (const [name, source] of Object.entries(docs)) {
        assert.equal(sha(await fs.readFile(join(f.original, name))), sha(source));
        assert.equal(sha(await fs.readFile(join(local, name))), sha(image(source)));
        assert.equal(sha(await fs.readFile(join(f.remote, name))), sha(image(source)));
    }
    const uploads = (await f.calls()).filter(({ command }) => command === 'copyto');
    assert.deepEqual(uploads.map(({ sha }) => sha).sort(), Object.values(docs).map((source) => sha(image(source))).sort());
    const offset = (await f.calls()).length;
    const idleMtime = (await fs.stat(localPath)).mtimeMs;
    const idleRemoteMtime = (await fs.stat(join(f.remote, localOnly))).mtimeMs;
    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    const idle = await f.publish();
    assert.deepEqual([idle.rendered, idle.localPublished, idle.remotePublished], [0, 0, 0]);
    const idleCalls = (await f.calls()).slice(offset);
    const idleCommands = ['listremotes', ...Array(5).fill('lsjson')];
    assert.deepEqual(idleCalls.map(({ command }) => command), [...idleCommands, ...idleCommands]);
    assert.equal(idleCalls.filter(({ flags }) => flags.includes('--recursive')).length, 2);
    assert.equal((await fs.stat(localPath)).mtimeMs, idleMtime);
    assert.equal((await fs.stat(join(f.remote, localOnly))).mtimeMs, idleRemoteMtime);
    assert.equal(await fs.readFile(join(local, 'unrelated.txt'), 'utf8'), 'local sentinel');
    assert.equal(await fs.readFile(join(f.remote, 'unrelated.txt'), 'utf8'), 'remote sentinel');
});

const manifestPath = (f) => join(f.settings.stateDir, 'raster-mirror', 'manifest.json');
const readManifest = async (f) => JSON.parse(await fs.readFile(manifestPath(f), 'utf8'));
const blobPath = (f, bytes) => join(f.settings.stateDir, 'raster-mirror', 'original-blobs', sha(bytes) + '.pdf');
const mutations = async (f) => (await f.calls()).filter(({ command }) => command === 'copyto' || command === 'deletefile');
const absent = (path) => assert.rejects(fs.lstat(path), { code: 'ENOENT' });

async function seed(f, name, bytes) {
    await put(f.settings.archiveDir, name, bytes);
    await put(f.remote, name, bytes);
    await prepareRasterArchive(f.settings);
}

async function movePrivate(f, from, to) {
    await fs.mkdir(dirname(join(f.original, to)), { recursive: true, mode: 0o700 });
    await fs.rename(join(f.original, from), join(f.original, to));
}

test('new and changed raw assets share verified cache and retain immutable history', async (t) => {
    const f = await fixture(t);
    const name = 'history.pdf';
    const a = raw('a');
    const b = raw('b');
    await seed(f, name, a);
    await f.publish();
    await put(f.original, name, b);
    await put(f.original, 'new/deep/audit.pdf', b);
    await put(f.original, 'new/deep/doc.pdf', raw('doc'));
    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    const result = await f.publish();
    assert.deepEqual([result.captured, result.rendered, result.localPublished, result.remotePublished], [2, 2, 3, 3]);
    assert.deepEqual(f.renders.map((event) => event.sha).sort(), [sha(a), sha(b), sha(raw('doc'))].sort());
    const records = new Map((await readManifest(f)).records);
    assert.deepEqual(records.get(name).history.map((version) => version.raw.sha256), [sha(a), sha(a), sha(b)]);
    assert.equal(records.get(name).remote.checksum, createHash('md5').update(image(b)).digest('hex'));
    for (const bytes of [a, b]) {
        assert.deepEqual(await fs.readFile(blobPath(f, bytes)), bytes);
        assert.equal(await mode(blobPath(f, bytes)), 0o600);
    }
    assert.equal(await mode(manifestPath(f)), 0o600);
    assert.equal(await mode(join(f.original, 'new/deep')), 0o700);
    assert.deepEqual(await fs.readFile(join(f.remote, name)), image(b));
});

test('renderer rejects without exposing its error or replacing originals', async (t) => {
    const f = await fixture(t, { localOnly: true });
    const name = 'private document.pdf';
    const source = raw('one');
    await put(f.settings.archiveDir, name, source);
    await prepareRasterArchive(f.settings);
    await assert.rejects(f.publish({
        renderRasterPdf: async ({ outputPath, outputHandle }) => {
            await writeRender(outputPath, outputHandle, Buffer.from('unfinished'));
            throw new Error('private document.pdf with confidential stderr');
        },
    }), { message: 'raster_archive_renderer_failed' });
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), source);
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
    assert.equal((await f.publish()).rendered, 1);
});

test('native filesystem errors redact the synthetic private path and native failure', async (t) => {
    const f = await fixture(t, { localOnly: true });
    const privateName = 'QA-synthetic-customer.pdf';
    let stateDir = join(f.root, privateName);
    // The mirror directory fits in Linux PATH_MAX. Appending the manifest does not.
    while (Buffer.byteLength(stateDir) < 4080) {
        const segmentBytes = Math.min(200, 4079 - Buffer.byteLength(stateDir));
        stateDir = join(stateDir, 'x'.repeat(segmentBytes));
    }
    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
    const manifest = join(stateDir, 'raster-mirror', 'manifest.json');
    await assert.rejects(fs.lstat(manifest), { code: 'ENAMETOOLONG', path: manifest });

    await assert.rejects(prepareRasterArchive({ ...f.settings, stateDir }), (error) => {
        assert.equal(error.message, 'raster_archive_prepare_failed');
        assert.equal(error.code, 'raster_archive_prepare_failed');
        assert.equal(error.cause, undefined);
        assert.equal(error.path, undefined);
        assert.doesNotMatch(inspect(error), /QA-synthetic-customer|ENAMETOOLONG|manifest\.json/);
        return true;
    });
});

test('initial and revised raw bytes are never published as a raster', async (t) => {
    const f = await fixture(t);
    const name = 'unchanged-render.pdf';
    const source = raw('first with signature');
    const next = raw('revision with signature');
    await seed(f, name, source);
    async function rejectRawRender(current, published) {
        const manifest = await fs.readFile(manifestPath(f));
        const before = await mutations(f);
        const counts = f.renders.length;
        await assert.rejects(f.publish({
            renderRasterPdf: async ({ sourcePath, outputPath, outputHandle }) => {
                await writeRender(outputPath, outputHandle, await fs.readFile(sourcePath));
            },
        }), { code: 'raster_archive_invalid_render', message: 'raster_archive_invalid_render' });
        for (const root of [f.settings.archiveDir, f.remote]) {
            assert.deepEqual(await fs.readFile(join(root, name)), published);
        }
        for (const path of [join(f.original, name), blobPath(f, current)]) {
            assert.deepEqual(await fs.readFile(path), current);
        }
        assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
        assert.deepEqual(await fs.readFile(manifestPath(f)), manifest);
        assert.equal(new Map((await readManifest(f)).records).get(name).raw.sha256, sha(source));
        assert.deepEqual(await mutations(f), before);
        assert.equal(f.renders.length, counts);
        await absent(join(f.settings.stateDir, 'raster-mirror', 'rendered', sha(current)));
    }
    await rejectRawRender(source, source);
    const result = await f.publish();
    assert.deepEqual([result.rendered, result.localPublished, result.remotePublished], [1, 1, 1]);
    await put(f.original, name, next);
    await rejectRawRender(next, image(source));
});

test('recovery verifies the local stage inode and a remote write that completed before failure', async (t) => {
    const f = await fixture(t);
    const name = 'private document.pdf';
    const source = raw('one');
    const file = join(f.settings.archiveDir, name);
    await seed(f, name, source);
    const lockPath = await put(f.root, 'lock', '');
    const lock = await fs.open(lockPath, 'r');
    t.after(() => lock.close());
    const offset = (await f.calls()).length;
    await f.control({ failBefore: 'copyto' });
    await assert.rejects(f.publish({ lockFd: lock.fd }), { message: 'raster_archive_remote_copyto_failed' });
    assert.deepEqual(await fs.readFile(file), image(source));
    assert.deepEqual(await fs.readFile(join(f.remote, name)), source);
    assert.ok((await readManifest(f)).intent.stage.fileId.length);
    const mtime = (await fs.stat(file)).mtimeMs;
    await f.control({ failAfter: 'copyto' });
    await assert.rejects(f.publish({ lockFd: lock.fd }), { message: 'raster_archive_remote_copyto_failed' });
    assert.deepEqual(await fs.readFile(join(f.remote, name)), image(source));
    await f.control({});
    const count = (await mutations(f)).length;
    const resumed = await f.publish({ lockFd: lock.fd });
    assert.deepEqual([resumed.localPublished, resumed.remotePublished, resumed.rendered], [0, 0, 0]);
    assert.equal((await mutations(f)).length, count);
    assert.equal((await fs.stat(file)).mtimeMs, mtime);
    assert.ok((await f.calls()).slice(offset).every(({ locked }) => locked));
    assert.equal(f.renders[0].lockFd, lock.fd);
    assert.equal((await readManifest(f)).intent, null);
});

test('an unowned same-content inode after partial publish cannot be adopted or overwritten', async (t) => {
    const f = await fixture(t);
    const name = 'owned.pdf';
    const source = raw('one');
    await seed(f, name, source);
    await f.control({ failBefore: 'copyto' });
    await assert.rejects(f.publish(), { message: 'raster_archive_remote_copyto_failed' });
    const outsider = await put(f.settings.archiveDir, 'unrelated.tmp', image(source));
    const dest = join(f.settings.archiveDir, name);
    await fs.rename(outsider, dest);
    const inode = (await fs.stat(dest)).ino;
    const count = (await mutations(f)).length;
    await f.control({});
    await assert.rejects(f.publish(), { message: 'raster_archive_public_version_conflict' });
    assert.equal((await fs.stat(dest)).ino, inode);
    assert.equal((await mutations(f)).length, count);
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
});

async function treeSnapshot(root) {
    const paths = (await fs.readdir(root, { recursive: true })).sort();
    return Promise.all(['.', ...paths].map(async (path) => {
        const full = join(root, path);
        const { ino, mode, mtimeNs, ctimeNs } = await fs.lstat(full, { bigint: true });
        return { path, ino, mode, mtimeNs, ctimeNs, bytes: (mode & 0o170000n) === 0o100000n ? await fs.readFile(full) : null };
    }));
}

test('populated rollback dry-run preserves all trees, manifest and uploaded bytes', async (t) => {
    const f = await fixture(t);
    const source = raw('original with signature');
    const name = 'nested/document.pdf';
    await seed(f, name, source);
    await f.publish();
    for (const root of [f.settings.archiveDir, f.remote]) {
        assert.deepEqual(await fs.readFile(join(root, name)), image(source));
    }
    assert.deepEqual(await fs.readFile(join(f.original, name)), source);
    const roots = [f.settings.archiveDir, f.original, f.remote, f.settings.stateDir];
    const before = await Promise.all(roots.map(treeSnapshot));
    const manifest = await readManifest(f);
    assert.equal(manifest.phase, 'active');
    assert.equal(manifest.intent, null);
    const offset = (await f.calls()).length;
    const result = await rollbackRasterArchive(f.settings, { dryRun: true });
    const calls = (await f.calls()).slice(offset);
    assert.ok(calls.length > 0);
    assert.deepEqual(calls.filter(({ command, sha }) => !['listremotes', 'lsjson', 'cat'].includes(command) || sha !== null), []);
    assert.deepEqual([result.dryRun, result.wouldRestore, result.localRestored, result.remoteRestored], [true, 1, 0, 0]);
    assert.deepEqual(await Promise.all(roots.map(treeSnapshot)), before);
    assert.deepEqual(await readManifest(f), manifest);
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
});

test('rollback resumes remote writes, pauses scheduled publish and permits guarded explicit republish', async (t) => {
    const f = await fixture(t);
    const source = raw('original with signature');
    const name = 'document.pdf';
    const file = join(f.settings.archiveDir, name);
    await seed(f, name, source);
    await f.publish();
    await f.control({ failAfter: 'copyto' });
    await assert.rejects(rollbackRasterArchive(f.settings), { message: 'raster_archive_remote_copyto_failed' });
    assert.equal((await readManifest(f)).phase, 'rolling-back');
    assert.deepEqual(await fs.readFile(file), source);
    assert.deepEqual(await fs.readFile(join(f.remote, name)), source);
    const calls = (await f.calls()).length;
    await assert.rejects(f.publish(), { message: 'raster_archive_publication_paused' });
    await assert.rejects(f.publish({ explicitRepublish: true }), { message: 'raster_archive_publication_paused' });
    assert.equal((await f.calls()).length, calls);
    await f.control({});
    await prepareRasterArchive(f.settings, { dryRun: true });
    const time = (await fs.stat(file)).mtimeMs;
    const resumed = await rollbackRasterArchive(f.settings);
    assert.deepEqual([resumed.localRestored, resumed.remoteRestored], [0, 0]);
    assert.equal((await readManifest(f)).phase, 'paused');
    assert.equal((await fs.stat(file)).mtimeMs, time);
    await assert.rejects(f.publish(), { message: 'raster_archive_publication_paused' });
    assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source)), sha(source)]);
    const unknown = raw('unknown');
    await fs.writeFile(file, unknown);
    await assert.rejects(f.publish({ explicitRepublish: true }), { message: 'raster_archive_public_version_conflict' });
    await assert.rejects(rollbackRasterArchive(f.settings), { message: 'raster_archive_public_version_conflict' });
    assert.deepEqual(await fs.readFile(file), unknown);
    await fs.writeFile(file, source);
    assert.equal((await f.publish({ explicitRepublish: true })).rendered, 0);
    assert.deepEqual(await fs.readFile(file), image(source));
    assert.equal((await readManifest(f)).phase, 'active');
    assert.equal(f.renders.length, 1);
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
});

test('rollback preflights every owned path and preserves a drifted remote and other derivatives', async (t) => {
    const f = await fixture(t);
    const a = raw('first');
    const b = raw('last');
    await seed(f, 'a.pdf', a);
    await put(f.original, 'z.pdf', b);
    await f.publish();
    const count = (await mutations(f)).length;
    await put(f.remote, 'z.pdf', raw('changed externally'));
    await assert.rejects(rollbackRasterArchive(f.settings), { message: 'raster_archive_public_version_conflict' });
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'a.pdf')), image(a));
    assert.deepEqual(await fs.readFile(join(f.remote, 'z.pdf')), raw('changed externally'));
    assert.equal((await mutations(f)).length, count);
    await put(f.remote, 'z.pdf', image(b));
    await fs.writeFile(blobPath(f, b), b.subarray(0, -1));
    await assert.rejects(rollbackRasterArchive(f.settings), { message: 'raster_archive_protected_bytes_changed' });
    assert.equal((await mutations(f)).length, count);
});

test('private rename before prepare, move recovery, reversed replay, and retirement', async (t) => {
    const f = await fixture(t);
    const old = 'old/document_audit.pdf';
    const next = 'new/deep/audit.pdf';
    const source = raw('audit');
    await seed(f, old, source);
    await f.publish();
    const moves = [{ from: old, to: next }];
    await movePrivate(f, old, next);
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_active_original_missing' });
    assert.equal((await prepareRasterArchive(f.settings, { moves })).captured, 0);
    await absent(join(f.original, old));
    await assert.rejects(f.publish(), { message: 'raster_archive_active_original_missing' });
    await f.control({ failAfter: 'deletefile' });
    const lock = await fs.open(await put(f.root, 'lock', ''), 'r');
    t.after(() => lock.close());
    await assert.rejects(f.publish({ moves, lockFd: lock.fd }), { message: 'raster_archive_remote_deletefile_failed' });
    assert.deepEqual(await fs.readFile(join(f.remote, next)), image(source));
    await absent(join(f.settings.archiveDir, old));
    await absent(join(f.remote, old));
    assert.ok((await f.calls()).find(({ command }) => command === 'deletefile').locked);
    await f.control({});
    await prepareRasterArchive(f.settings, { moves });
    const resumed = await f.publish({ moves });
    assert.deepEqual([resumed.moved, resumed.rendered, resumed.localRemoved, resumed.remoteRemoved], [1, 0, 0, 0]);
    assert.equal((await f.publish({ moves })).moved, 0);
    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    await absent(join(f.original, old));
    await put(f.original, old, source);
    await assert.rejects(f.publish(), { message: 'raster_archive_retired_original_path' });
    await fs.unlink(join(f.original, old));
    await movePrivate(f, next, old);
    const inverse = [{ from: next, to: old }];
    assert.equal((await f.publish({ moves: inverse })).moved, 1);
    assert.equal((await f.publish({ moves: inverse })).moved, 0);
    await absent(join(f.settings.archiveDir, next));
    await absent(join(f.remote, next));
    await absent(join(f.original, next));
    assert.deepEqual(await fs.readFile(join(f.remote, old)), image(source));
    assert.ok((await mutations(f)).filter(({ command }) => command === 'copyto').every((call) => call.sha === sha(image(source))));
});

test('bootstrapped raw move guards source, destination and an interrupted deletion', async (t) => {
    const f = await fixture(t);
    const source = raw('source');
    const old = 'old.pdf';
    const next = 'new.pdf';
    await seed(f, old, source);
    await movePrivate(f, old, next);
    const moves = [{ from: old, to: next }];
    const outsider = await put(f.remote, next, source);
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_active_original_missing' });
    await assert.rejects(f.publish({ moves }), { message: 'raster_archive_move_collision' });
    assert.deepEqual(await fs.readFile(outsider), source);
    await fs.unlink(outsider);
    await put(f.remote, old, raw('tampered old'));
    await assert.rejects(f.publish({ moves }), { message: 'raster_archive_public_version_conflict' });
    assert.equal((await mutations(f)).length, 0);
    await put(f.remote, old, source);
    await f.control({ failBefore: 'deletefile' });
    await assert.rejects(f.publish({ moves }), { message: 'raster_archive_remote_deletefile_failed' });
    await absent(join(f.settings.archiveDir, old));
    assert.deepEqual(await fs.readFile(join(f.remote, old)), source);
    await f.control({ ids: { 'archive/old.pdf': 'swapped-identical-old-id' } });
    const count = (await mutations(f)).length;
    await assert.rejects(f.publish({ moves }), { message: 'raster_archive_public_version_conflict' });
    assert.deepEqual(await fs.readFile(join(f.remote, old)), source);
    assert.equal((await mutations(f)).length, count);
    await f.control({});
    await put(f.remote, next, raw('tampered destination'));
    await assert.rejects(f.publish({ moves }), { message: 'raster_archive_public_version_conflict' });
    assert.equal((await mutations(f)).length, count);
    assert.deepEqual(await fs.readFile(join(f.remote, old)), source);
    await put(f.remote, next, image(source));
    assert.equal((await f.publish({ moves })).remoteRemoved, 1);
    await absent(join(f.remote, old));
});

test('an unowned move source and unsafe or aliased move paths never publish', async (t) => {
    const f = await fixture(t, { localOnly: true });
    await prepareRasterArchive(f.settings);
    await put(f.settings.archiveDir, 'old.pdf', raw('document'));
    await put(f.original, 'new.pdf', raw('document'));
    await assert.rejects(f.publish({ moves: [{ from: 'old.pdf', to: 'new.pdf' }] }), { message: 'raster_archive_move_original_conflict' });
    for (const from of ['../secret.pdf', '/old.pdf', 'x//out.pdf', 'x\\out.pdf', 'bad.txt', 'x/.//old.pdf']) {
        await assert.rejects(f.publish({ moves: [{ from, to: 'new.pdf' }] }), /raster_archive_unsafe_(path|pdf_path)/);
    }
    const korean = '계약.pdf';
    await assert.rejects(f.publish({ moves: [{ from: korean, to: korean.normalize('NFD') }] }), /raster_archive_conflicting_moves/);
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'old.pdf')), raw('document'));
    assert.equal(f.renders.length, 0);
});

test('bootstrap rejects disagreement with either authority before creating private state', async (t) => {
    const f = await fixture(t);
    const name = 'agreement.pdf';
    const local = await put(f.settings.archiveDir, name, raw('local'));
    const remote = await put(f.remote, name, raw('remote'));
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_original_authority_conflict' });
    await absent(f.original);
    await absent(f.settings.stateDir);
    assert.deepEqual(await fs.readFile(local), raw('local'));
    assert.deepEqual(await fs.readFile(remote), raw('remote'));
    await fs.writeFile(remote, raw('local'));
    await fs.mkdir(f.original, { mode: 0o700 });
    const existing = await put(f.original, name, raw('existing original'));
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_original_authority_conflict' });
    assert.deepEqual(await fs.readFile(existing), raw('existing original'));
    const time = new Date('2025-09-01T00:01:02Z');
    await fs.writeFile(existing, raw('local'));
    await fs.utimes(existing, time, time);
    const inode = (await fs.stat(existing)).ino;
    await prepareRasterArchive(f.settings);
    assert.equal((await fs.stat(existing)).ino, inode);
    assert.equal((await fs.stat(existing)).mtimeMs, time.getTime());
    assert.equal(await mode(existing), 0o600);
    assert.equal((await mutations(f)).length, 0);
});

test('root and target binding rejects reconfiguration, traversal, overlaps, and symlink ancestors', async (t) => {
    const f = await fixture(t);
    const local = f.settings.archiveDir;
    const locked = f.settings.stateDir;
    const name = 'bound.pdf';
    const aliased = join(f.root, 'alias');
    await fs.symlink(f.root, aliased);
    const cases = [
        [{ originalArchiveDir: local }, /overlapping_roots/],
        [{ stateDir: join(local, 'inner') }, /overlapping_roots/],
        [{ originalArchiveDir: join(f.root, 'alias/new') }, /unsafe_directory/],
        [{ archiveDir: local + '/../visible' }, /unsafe_root/],
        [{ rcloneRemote: 'fake:archive/../secret' }, /unsafe_path/],
        [{ rcloneRemote: ':drive:archive' }, /unsafe_remote_target/],
        [{ rcloneBin: '--invalid' }, /unsafe_remote_executable/],
    ];
    for (const [settings, expected] of cases) {
        await assert.rejects(prepareRasterArchive({ ...f.settings, ...settings }, { dryRun: true }), expected);
    }
    await absent(locked);
    await seed(f, name, raw('bound'));
    const calls = (await f.calls()).length;
    await assert.rejects(prepareRasterArchive({ ...f.settings, rcloneRemote: 'fake:another' }), /binding_changed/);
    await assert.rejects(prepareRasterArchive({ ...f.settings, originalArchiveDir: join(f.root, 'override') }), /binding_changed/);
    assert.equal((await f.calls()).length, calls);
    await f.control({ ids: { archive: 'different-root-ID' } });
    await assert.rejects(f.publish(), /remote_root_changed/);
    assert.deepEqual(await fs.readFile(join(local, name)), raw('bound'));
    assert.equal((await mutations(f)).length, 0);
});

test('nonregular local paths and unsafe private files never expose or replace a sentinel', async (t) => {
    const f = await fixture(t, { localOnly: true });
    const local = f.settings.archiveDir;
    const name = 'linked.pdf';
    const outside = await put(f.root, 'unrelated.pdf', raw('unrelated'));
    const alias = join(local, name);
    await fs.symlink(outside, alias);
    await assert.rejects(prepareRasterArchive(f.settings), /unsafe_file/);
    await fs.unlink(alias);
    await fs.link(outside, alias);
    await assert.rejects(prepareRasterArchive(f.settings), /unsafe_file/);
    await fs.unlink(alias);
    await fs.mkdir(alias);
    await assert.rejects(prepareRasterArchive(f.settings), /unsafe_file/);
    await fs.rmdir(alias);
    await fs.symlink(f.root, join(local, 'hidden-symlink'));
    await assert.rejects(prepareRasterArchive(f.settings), /unsafe_file/);
    await fs.unlink(join(local, 'hidden-symlink'));
    await put(local, 'own.pdf', raw('owned'));
    const scratch = await put(local, '.provider-publication-abcdef/payload.stage', 'provider staging sentinel');
    await prepareRasterArchive(f.settings);
    assert.equal((await f.publish()).rendered, 1);
    assert.deepEqual(await fs.readFile(outside), raw('unrelated'));
    assert.equal(await fs.readFile(scratch, 'utf8'), 'provider staging sentinel');
    await fs.chmod(manifestPath(f), 0o644);
    await assert.rejects(rollbackRasterArchive(f.settings, { dryRun: true }), /unsafe_private_permissions/);
    assert.deepEqual(await fs.readFile(join(local, 'own.pdf')), image(raw('owned')));
});

test('Korean NFC aliases, duplicate remote names and directory aliases fail before mutation', async (t) => {
    const f = await fixture(t);
    const nfc = '계약';
    const nfd = nfc.normalize('NFD');
    assert.notEqual(nfc, nfd);
    const local = await put(f.settings.archiveDir, 'contracts/' + nfd + '.pdf', raw('same'));
    const remote = await put(f.remote, 'contracts/' + nfc + '.pdf', raw('same'));
    await assert.rejects(prepareRasterArchive(f.settings), /ambiguous_path/);
    await fs.unlink(local);
    await put(f.settings.archiveDir, nfd + '/only-local.pdf', raw('local'));
    await put(f.remote, nfc + '/only-remote.pdf', raw('remote'));
    await assert.rejects(prepareRasterArchive(f.settings), /ambiguous_path/);
    await fs.rm(join(f.settings.archiveDir, nfd), { recursive: true });
    for (const duplicate of ['archive', 'archive/contracts', 'archive/contracts/' + nfc + '.pdf']) {
        await f.control({ duplicate });
        await assert.rejects(prepareRasterArchive(f.settings), /ambiguous_path/);
    }
    await f.control({ ids: { 'archive/contracts': 'id:archive/' + nfc } });
    await assert.rejects(prepareRasterArchive(f.settings), /ambiguous_remote_identity/);
    await f.control({ ids: { 'archive/contracts': 'shortcut\tunderlying-id' } });
    await assert.rejects(prepareRasterArchive(f.settings), /unsafe_remote_listing/);
    await f.control({ listFail: true });
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_remote_lsjson_failed' });
    assert.equal((await mutations(f)).length, 0);
    assert.deepEqual(await fs.readFile(remote), raw('same'));
    await absent(f.original);
});

test('zero-exit stderr with a nonempty recursive JSON listing fails before any mutation', async (t) => {
    const f = await fixture(t);
    const localSource = raw('local only');
    const remoteSource = raw('remote only');
    const local = await put(f.settings.archiveDir, 'local.pdf', localSource);
    const remote = await put(f.remote, 'deep/remote.pdf', remoteSource);
    await f.control({ warnOnRecursiveList: true });

    await assert.rejects(prepareRasterArchive(f.settings), (error) => {
        assert.equal(error.code, 'raster_archive_remote_lsjson_failed');
        assert.equal(error.message, error.code);
        assert.doesNotMatch(inspect(error), /QA-synthetic-customer|incomplete listing/);
        return true;
    });
    await absent(f.original);
    await absent(f.settings.stateDir);
    assert.ok((await f.calls()).every(({ command, sha }) => ['listremotes', 'lsjson'].includes(command) && sha === null));
    assert.deepEqual(await fs.readFile(local), localSource);
    assert.deepEqual(await fs.readFile(remote), remoteSource);

    await f.control({});
    assert.equal((await prepareRasterArchive(f.settings)).captured, 2);
    assert.deepEqual(await fs.readFile(join(f.original, 'deep/remote.pdf')), remoteSource);
    const manifest = await fs.readFile(manifestPath(f));
    await f.control({ warnOnRecursiveList: true });
    await assert.rejects(f.publish(), { code: 'raster_archive_remote_lsjson_failed' });
    assert.deepEqual(await fs.readFile(manifestPath(f)), manifest);
    assert.deepEqual(await mutations(f), []);
    assert.equal(f.renders.length, 0);
});

test('a replacement ID change or duplicate after upload stops even when uploaded bytes match', async (t) => {
    for (const [change, message, reset] of [
        [{ changeIdOnCopy: true }, /remote_identity_changed/, { ids: { 'archive/document.pdf': 'replacement-id' } }],
        [{ duplicateOnCopy: true }, /ambiguous_path/, { duplicate: 'archive/document.pdf' }],
    ]) {
        const f = await fixture(t);
        const source = raw('one');
        await seed(f, 'document.pdf', source);
        await f.control(change);
        await assert.rejects(f.publish(), message);
        assert.deepEqual(await fs.readFile(join(f.remote, 'document.pdf')), image(source));
        assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
        assert.equal((await readManifest(f)).intent.remoteStarted, true);
        await f.control(reset);
        await assert.rejects(f.publish(), /public_version_conflict|ambiguous_path/);
        assert.equal((await mutations(f)).length, 1);
    }
});

test('identical remote bytes under new file or ancestor IDs fail before local replacement', async (t) => {
    const f = await fixture(t);
    const source = raw('owned');
    const name = 'dir/document.pdf';
    await seed(f, name, source);
    for (const key of ['archive/dir', 'archive/dir/document.pdf']) {
        await f.control({ ids: { [key]: 'unexpected-ID' } });
        await assert.rejects(f.publish(), /public_version_conflict/);
        assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), source);
    }
    assert.equal((await mutations(f)).length, 0);
    assert.equal(f.renders.length, 0);
});

test('a derivative copied to an untracked path is never captured as a raw source', async (t) => {
    const f = await fixture(t);
    const source = raw('original');
    await seed(f, 'owned.pdf', source);
    await f.publish();
    const untracked = await put(f.remote, 'copied.pdf', image(source));
    const count = (await mutations(f)).length;
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_derivative_as_original' });
    await assert.rejects(f.publish(), { message: 'raster_archive_derivative_as_original' });
    await absent(join(f.original, 'copied.pdf'));
    await absent(blobPath(f, image(source)));
    assert.deepEqual(await fs.readFile(untracked), image(source));
    assert.equal((await mutations(f)).length, count);
});

test('providers without checksums and IDs require fresh listings and strong content proof', async (t) => {
    const f = await fixture(t);
    const source = raw('owned');
    await f.control({ noHashes: true, noIds: true });
    await seed(f, 'owned.pdf', source);
    await f.publish();
    let record = new Map((await readManifest(f)).records).get('owned.pdf');
    assert.equal(record.remote.id, null);
    assert.equal(record.remote.checksum, null);
    const before = (await f.calls()).length;
    assert.equal((await f.publish()).remotePublished, 0);
    assert.ok((await f.calls()).slice(before).some(({ command }) => command === 'cat'));
    const unknown = Buffer.alloc(image(source).length, 1);
    await put(f.remote, 'owned.pdf', unknown);
    await assert.rejects(rollbackRasterArchive(f.settings), /public_version_conflict/);
    assert.deepEqual(await fs.readFile(join(f.remote, 'owned.pdf')), unknown);
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'owned.pdf')), image(source));
});

test('Drive-style listing accepts matching MD5 aliases and refuses malformed or conflicting aliases', async (t) => {
    const f = await fixture(t);
    const source = raw('alias source');
    const name = 'file.pdf';
    await put(f.settings.archiveDir, name, source);
    await put(f.remote, name, source);
    for (const hashes of [
        'null', '[]', '1', '"DIGEST"', '{"md5":null}', '{"MD5":123}', '{"md5":""}',
        '{"md5":"DIGEST","MD5":"abcdefghijklmnopqrstuvwx12345678"}',
        '{"md5":"DIGEST","MD5":"00000000000000000000000000000000"}',
    ]) {
        await f.control({ hashes });
        await assert.rejects(prepareRasterArchive(f.settings), { code: 'raster_archive_unsafe_remote_listing' });
        await absent(f.settings.stateDir);
        await absent(f.original);
    }
    await f.control({ hashes: '{"MD5":"DIGEST"}' });
    assert.equal((await prepareRasterArchive(f.settings)).captured, 1);
    await f.control({ hashes: '{"md5":"DIGEST","MD5":"DIGEST"}' });
    assert.equal((await f.publish()).remotePublished, 1);
    const offset = (await f.calls()).length;
    await f.control({ ids: { 'archive/file.pdf': 'unowned-new-id' } });
    await assert.rejects(f.publish(), { code: 'raster_archive_public_version_conflict' });
    assert.ok((await f.calls()).slice(offset).some(({ command }) => command === 'cat'));
    assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source))]);
    assert.deepEqual(await fs.readFile(join(f.remote, name)), image(source));
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), image(source));
});

const systemRclone = '/usr/bin/rclone';
async function useLocalRclone(f) {
    const config = await put(f.root, 'rclone.conf', '[sandbox]\ntype = local\n');
    const wrapper = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const delimiter = args.indexOf('--');
appendFileSync(${JSON.stringify(join(f.root, 'calls.jsonl'))}, JSON.stringify({
    command: args[0], flags: args.slice(1, delimiter), operands: args.slice(delimiter + 1),
}) + '\\n');
const result = spawnSync(${JSON.stringify(systemRclone)}, args, {
    cwd: ${JSON.stringify(join(f.root, 'drive'))}, stdio: 'inherit',
    env: { PATH: '/usr/bin:/bin', RCLONE_CONFIG: ${JSON.stringify(config)} },
});
process.exit(result.status ?? 1);
`;
    await fs.writeFile(f.settings.rcloneBin, wrapper);
    f.settings.rcloneRemote = 'sandbox:archive';
}

test('installed rclone uses one recursive listing per idle prepare and publish for three asymmetric paths', {
    skip: spawnSync(systemRclone, ['version'], { stdio: 'ignore' }).status !== 0,
}, async (t) => {
    const f = await fixture(t);
    await useLocalRclone(f);
    const docs = [
        ['documents/2024/deep/historical.PDF', raw('local archive only'), [f.settings.archiveDir]],
        ['final.pdf', raw('both archives'), [f.settings.archiveDir, f.remote]],
        ['nested/합성.pdf', raw('remote archive only'), [f.remote]],
    ];
    for (const [name, source, roots] of docs) {
        for (const root of roots) await put(root, name, source);
    }
    assert.equal((await prepareRasterArchive(f.settings)).captured, 3);
    const publication = await f.publish();
    assert.deepEqual([publication.rendered, publication.localPublished, publication.remotePublished], [3, 3, 3]);
    const states = [];
    for (const [name, source] of docs) {
        for (const root of [f.settings.archiveDir, f.remote]) {
            const path = join(root, name);
            assert.deepEqual(await fs.readFile(path), image(source));
            states.push([path, await fs.stat(path, { bigint: true }), image(source)]);
        }
        assert.deepEqual(await fs.readFile(join(f.original, name)), source);
    }
    const offset = (await f.calls()).length;
    const reports = [];
    const batches = [];
    for (let repeat = 0; repeat < 2; repeat++) {
        for (const run of [() => prepareRasterArchive(f.settings), () => f.publish()]) {
            const start = (await f.calls()).length;
            reports.push(await run());
            batches.push((await f.calls()).slice(start));
        }
    }
    const idle = (await f.calls()).slice(offset, offset + batches[0].length + batches[1].length);
    t.diagnostic(`First idle prepare + publish: ${idle.filter(({ command }) => command === 'listremotes').length} listremotes, ${idle.filter(({ command }) => command === 'lsjson').length} lsjson, ${idle.filter(({ command }) => command === 'cat').length} cat`);
    const expected = [
        ['listremotes', ['--long'], []],
        ['lsjson', ['--stat'], ['sandbox:']],
        ['lsjson', [], ['sandbox:']],
        ['lsjson', ['--recursive', '--hash-type', 'MD5'], ['sandbox:archive']],
        ['lsjson', ['--stat'], ['sandbox:']],
        ['lsjson', [], ['sandbox:']],
    ].map(([command, options, operands]) => ({ command, flags: [...options, ...localRcloneFlags], operands }));
    for (const calls of batches) {
        assert.deepEqual(calls, expected);
    }
    for (const report of reports) {
        assert.deepEqual([report.captured, report.rendered, report.localPublished, report.remotePublished], [0, 0, 0, 0]);
    }
    assert.equal(f.renders.length, 3);
    for (const [path, before, bytes] of states) {
        const after = await fs.stat(path, { bigint: true });
        assert.deepEqual([after.ino, after.size, after.mtimeNs, after.ctimeNs], [before.ino, before.size, before.mtimeNs, before.ctimeNs]);
        assert.deepEqual(await fs.readFile(path), bytes);
    }
    assert.equal(f.renders.length, 3);
    for (const [name, source] of docs) {
        const entry = new Map((await readManifest(f)).records).get(name);
        assert.equal(entry.remote.id, null);
        assert.equal(entry.remote.checksum, createHash('md5').update(image(source)).digest('hex'));
    }
    const [changed] = docs[2];
    const unknown = raw('externally changed to different sized content');
    await put(f.remote, changed, unknown);
    const mutationsBefore = (await mutations(f)).length;
    for (const run of [() => prepareRasterArchive(f.settings), () => f.publish(), () => rollbackRasterArchive(f.settings)]) {
        await assert.rejects(run(), { message: 'raster_archive_public_version_conflict' });
    }
    assert.equal((await mutations(f)).length, mutationsBefore);
    assert.deepEqual(await fs.readFile(join(f.remote, changed)), unknown);
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, changed)), image(docs[2][1]));
});

test('installed rclone copyto, lsjson, cat and deletefile work on a hermetic local backend', {
    skip: spawnSync(systemRclone, ['version'], { stdio: 'ignore' }).status !== 0,
}, async (t) => {
    const f = await fixture(t);
    await useLocalRclone(f);
    const src = raw('local backend');
    const old = 'old/고객.pdf';
    const next = 'new/deep/문서.pdf';
    await seed(f, old, src);
    assert.equal((await f.publish()).remotePublished, 1);
    await movePrivate(f, old, next);
    assert.equal((await f.publish({ moves: [{ from: old, to: next }] })).remoteRemoved, 1);
    await absent(join(f.remote, old));
    assert.deepEqual(await fs.readFile(join(f.remote, next)), image(src));
    assert.equal((await rollbackRasterArchive(f.settings)).remoteRestored, 1);
    assert.deepEqual(await fs.readFile(join(f.remote, next)), src);
});

test('a complete private render receipt survives interruption before cache promotion', async (t) => {
    const f = await fixture(t, { localOnly: true });
    const name = 'asset.pdf';
    const source = raw('staged source');
    const derivative = image(source);
    await put(f.settings.archiveDir, name, source);
    await prepareRasterArchive(f.settings);
    const cacheRoot = join(f.settings.stateDir, 'raster-mirror', 'rendered');
    const stage = join(cacheRoot, '.render-AbC123');
    await fs.mkdir(stage, { mode: 0o700 });
    await fs.writeFile(join(stage, 'output.pdf'), derivative, { mode: 0o600 });
    await fs.writeFile(join(stage, 'receipt.json'), JSON.stringify({
        raw: sha(source),
        output: { sha256: sha(derivative), md5: createHash('md5').update(derivative).digest('hex'), size: derivative.length },
    }), { mode: 0o600 });
    assert.equal((await f.publish({ dryRun: true })).wouldRender, 0);
    assert.deepEqual(await fs.readFile(join(stage, 'output.pdf')), derivative);
    assert.equal((await f.publish()).rendered, 0);
    assert.equal(f.renders.length, 0);
    await absent(stage);
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), derivative);
    assert.deepEqual(await fs.readFile(join(cacheRoot, sha(source), 'output.pdf')), derivative);
});

test('a later raw reversion is published after recovery of the interrupted intermediate revision', async (t) => {
    const f = await fixture(t);
    const path = 'version.pdf';
    const first = raw('first');
    const next = raw('next');
    await seed(f, path, first);
    await f.publish();
    await put(f.original, path, next);
    await f.control({ failAfter: 'copyto' });
    await assert.rejects(f.publish(), /remote_copyto_failed/);
    assert.deepEqual(await fs.readFile(join(f.remote, path)), image(next));
    await put(f.original, path, first);
    await f.control({});
    assert.equal((await f.publish()).rendered, 0);
    assert.deepEqual(await fs.readFile(join(f.remote, path)), image(first));
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, path)), image(first));
    assert.deepEqual(await fs.readFile(blobPath(f, next)), next);
    const versions = new Map((await readManifest(f)).records).get(path).history;
    assert.deepEqual(versions.map(({ raw }) => raw.sha256), [sha(first), sha(first), sha(next), sha(first)]);
});

const crashProgram = `
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { prepareRasterArchive, publishRasterArchive, rollbackRasterArchive } from
    ${JSON.stringify(new URL('../eformsign-backup/raster-mirror.mjs', import.meta.url).href)};
const { settings, point, action, root } = JSON.parse(process.argv[1]);
const kill = () => process.kill(process.pid, 'SIGKILL');
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const image = ${image.toString()};
${assertRenderHandle.toString()}
${writeRender.toString()}
const lock = await fs.open(join(root, 'lock'), 'r');
const prototype = Object.getPrototypeOf(lock);
const pathOf = (handle) => fs.readlink('/proc/self/fd/' + handle.fd);
const rename = fs.rename;
fs.rename = async (from, to) => {
    if (point === 'public-ready' && basename(from) === 'payload.tmp') kill();
    if (point === 'render-empty' && basename(to) === 'manifest.json') {
        const state = JSON.parse(await fs.readFile(from, 'utf8'));
        if (state.renderStage?.phase === 'prepared') kill();
    }
    await rename(from, to);
    if (point === 'render-promoted' && basename(from).startsWith('.render-')) {
        const parent = await fs.open(dirname(to), 'r');
        await parent.sync();
        await parent.close();
        kill();
    }
};
const unlink = fs.unlink;
fs.unlink = async (path) => {
    await unlink(path);
    if ((point === 'public-unlinked' && basename(path) === 'payload.tmp')
        || (point === 'render-unlinked' && basename(path) === 'output.pdf')) kill();
};
const rmdir = fs.rmdir;
fs.rmdir = async (path) => {
    await rmdir(path);
    if (point === 'public-dir-removed' && basename(path).startsWith('.raster-mirror-')) kill();
};
const write = prototype.write;
prototype.write = async function (...args) {
    const [bytes, offset, length, position] = args;
    if (['public-partial', 'public-complete'].includes(point) && basename(await pathOf(this)) === 'payload.tmp') {
        const count = point === 'public-partial' ? Math.floor(length / 2) : length;
        assert.ok(count > 0);
        assert.equal((await write.call(this, bytes, offset, count, position)).bytesWritten, count);
        await this.sync();
        kill();
    }
    return write.apply(this, args);
};
syncBuiltinESMExports();
const options = {
    lockFd: lock.fd, gsBin: 'synthetic-gs', qpdfBin: 'synthetic-qpdf',
    async renderRasterPdf({ sourcePath, outputPath, outputHandle, lockFd, gsBin, qpdfBin }) {
        assert.equal(lockFd, lock.fd);
        assert.equal(gsBin, 'synthetic-gs');
        assert.equal(qpdfBin, 'synthetic-qpdf');
        const bytes = image(await fs.readFile(sourcePath));
        await writeRender(outputPath, outputHandle, point === 'render-partial' ? bytes.subarray(0, 10) : bytes);
        if (['render-partial', 'render-complete'].includes(point)) kill();
    },
};
const run = { prepare: prepareRasterArchive, publish: publishRasterArchive, rollback: rollbackRasterArchive }[action];
try {
    await run(settings, options);
} finally {
    await lock.close();
}
`;

async function interrupt(f, action, point) {
    await put(f.root, 'lock', '');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', crashProgram,
        JSON.stringify({ root: f.root, settings: f.settings, action, point })], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, 'SIGKILL', child.stderr || child.stdout);
}

const renderRoot = (f) => join(f.settings.stateDir, 'raster-mirror', 'rendered');
const publicStage = (f, name, stage) => join(dirname(join(f.settings.archiveDir, name)), stage.directory);

async function assertEndpoints(f, name, local, remote, original, protectedRaw = original) {
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), local);
    assert.deepEqual(await fs.readFile(join(f.remote, name)), remote);
    assert.deepEqual(await fs.readFile(join(f.original, name)), original);
    assert.deepEqual(await fs.readFile(blobPath(f, protectedRaw)), protectedRaw);
}

async function assertIdle(f, options) {
    const offset = (await mutations(f)).length;
    const renders = f.renders.length;
    for (let repeat = 0; repeat < 2; repeat++) {
        assert.equal((await prepareRasterArchive(f.settings, options)).captured, 0);
        const report = await f.publish(options);
        assert.deepEqual([report.rendered, report.localPublished, report.remotePublished], [0, 0, 0]);
    }
    assert.equal((await mutations(f)).length, offset);
    assert.equal(f.renders.length, renders);
    assert.equal((await readManifest(f)).intent, null);
}

test('public stage ownership precedes partial and complete copies, and ready remains live until apply', async (t) => {
    for (const point of ['public-partial', 'public-complete', 'public-ready']) {
        await t.test(point, async (t) => {
            const f = await fixture(t);
            const name = 'deep/document.pdf';
            const source = raw('signature remains protected');
            const derivative = image(source);
            await seed(f, name, source);
            const foreign = await put(dirname(join(f.settings.archiveDir, name)),
                '.raster-mirror-11111111-1111-1111-1111-111111111111/foreign.pdf', raw('unrelated sentinel'));
            const foreignBefore = await treeSnapshot(dirname(foreign));
            const offset = (await f.calls()).length;
            await interrupt(f, 'publish', point);
            const { intent, renderStage: render } = await readManifest(f);
            assert.equal(render, undefined);
            assert.equal(intent.stage.ready, point === 'public-ready');
            const stage = publicStage(f, name, intent.stage);
            const payload = join(stage, 'payload.tmp');
            const lengths = { 'public-partial': Math.floor(derivative.length / 2), 'public-complete': derivative.length, 'public-ready': derivative.length };
            assert.deepEqual(await fs.readFile(payload), derivative.subarray(0, lengths[point]));
            assert.ok((await f.calls()).slice(offset).every(({ command, locked }) => locked && command !== 'copyto'));
            await assertEndpoints(f, name, source, source, source);
            assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
            assert.equal((await readManifest(f)).intent.stage.ready, point === 'public-ready');
            const inode = (await fs.stat(payload)).ino;
            const report = await f.publish();
            assert.deepEqual([report.rendered, report.localPublished, report.remotePublished], [0, 1, 1]);
            assert.equal((await fs.stat(join(f.settings.archiveDir, name))).ino, inode);
            await absent(stage);
            assert.deepEqual(await treeSnapshot(dirname(foreign)), foreignBefore);
            await assertEndpoints(f, name, derivative, derivative, source);
            assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(derivative)]);
            await assertIdle(f);
        });
    }
});

test('explicit rollback cancels unsent publish and replays public cleanup after unlink or rmdir', async (t) => {
    for (const [copyPoint, cleanupPoint] of [
        ['public-partial', 'public-unlinked'], ['public-complete', 'public-dir-removed'],
    ]) {
        await t.test(cleanupPoint, async (t) => {
            const f = await fixture(t);
            const name = 'version.pdf';
            const first = raw('first signature');
            const next = raw('updated signature');
            await seed(f, name, first);
            await f.publish();
            await put(f.original, name, next);
            await interrupt(f, 'publish', copyPoint);
            const { intent } = await readManifest(f);
            const stage = publicStage(f, name, intent.stage);
            const payload = join(stage, 'payload.tmp');
            const offset = (await f.calls()).length;
            await interrupt(f, 'rollback', cleanupPoint);
            const crashCalls = (await f.calls()).slice(offset);
            assert.ok(crashCalls.length > 0);
            assert.ok(crashCalls.every(({ locked, command }) => locked && command !== 'copyto'));
            const afterKill = await readManifest(f);
            assert.equal(afterKill.phase, 'rolling-back');
            assert.equal(afterKill.intent.discarding, true);
            assert.deepEqual(afterKill.intent.stage, intent.stage);
            await absent(payload);
            if (cleanupPoint === 'public-dir-removed') await absent(stage);
            else assert.deepEqual(await fs.readdir(stage), []);
            await assertEndpoints(f, name, image(first), image(first), next, next);
            await assert.rejects(f.publish(), { code: 'raster_archive_publication_paused' });
            const result = await rollbackRasterArchive(f.settings);
            assert.deepEqual([result.localRestored, result.remoteRestored], [1, 1]);
            const repeat = await rollbackRasterArchive(f.settings);
            assert.deepEqual([repeat.localRestored, repeat.remoteRestored], [0, 0]);
            await absent(stage);
            await assertEndpoints(f, name, next, next, next);
            assert.deepEqual(await fs.readFile(blobPath(f, first)), first);
            assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(first)), sha(next)]);
            assert.equal((await readManifest(f)).phase, 'paused');
        });
    }
});

test('a killed rollback retries partial and fully copied originals from the protected blob', async (t) => {
    for (const point of ['public-partial', 'public-complete']) {
        await t.test(point, async (t) => {
            const f = await fixture(t);
            const name = 'restore.pdf';
            const source = raw('durable signature');
            await seed(f, name, source);
            await f.publish();
            const offset = (await f.calls()).length;
            await interrupt(f, 'rollback', point);
            const { intent, phase } = await readManifest(f);
            assert.equal(phase, 'rolling-back');
            assert.equal(intent.kind, 'rollback');
            assert.equal(intent.stage.ready, false);
            const stage = publicStage(f, name, intent.stage);
            assert.deepEqual(await fs.readFile(join(stage, 'payload.tmp')),
                source.subarray(0, point === 'public-partial' ? Math.floor(source.length / 2) : source.length));
            assert.ok((await f.calls()).slice(offset).every(({ locked, command }) => locked && command !== 'copyto'));
            await assertEndpoints(f, name, image(source), image(source), source);
            const restored = await rollbackRasterArchive(f.settings);
            assert.deepEqual([restored.localRestored, restored.remoteRestored], [1, 1]);
            await absent(stage);
            await assertEndpoints(f, name, source, source, source);
            const idle = await rollbackRasterArchive(f.settings);
            assert.deepEqual([idle.localRestored, idle.remoteRestored], [0, 0]);
            assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source)), sha(source)]);
        });
    }
});

test('retry after public transfer and stage cleanup does not upload again', async (t) => {
    const f = await fixture(t);
    const name = 'published.pdf';
    const source = raw('protected signature');
    await seed(f, name, source);
    await interrupt(f, 'publish', 'public-dir-removed');
    const { intent } = await readManifest(f);
    assert.equal(intent.stage.ready, true);
    assert.equal(intent.remoteStarted, true);
    await absent(publicStage(f, name, intent.stage));
    await assertEndpoints(f, name, image(source), image(source), source);
    await assertIdle(f);
    assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source))]);
});

test('a replaced prepared public stage inode or symlink refuses before write and preserves the foreign file', async (t) => {
    for (const tamper of ['inode', 'symlink']) {
        await t.test(tamper, async (t) => {
            const f = await fixture(t);
            const name = 'public.pdf';
            const source = raw('signature');
            await seed(f, name, source);
            await interrupt(f, 'publish', 'public-partial');
            const { intent } = await readManifest(f);
            const stage = publicStage(f, name, intent.stage);
            const payload = join(stage, 'payload.tmp');
            const originalPath = join(f.root, 'held-stage.tmp');
            await fs.rename(payload, originalPath);
            const retainedBytes = await fs.readFile(originalPath);
            const outside = join(f.root, 'foreign.tmp');
            const sentinel = raw('different inode');
            await fs.writeFile(outside, sentinel, { mode: 0o600 });
            if (tamper === 'symlink') await fs.symlink(outside, payload);
            else await fs.copyFile(outside, payload);
            const before = await fs.lstat(payload, { bigint: true });
            for (const run of [() => prepareRasterArchive(f.settings), () => f.publish(), () => rollbackRasterArchive(f.settings)]) {
                await assert.rejects(run(), { code: 'raster_archive_staging_identity_changed' });
            }
            const after = await fs.lstat(payload, { bigint: true });
            assert.deepEqual([after.ino, after.ctimeNs], [before.ino, before.ctimeNs]);
            assert.deepEqual(await fs.readFile(payload), sentinel);
            assert.deepEqual(await fs.readFile(outside), sentinel);
            assert.deepEqual(await fs.readFile(originalPath), retainedBytes);
            await assertEndpoints(f, name, source, source, source);
            assert.deepEqual(await mutations(f), []);
        });
    }
});

test('prepared private render inodes survive a kill before receipt and are removed by exact ownership', async (t) => {
    for (const point of ['render-partial', 'render-complete']) {
        await t.test(point, async (t) => {
            const f = await fixture(t);
            const name = 'original.pdf';
            const source = raw('signature to retain');
            const derivative = image(source);
            await seed(f, name, source);
            await interrupt(f, 'publish', point);
            const state = await readManifest(f);
            assert.equal(state.intent, null);
            assert.equal(state.renderStage.phase, 'prepared');
            assert.equal(state.renderStage.raw.sha256, sha(source));
            const dir = join(renderRoot(f), state.renderStage.directory);
            const output = join(dir, 'output.pdf');
            assert.deepEqual(await fs.readdir(dir), ['output.pdf']);
            assert.equal((await fs.lstat(output)).nlink, 1);
            assert.deepEqual(await fs.readFile(output), point === 'render-partial' ? derivative.subarray(0, 10) : derivative);
            await assertEndpoints(f, name, source, source, source);
            assert.deepEqual(await mutations(f), []);
            const before = await treeSnapshot(dir);
            assert.equal((await f.publish({ dryRun: true })).wouldRender, 1);
            assert.deepEqual(await treeSnapshot(dir), before);
            if (point === 'render-complete') {
                await interrupt(f, 'prepare', 'render-unlinked');
                assert.deepEqual(await fs.readdir(dir), []);
                assert.equal((await readManifest(f)).renderStage.phase, 'cleaning');
            }
            assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
            await absent(dir);
            assert.equal((await readManifest(f)).renderStage, undefined);
            assert.deepEqual(await mutations(f), []);
            const report = await f.publish();
            assert.deepEqual([report.rendered, report.localPublished, report.remotePublished], [1, 1, 1]);
            await assertEndpoints(f, name, derivative, derivative, source);
            assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(derivative)]);
            await assertIdle(f);
        });
    }
});

test('an unjournalled empty private allocation stays opaque across repeated prepare and publish', async (t) => {
    const f = await fixture(t);
    const name = 'empty-before-header.pdf';
    const source = raw('owned signed source');
    await seed(f, name, source);
    await interrupt(f, 'publish', 'render-empty');
    const [directory] = await fs.readdir(renderRoot(f));
    assert.match(directory, /^\.render-/);
    const stage = join(renderRoot(f), directory);
    assert.deepEqual(await fs.readdir(stage), ['output.pdf']);
    const original = await treeSnapshot(stage);
    assert.equal(original[1].bytes.length, 0);
    assert.equal((await readManifest(f)).renderStage, undefined);
    await assertEndpoints(f, name, source, source, source);
    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    assert.equal((await f.publish()).rendered, 1);
    await assertIdle(f);
    assert.deepEqual(await treeSnapshot(stage), original);
    await assertEndpoints(f, name, image(source), image(source), source);
    assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source))]);
});

test('a promoted cache with a stale ownership header is reused after validating the exact committed inode', async (t) => {
    const f = await fixture(t);
    const name = 'promoted.pdf';
    const source = raw('signed canonical cache source');
    await seed(f, name, source);
    await interrupt(f, 'publish', 'render-promoted');
    const { renderStage: stage, intent } = await readManifest(f);
    assert.equal(stage.phase, 'ready');
    assert.equal(intent, null);
    const temp = join(renderRoot(f), stage.directory);
    await absent(temp);
    const committed = join(renderRoot(f), sha(source));
    const output = join(committed, 'output.pdf');
    assert.equal(String((await fs.stat(output, { bigint: true })).ino), stage.fileId[1]);
    assert.deepEqual(await fs.readFile(output), image(source));
    const receipt = JSON.parse(await fs.readFile(join(committed, 'receipt.json'), 'utf8'));
    assert.deepEqual(receipt, { raw: sha(source), output: stage.output });

    await fs.mkdir(temp, { mode: 0o700 });
    await fs.writeFile(join(temp, 'foreign'), 'unrelated data', { mode: 0o600 });
    const foreign = await treeSnapshot(temp);
    await assert.rejects(prepareRasterArchive(f.settings), { code: 'raster_archive_staging_identity_changed' });
    await assert.rejects(f.publish(), { code: 'raster_archive_staging_identity_changed' });
    assert.deepEqual(await treeSnapshot(temp), foreign);
    await fs.rename(temp, join(f.root, 'retained-foreign'));

    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    assert.equal((await readManifest(f)).renderStage, undefined);
    const result = await f.publish();
    assert.deepEqual([result.rendered, result.localPublished, result.remotePublished], [0, 1, 1]);
    await assertIdle(f);
    assert.deepEqual(await fs.readFile(output), image(source));
    await assertEndpoints(f, name, image(source), image(source), source);
    assert.deepEqual((await mutations(f)).map(({ sha }) => sha), [sha(image(source))]);
});

test('private output symlink and extra links refuse cleanup and preserve foreign data', async (t) => {
    for (const tamper of ['symlink', 'hard link', 'unexpected member']) {
        await t.test(tamper, async (t) => {
            const f = await fixture(t);
            const name = 'private.pdf';
            const source = raw('signed source');
            await seed(f, name, source);
            await interrupt(f, 'publish', 'render-complete');
            const { renderStage: stage } = await readManifest(f);
            const dir = join(renderRoot(f), stage.directory);
            const output = join(dir, 'output.pdf');
            const outside = join(f.root, 'outside');
            const sentinel = raw('unrelated sentinel');
            if (tamper === 'hard link') {
                await fs.link(output, outside);
            } else if (tamper === 'symlink') {
                await fs.rename(output, join(f.root, 'retained-owned'));
                await fs.writeFile(outside, sentinel);
                await fs.symlink(outside, output);
            } else {
                await fs.writeFile(outside, sentinel);
                await fs.copyFile(outside, join(dir, 'foreign.tmp'));
            }
            const before = await fs.lstat(output, { bigint: true });
            const outsideBytes = await fs.readFile(outside);
            for (const run of [() => prepareRasterArchive(f.settings), () => f.publish(), () => rollbackRasterArchive(f.settings)]) {
                await assert.rejects(run(), { code: 'raster_archive_staging_identity_changed' });
            }
            const after = await fs.lstat(output, { bigint: true });
            assert.deepEqual([after.ino, after.nlink, after.ctimeNs], [before.ino, before.nlink, before.ctimeNs]);
            assert.deepEqual(await fs.readFile(outside), outsideBytes);
            if (tamper === 'unexpected member') assert.deepEqual(await fs.readFile(join(dir, 'foreign.tmp')), sentinel);
            await assertEndpoints(f, name, source, source, source);
            assert.deepEqual(await mutations(f), []);
        });
    }
});

test('renderer descriptor closure and path substitution refuse the exact ownership guard', async (t) => {
    for (const tamper of ['closed fd', 'path swap']) {
        await t.test(tamper, async (t) => {
            const f = await fixture(t);
            const name = 'fd.pdf';
            const source = raw('signature with original identity');
            await seed(f, name, source);
            const foreign = image(source);
            let output;
            await assert.rejects(f.publish({
                async renderRasterPdf({ outputPath, outputHandle }) {
                    output = outputPath;
                    await writeRender(outputPath, outputHandle, foreign);
                    if (tamper === 'closed fd') {
                        await outputHandle.close();
                        // Reopen the pathname so its continued validity alone cannot pass.
                        const rebound = await fs.open(outputPath, 'r+');
                        await rebound.close();
                    } else {
                        await fs.rename(outputPath, join(f.root, 'retained-owned'));
                        await fs.writeFile(outputPath, foreign, { flag: 'wx', mode: 0o600 });
                    }
                },
            }), { code: 'raster_archive_staging_identity_changed' });
            assert.deepEqual(await fs.readFile(output), foreign);
            assert.equal((await readManifest(f)).renderStage.phase, 'prepared');
            if (tamper === 'path swap') {
                assert.deepEqual(await fs.readFile(join(f.root, 'retained-owned')), foreign);
                await assert.rejects(f.publish(), { code: 'raster_archive_staging_identity_changed' });
            } else {
                // The persisted record can still prove the original pathname on a new invocation.
                assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
                await absent(output);
            }
            await assertEndpoints(f, name, source, source, source);
            assert.deepEqual(await mutations(f), []);
        });
    }
});

test('legacy unproved hardlinked renderer output and scratch remain untouched', async (t) => {
    const f = await fixture(t);
    const name = 'legacy.pdf';
    const source = raw('legacy source');
    await seed(f, name, source);
    const stage = join(renderRoot(f), '.render-AbC234');
    const nested = join(stage, '.bjj-raster-AbC234');
    await fs.mkdir(stage, { mode: 0o700 });
    await fs.mkdir(nested, { mode: 0o700 });
    const child = join(nested, 'rendered.pdf');
    await fs.writeFile(child, image(source), { mode: 0o600 });
    const output = join(stage, 'output.pdf');
    await fs.link(child, output);
    const before = await treeSnapshot(stage);
    for (const run of [() => prepareRasterArchive(f.settings), () => f.publish(), () => rollbackRasterArchive(f.settings)]) {
        await assert.rejects(run(), { code: 'raster_archive_unowned_render_stage' });
    }
    assert.deepEqual(await treeSnapshot(stage), before);
    assert.equal((await fs.lstat(output)).nlink, 2);
    assert.equal((await fs.lstat(child)).ino, (await fs.lstat(output)).ino);
    await assertEndpoints(f, name, source, source, source);
    assert.deepEqual(await mutations(f), []);
});

test('raw prepare and rollback propagate the backup lock to listing, cat and uploads', async (t) => {
    const f = await fixture(t);
    const name = 'remote-original.pdf';
    const source = raw('remote-only signature');
    await put(f.remote, name, source);
    const lockPath = await put(f.root, 'lock', '');
    const lock = await fs.open(lockPath, 'r');
    t.after(() => lock.close());
    const options = { lockFd: lock.fd };
    assert.equal((await prepareRasterArchive(f.settings, options)).captured, 1);
    assert.equal((await f.publish(options)).rendered, 1);
    assert.equal(f.renders[0].lockFd, lock.fd);
    assert.equal((await rollbackRasterArchive(f.settings, options)).remoteRestored, 1);
    const calls = await f.calls();
    assert.ok(calls.some(({ command }) => command === 'cat'));
    assert.ok(calls.some(({ command }) => command === 'copyto'));
    assert.ok(calls.every(({ locked }) => locked));
    await assertEndpoints(f, name, source, source, source);
});

const typedRefusal = (reason = 'RASTER_INVALID_SOURCE') => Object.assign(new Error('synthetic confidential detail'), { code: reason });

async function isolatedReport(run) {
    let failure;
    await assert.rejects(run, (error) => {
        assert.equal(error.code, 'raster_archive_documents_failed');
        const described = describeRasterArchiveError(error);
        assert.equal(described.code, error.code);
        assert.deepEqual(described.report, error.report);
        assert.deepEqual(Object.keys(error).sort(), ['code', 'report']);
        assert.doesNotMatch(JSON.stringify(described), /synthetic confidential|\.pdf|QA-private/);
        failure = described.report;
        return true;
    });
    return failure;
}

function rejectSource(f, rejected, reason) {
    return async (options) => {
        if ((await fs.readFile(options.sourcePath)).equals(rejected)) throw typedRefusal(reason);
        return f.renderRasterPdf(options);
    };
}

test('a revised document refusal preserves its display while later and future documents publish', async (t) => {
    const f = await fixture(t);
    const failed = 'QA-private.pdf';
    const first = raw('first');
    const revised = raw('unrenderable revision');
    const sentinel = raw('idle sentinel');
    await put(f.settings.archiveDir, failed, first);
    await seed(f, 'sentinel.pdf', sentinel);
    await f.publish();
    const before = new Map((await readManifest(f)).records).get(failed);
    const initialUploads = (await mutations(f)).length;
    await put(f.original, failed, revised);
    await put(f.original, 'later.pdf', raw('later'));
    const publish = () => f.publish({ renderRasterPdf: rejectSource(f, revised) });
    for (let repeat = 0; repeat < 3; repeat++) {
        if (repeat === 2) await put(f.original, 'future.pdf', raw('future'));
        const failure = await isolatedReport(publish);
        assert.equal(failure.failedCount, 1);
        assert.deepEqual(failure.failures, [{ id: sha(revised).slice(0, 16), reason: 'RASTER_INVALID_SOURCE' }]);
        assert.equal(failure.rendered, repeat === 1 ? 0 : 1);
        await assertEndpoints(f, failed, image(first), image(first), revised);
        await assertEndpoints(f, 'sentinel.pdf', image(sentinel), image(sentinel), sentinel);
        await assertEndpoints(f, 'later.pdf', image(raw('later')), image(raw('later')), raw('later'));
        if (repeat === 2) await assertEndpoints(f, 'future.pdf', image(raw('future')), image(raw('future')), raw('future'));
        const state = await readManifest(f);
        assert.deepEqual(new Map(state.records).get(failed), before);
        assert.equal(state.intent, null);
        assert.equal(state.renderStage, undefined);
        assert.ok((await fs.readdir(renderRoot(f))).every((name) => /^[a-f0-9]{64}$/.test(name)));
    }
    assert.deepEqual((await mutations(f)).slice(initialUploads).map(({ sha }) => sha),
        [sha(image(raw('later'))), sha(image(raw('future')))]);
    const correction = raw('corrected');
    await put(f.original, failed, correction);
    assert.equal((await publish()).rendered, 1);
    await assertEndpoints(f, failed, image(correction), image(correction), correction);
    assert.deepEqual(await fs.readFile(blobPath(f, revised)), revised);
});

test('initial refusals count identical sources individually and cap only diagnostics', async (t) => {
    const f = await fixture(t, { localOnly: true });
    const bad = raw('same original');
    for (let index = 0; index < 13; index++) {
        await put(f.settings.archiveDir, `bad-${index}.pdf`, bad);
    }
    await prepareRasterArchive(f.settings);
    await put(f.original, 'z-last.pdf', raw('last'));
    const report = await isolatedReport(() => f.publish({ renderRasterPdf: rejectSource(f, bad, 'RASTER_LIMIT') }));
    assert.equal(report.failedCount, 13);
    assert.deepEqual(report.failures, Array(10).fill({ id: sha(bad).slice(0, 16), reason: 'RASTER_LIMIT' }));
    assert.equal(report.localPublished, 1);
    const records = new Map((await readManifest(f)).records);
    for (let index = 0; index < 13; index++) {
        const path = `bad-${index}.pdf`;
        assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, path)), bad);
        assert.deepEqual(await fs.readFile(join(f.original, path)), bad);
        assert.equal(records.get(path).raster, null);
    }
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'z-last.pdf')), image(raw('last')));
});

test('a typed refusal cannot hide descriptor tampering, and error descriptions require the internal brand', async (t) => {
    const f = await fixture(t, { localOnly: true });
    await prepareRasterArchive(f.settings);
    for (const name of ['a-first', 'b-tampered', 'z-later']) await put(f.original, name + '.pdf', raw(name));
    let fatal;
    await assert.rejects(f.publish({ async renderRasterPdf({ sourcePath, outputHandle }) {
        if ((await fs.readFile(sourcePath)).equals(raw('b-tampered'))) await outputHandle.close();
        throw typedRefusal();
    } }), (error) => {
        fatal = error;
        assert.deepEqual(describeRasterArchiveError(error), { code: 'raster_archive_staging_identity_changed' });
        assert.equal(error.report, undefined);
        return true;
    });
    const fake = Object.assign(new Error('QA-private.pdf'), { code: fatal.code, report: { path: 'QA-private.pdf' } });
    assert.equal(describeRasterArchiveError(fake), null);
    assert.equal(describeRasterArchiveError(Object.create(fatal)), null);
    assert.equal(describeRasterArchiveError({ code: fatal.code, message: 'QA-private.pdf' }), null);
    await absent(join(f.settings.archiveDir, 'z-later.pdf'));
    assert.equal((await readManifest(f)).intent, null);
});

test('spawn ENOENT and EACCES map to fatal renderer I/O errors', async (t) => {
    const { renderRasterPdf } = await import('../eformsign-backup/raster-render.mjs');
    const f = await fixture(t, { localOnly: true });
    const name = 'a-source.pdf';
    const original = await put(f.settings.archiveDir, name, '%PDF-1.7\n%%EOF\n');
    const denied = await put(f.root, 'non-executable-tool', 'placeholder');
    await prepareRasterArchive(f.settings);
    await put(f.original, 'z-later.pdf', raw('later'));
    for (const tool of [join(f.root, 'missing-tool'), denied]) {
        await assert.rejects(renderRasterPdf({ sourcePath: original, outputPath: join(f.root, 'output.pdf'), qpdfBin: tool }),
            { code: 'RASTER_IO_ERROR' });
        await assert.rejects(publishRasterArchive({ ...f.settings, qpdfBin: tool }), (error) => {
            assert.deepEqual(describeRasterArchiveError(error), { code: 'raster_archive_renderer_failed' });
            return true;
        });
        await absent(join(f.settings.archiveDir, 'z-later.pdf'));
    }
});

test('paused explicit republish remains paused until all document refusals resolve', async (t) => {
    const f = await fixture(t, { localOnly: true });
    await put(f.settings.archiveDir, 'old.pdf', raw('old'));
    await prepareRasterArchive(f.settings);
    await f.publish();
    await rollbackRasterArchive(f.settings);
    const bad = raw('unrenderable');
    await put(f.original, 'old.pdf', bad);
    await put(f.original, 'later.pdf', raw('later'));
    const explicitRepublish = true;
    await isolatedReport(() => f.publish({ explicitRepublish, renderRasterPdf: rejectSource(f, bad) }));
    assert.equal((await readManifest(f)).phase, 'paused');
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'old.pdf')), raw('old'));
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, 'later.pdf')), image(raw('later')));
    await assert.rejects(f.publish(), { code: 'raster_archive_publication_paused' });
    await put(f.original, 'old.pdf', raw('fixed'));
    assert.equal((await f.publish({ explicitRepublish })).rendered, 1);
    assert.equal((await readManifest(f)).phase, 'active');
});

test('a document refusal during an ordinary move retains old endpoints and publishes independent work', async (t) => {
    const f = await fixture(t);
    const source = raw('move without prior rendition');
    await seed(f, 'old.pdf', source);
    await movePrivate(f, 'old.pdf', 'new.pdf');
    await put(f.original, 'independent.pdf', raw('independent'));
    const moves = [{ from: 'old.pdf', to: 'new.pdf' }];
    const report = await isolatedReport(() => f.publish({ moves, renderRasterPdf: rejectSource(f, source, 'RASTER_INVALID_OUTPUT') }));
    assert.equal(report.failedCount, 1);
    assert.equal(report.moved, 0);
    for (const root of [f.settings.archiveDir, f.remote]) {
        assert.deepEqual(await fs.readFile(join(root, 'old.pdf')), source);
        await absent(join(root, 'new.pdf'));
        assert.deepEqual(await fs.readFile(join(root, 'independent.pdf')), image(raw('independent')));
    }
    assert.deepEqual(await fs.readFile(join(f.original, 'new.pdf')), source);
    assert.equal((await readManifest(f)).intent, null);
    assert.equal((await f.publish({ moves })).moved, 1);
});

const dateA = Date.parse('2004-02-04T12:34:56.789Z');
const dateB = Date.parse('2026-11-23T01:02:03.456Z');
const dateC = Date.parse('2015-03-05T17:29:28.133Z');

async function datedFile(root, path, bytes, mtimeMs) {
    const file = await put(root, path, bytes);
    await fs.utimes(file, new Date(mtimeMs), new Date(mtimeMs));
    return file;
}

async function assertDate(path, expected) {
    const { mtimeMs } = await fs.stat(path);
    assert.ok(Math.abs(mtimeMs - expected) <= 1, `expected date ${expected}, got ${mtimeMs}`);
}

async function assertDatedEndpoints(f, name, bytes, mtimeMs) {
    for (const root of [f.settings.archiveDir, f.remote]) {
        const path = join(root, name);
        assert.deepEqual(await fs.readFile(path), bytes);
        await assertDate(path, mtimeMs);
    }
}

test('installed rclone preserves per-path signed dates for shared content across rollback and republish', {
    skip: spawnSync(systemRclone, ['version'], { stdio: 'ignore' }).status !== 0,
}, async (t) => {
    const f = await fixture(t);
    await useLocalRclone(f);
    const source = raw('identical signed content');
    await datedFile(f.settings.archiveDir, 'local.pdf', source, dateA);
    await datedFile(f.remote, 'remote.pdf', source, dateB);
    await prepareRasterArchive(f.settings);
    await datedFile(f.original, 'api.pdf', source, dateC);
    const docs = [['local.pdf', dateA], ['remote.pdf', dateB], ['api.pdf', dateC]];
    assert.equal((await f.publish()).rendered, 1);
    for (const [path, date] of docs) {
        await assertDate(join(f.original, path), date);
        await assertDatedEndpoints(f, path, image(source), date);
    }
    const cache = join(renderRoot(f), sha(source), 'output.pdf');
    const protectedDates = await Promise.all([cache, blobPath(f, source)].map(async (path) => (await fs.stat(path)).mtimeMs));
    await assertIdle(f);
    await rollbackRasterArchive(f.settings);
    for (const [path, date] of docs) await assertDatedEndpoints(f, path, source, date);
    await f.publish({ explicitRepublish: true });
    for (const [path, date] of docs) await assertDatedEndpoints(f, path, image(source), date);
    assert.deepEqual(await Promise.all([cache, blobPath(f, source)].map(async (path) => (await fs.stat(path)).mtimeMs)), protectedDates);
});

test('retry repairs mismatching copied date and supports v1 journal and record dates absent', async (t) => {
    const f = await fixture(t);
    const name = 'older.pdf';
    const source = raw('older');
    await datedFile(f.settings.archiveDir, name, source, dateA);
    await prepareRasterArchive(f.settings);
    await f.control({ resetMtimeOnCopy: true });
    await assert.rejects(f.publish(), { code: 'raster_archive_remote_verification_failed' });
    await assertDate(join(f.settings.archiveDir, name), dateA);
    const interrupted = await readManifest(f);
    assert.equal(interrupted.intent.mtimeMs, dateA);
    assert.ok(interrupted.intent.uploadStage);
    delete interrupted.intent.mtimeMs;
    for (const [, entry] of interrupted.records) {
        delete entry.mtimeMs;
        for (const version of entry.history) delete version.mtimeMs;
    }
    await fs.writeFile(manifestPath(f), JSON.stringify(interrupted));
    await f.control({});
    const resumed = await f.publish();
    assert.deepEqual([resumed.rendered, resumed.localPublished, resumed.remotePublished], [0, 0, 1]);
    await assertDatedEndpoints(f, name, image(source), dateA);
    const legacy = await readManifest(f);
    for (const [, entry] of legacy.records) {
        delete entry.mtimeMs;
        for (const version of entry.history) delete version.mtimeMs;
    }
    await fs.writeFile(manifestPath(f), JSON.stringify(legacy));
    for (const root of [f.settings.archiveDir, f.remote]) await datedFile(root, name, image(source), dateB);
    assert.equal((await f.publish()).rendered, 0);
    await assertDatedEndpoints(f, name, image(source), dateA);
    await assertIdle(f);
});

test('configured remote without a provable mtime refuses before archive mutation', async (t) => {
    const f = await fixture(t);
    const name = 'remote-only.pdf';
    await put(f.remote, name, raw('signed'));
    await f.control({ noMtime: true });
    await assert.rejects(prepareRasterArchive(f.settings), { code: 'raster_archive_remote_mtime_unavailable' });
    await absent(f.original);
    await absent(f.settings.stateDir);
    await absent(join(f.settings.archiveDir, name));
    assert.deepEqual(await mutations(f), []);
});

test('installed rclone rollback protects and restores the newest private revisions plus private-only paths', {
    skip: spawnSync(systemRclone, ['version'], { stdio: 'ignore' }).status !== 0,
}, async (t) => {
    const f = await fixture(t);
    await useLocalRclone(f);
    const doc = 'provider/doc.pdf';
    const audit = 'provider/doc_audit.pdf';
    const extra = 'new/download.pdf';
    for (const path of [doc, audit]) await datedFile(f.settings.archiveDir, path, raw(path), dateA);
    await prepareRasterArchive(f.settings);
    await f.publish();
    const latest = raw('new signed revision');
    const auditLatest = raw('new audit');
    await datedFile(f.original, doc, latest, dateB);
    await isolatedReport(() => f.publish({ renderRasterPdf: rejectSource(f, latest) }));
    // These completed downloads were never seen by a mirror publication.
    await datedFile(f.original, audit, auditLatest, dateC);
    await datedFile(f.original, extra, raw('private only'), dateB);
    const expected = [[doc, latest, dateB], [audit, auditLatest, dateC], [extra, raw('private only'), dateB]];
    await datedFile(f.remote, audit, raw('foreign public file'), dateB);
    const before = await fs.readFile(manifestPath(f));
    await assert.rejects(rollbackRasterArchive(f.settings), { code: 'raster_archive_public_version_conflict' });
    assert.deepEqual(await fs.readFile(manifestPath(f)), before);
    await absent(blobPath(f, auditLatest));
    await assertDatedEndpoints(f, doc, image(raw(doc)), dateA);
    await datedFile(f.remote, audit, image(raw(audit)), dateA);
    assert.equal((await rollbackRasterArchive(f.settings)).remoteRestored, 3);
    const offset = (await mutations(f)).length;
    for (const [path, bytes, date] of expected) {
        await assertDatedEndpoints(f, path, bytes, date);
        assert.deepEqual(await fs.readFile(blobPath(f, bytes)), bytes);
    }
    assert.equal((await rollbackRasterArchive(f.settings)).remoteRestored, 0);
    assert.equal((await mutations(f)).length, offset);
    await f.publish({ explicitRepublish: true });
    for (const [path, bytes, date] of expected) await assertDatedEndpoints(f, path, image(bytes), date);
});

test('missing current private authority refuses every active and paused phase before mutation', async (t) => {
    const f = await fixture(t);
    const source = raw('signed original');
    const name = 'active.pdf';
    await seed(f, name, source);
    await put(f.original, 'active_audit.pdf', raw('matching audit'));
    await f.publish();
    const active = join(f.original, name);
    await fs.unlink(active);
    for (const run of [() => prepareRasterArchive(f.settings), () => f.publish(), () => rollbackRasterArchive(f.settings)]) {
        const before = await fs.readFile(manifestPath(f));
        await assert.rejects(run(), { code: 'raster_archive_active_original_missing' });
        assert.deepEqual(await fs.readFile(manifestPath(f)), before);
    }
    await put(f.original, name, source);
    await rollbackRasterArchive(f.settings);
    await fs.unlink(active);
    const before = await Promise.all([f.settings.archiveDir, f.remote, f.settings.stateDir].map(treeSnapshot));
    for (const dryRun of [true, false]) {
        const options = { explicitRepublish: true, dryRun };
        for (const run of [() => prepareRasterArchive(f.settings, options), () => f.publish(options),
            () => rollbackRasterArchive(f.settings, { dryRun })]) {
            await assert.rejects(run(), { code: 'raster_archive_active_original_missing' });
        }
    }
    assert.deepEqual(await Promise.all([f.settings.archiveDir, f.remote, f.settings.stateDir].map(treeSnapshot)), before);
    assert.deepEqual(await fs.readFile(active.replace(f.original, f.settings.archiveDir)), source);
    assert.deepEqual(await fs.readFile(join(f.remote, 'active_audit.pdf')), raw('matching audit'));
    assert.equal((await readManifest(f)).phase, 'paused');
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
});

test('scoped provider moves preflight both dated renditions, replay, reserve old names and ignore independent render refusals', async (t) => {
    const f = await fixture(t);
    const moves = [{ from: 'legacy/doc.pdf', to: 'current/doc.pdf' }, { from: 'legacy/doc_audit.pdf', to: 'current/doc_audit.pdf' }];
    for (const [index, { from }] of moves.entries()) {
        await datedFile(f.settings.archiveDir, from, raw(from), index === 0 ? dateA : dateB);
    }
    await prepareRasterArchive(f.settings);
    const preflight = (pairs) => f.publish({ moves: pairs, preMove: true, movesOnly: true, dryRun: true });
    await assert.rejects(preflight(moves), { code: 'raster_archive_move_raster_unproven' });
    await f.publish();
    const bad = raw('independently unrenderable');
    await put(f.original, 'a-unrelated.pdf', bad);
    await assert.rejects(f.publish({ moves, preMove: true, movesOnly: true }), { code: 'raster_archive_invalid_move_scope' });
    await assert.rejects(f.publish({ movesOnly: true }), { code: 'raster_archive_invalid_move_scope' });
    const [doc, audit] = moves;
    const before = await fs.readFile(manifestPath(f));
    assert.equal((await preflight(moves)).wouldMove, 2);
    assert.deepEqual(await fs.readFile(manifestPath(f)), before);
    await movePrivate(f, doc.from, doc.to);
    await assert.rejects(f.publish({ moves, movesOnly: true }), { code: 'raster_archive_move_original_conflict' });
    assert.deepEqual(await fs.readFile(manifestPath(f)), before);
    await movePrivate(f, audit.from, audit.to);
    await f.control({ failAfter: 'copyto' });
    await assert.rejects(f.publish({ moves, movesOnly: true }), { code: 'raster_archive_remote_copyto_failed' });
    for (const { from } of moves) {
        assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, from)), image(raw(from)));
        assert.deepEqual(await fs.readFile(join(f.remote, from)), image(raw(from)));
    }
    await f.control({});
    assert.equal((await f.publish({ moves, movesOnly: true })).moved, 2);
    assert.equal((await f.publish({ moves, movesOnly: true })).moved, 0);
    const callCount = (await f.calls()).length;
    assert.deepEqual(await inspectRasterArchive(f.settings), {
        manifestPresent: true, unpublished: false, retiredPaths: moves.map(({ from }) => from), phase: 'active',
    });
    assert.equal((await f.calls()).length, callCount);
    for (const [index, { from, to }] of moves.entries()) {
        await assertDatedEndpoints(f, to, image(raw(from)), index === 0 ? dateA : dateB);
        await absent(join(f.settings.archiveDir, from));
        await absent(join(f.remote, from));
    }
    await absent(join(f.settings.archiveDir, 'a-unrelated.pdf'));
    assert.equal(new Map((await readManifest(f)).records).has('a-unrelated.pdf'), false);
    const unrelated = [{ from: doc.to, to: audit.from }];
    await assert.rejects(preflight(unrelated), { code: 'raster_archive_move_collision' });
    const inverse = moves.map(({ from, to }) => ({ from: to, to: from }));
    assert.equal((await preflight(inverse)).wouldMove, 2);
    for (const { from, to } of inverse) await movePrivate(f, from, to);
    assert.equal((await f.publish({ moves: inverse, movesOnly: true })).moved, 2);
    assert.equal((await f.publish({ moves: inverse, movesOnly: true })).moved, 0);
    await put(f.original, 'z-new.pdf', raw('new later'));
    const report = await isolatedReport(() => f.publish({ renderRasterPdf: rejectSource(f, bad) }));
    assert.equal(report.failedCount, 1);
    assert.equal(report.remotePublished, 1);
    assert.deepEqual(await fs.readFile(join(f.remote, 'z-new.pdf')), image(raw('new later')));
});

test('paused legacy handoff requires authenticated per-path bytes and retains earlier private versions', async (t) => {
    for (const localOnly of [false, true]) {
        await t.test(localOnly ? 'local only' : 'Drive', async (t) => {
            const f = await fixture(t, { localOnly });
            const path = 'provider/reissued.pdf';
            const first = raw('original signed');
            const later = raw('legacy reissue');
            const foreign = raw('unrelated private revision');
            await datedFile(f.settings.archiveDir, path, first, dateA);
            await prepareRasterArchive(f.settings);
            await f.publish();
            await rollbackRasterArchive(f.settings);
            const replacePublic = async (root, bytes) => {
                const staged = await datedFile(root, path + '.replacement', bytes, dateB);
                await fs.rename(staged, join(root, path));
            };
            await replacePublic(f.settings.archiveDir, later);
            if (!localOnly) {
                await replacePublic(f.remote, raw('remote disagrees'));
                await f.control({ ids: { ['archive/' + path]: 'legacy-replacement-id' } });
            }
            const proof = { path, sha256: sha(later), size: later.length };
            const opts = { explicitRepublish: true, legacyProofs: [proof] };
            if (!localOnly) {
                await assert.rejects(prepareRasterArchive(f.settings, opts), { code: 'raster_archive_public_version_conflict' });
                await replacePublic(f.remote, later);
            }
            const before = await fs.readFile(manifestPath(f));
            for (const legacyProofs of [[], [{ ...proof, sha256: sha(foreign) }]]) {
                const opts = { explicitRepublish: true, legacyProofs };
                await assert.rejects(prepareRasterArchive(f.settings, opts), { code: 'raster_archive_legacy_proof_required' });
                await assert.rejects(f.publish({ ...opts, dryRun: true }), { code: 'raster_archive_legacy_proof_required' });
            }
            await datedFile(f.original, path, foreign, dateC);
            await assert.rejects(prepareRasterArchive(f.settings, opts), { code: 'raster_archive_original_authority_conflict' });
            assert.deepEqual(await fs.readFile(join(f.original, path)), foreign);
            await datedFile(f.original, path, first, dateA);
            await prepareRasterArchive(f.settings, { ...opts, dryRun: true });
            assert.equal((await f.publish({ ...opts, dryRun: true })).wouldRender, 1);
            assert.deepEqual(await fs.readFile(manifestPath(f)), before);
            assert.deepEqual(await fs.readFile(join(f.original, path)), first);
            await assertDate(join(f.original, path), dateA);
            await prepareRasterArchive(f.settings, opts);
            await prepareRasterArchive(f.settings, opts);
            assert.equal((await readManifest(f)).phase, 'paused');
            assert.equal((await f.publish(opts)).rendered, 1);
            assert.equal((await f.publish(opts)).rendered, 0);
            for (const root of [f.settings.archiveDir, ...(localOnly ? [] : [f.remote])]) {
                assert.deepEqual(await fs.readFile(join(root, path)), image(later));
                await assertDate(join(root, path), dateB);
            }
            assert.deepEqual(await fs.readFile(blobPath(f, first)), first);
            assert.deepEqual(await fs.readFile(blobPath(f, later)), later);
            const versions = new Map((await readManifest(f)).records).get(path).history;
            assert.ok(versions.some(({ raw, mtimeMs }) => raw.sha256 === sha(first) && mtimeMs === dateA));
            assert.ok(versions.some(({ raw, mtimeMs }) => raw.sha256 === sha(later) && mtimeMs === dateB));
        });
    }
});

test('manifest inspection reports validated phases without side effects and refuses ambiguous or invalid state', async (t) => {
    const f = await fixture(t);
    const lock = await fs.open(join(f.root, 'lock'), 'wx', 0o600);
    t.after(() => lock.close());
    const inspect = (settings = f.settings) => inspectRasterArchive(settings, { lockFd: lock.fd });
    const assertPhase = async (phase) => {
        const before = await treeSnapshot(f.root);
        const renderCount = f.renders.length;
        assert.deepEqual(await inspect(), {
            manifestPresent: phase !== null, unpublished: phase === null, retiredPaths: [], phase,
        });
        assert.deepEqual(await treeSnapshot(f.root), before);
        assert.equal(f.renders.length, renderCount);
    };
    await assertPhase(null);
    assert.deepEqual(await f.calls(), []);
    const path = 'known.pdf';
    const bytes = raw('known original');
    await put(f.settings.archiveDir, path, bytes);
    await put(f.remote, path, raw('conflict'));
    await assert.rejects(prepareRasterArchive(f.settings), { code: 'raster_archive_original_authority_conflict' });
    await assertPhase(null);
    const home = dirname(manifestPath(f));
    const scaffold = join(home, 'rendered');
    await fs.mkdir(scaffold, { recursive: true, mode: 0o700 });
    await assertPhase(null);
    const unowned = await put(scaffold, 'foreign.receipt', 'synthetic receipt');
    await assert.rejects(inspect(), { code: 'raster_archive_unproven_manifest_absence' });
    await fs.unlink(unowned);
    await put(f.remote, path, bytes);
    await prepareRasterArchive(f.settings);
    await f.publish();
    await fs.link(join(f.original, path), join(f.original, '.provider-recovery-stage.tmp'));
    await assertPhase('active');
    await assert.rejects(prepareRasterArchive(f.settings), { code: 'raster_archive_unsafe_file' });
    await fs.unlink(join(f.original, '.provider-recovery-stage.tmp'));
    await prepareRasterArchive(f.settings);
    const beforeRefusal = await treeSnapshot(f.root);
    await assert.rejects(inspect({ ...f.settings, rcloneRemote: 'fake:foreign' }), { code: 'raster_archive_binding_changed' });
    assert.deepEqual(await treeSnapshot(f.root), beforeRefusal);
    const manifest = await fs.readFile(manifestPath(f));
    for (const invalid of ['malformed', JSON.stringify({ ...JSON.parse(manifest), phase: 'unknown' })]) {
        await fs.writeFile(manifestPath(f), invalid);
        await assert.rejects(inspect(), { code: 'raster_archive_invalid_manifest' });
    }
    await fs.writeFile(manifestPath(f), manifest);
    await f.control({ failBefore: 'copyto' });
    await assert.rejects(rollbackRasterArchive(f.settings), { code: 'raster_archive_remote_copyto_failed' });
    await assertPhase('rolling-back');
    await f.control({});
    await rollbackRasterArchive(f.settings);
    await assertPhase('paused');
    await fs.unlink(manifestPath(f));
    await assert.rejects(inspect(), { code: 'raster_archive_unproven_manifest_absence' });
});

test('rollback resumes its older issued journal and then restores the latest proven private version', async (t) => {
    const f = await fixture(t);
    const name = 'during-rollback.pdf';
    const first = raw('first signed version');
    const second = raw('second signed version');
    const third = raw('download finished during interrupted rollback');
    await datedFile(f.settings.archiveDir, name, first, dateA);
    await prepareRasterArchive(f.settings);
    await f.publish();
    await datedFile(f.original, name, second, dateB);
    await f.control({ failBefore: 'copyto' });
    await assert.rejects(rollbackRasterArchive(f.settings), { code: 'raster_archive_remote_copyto_failed' });
    const partial = await readManifest(f);
    assert.equal(partial.phase, 'rolling-back');
    assert.equal(partial.intent.raw.sha256, sha(second));
    assert.equal(partial.intent.mtimeMs, dateB);
    assert.ok(new Map(partial.records).get(name).history.some(({ raw, mtimeMs }) => raw.sha256 === sha(second) && mtimeMs === dateB));
    await datedFile(f.original, name, third, dateC);
    const offset = (await mutations(f)).length;
    await f.control({});
    assert.equal((await rollbackRasterArchive(f.settings)).remoteRestored, 2);
    assert.deepEqual((await mutations(f)).slice(offset).map(({ sha: digest }) => digest), [sha(second), sha(third)]);
    await assertDatedEndpoints(f, name, third, dateC);
    assert.equal((await readManifest(f)).phase, 'paused');
    assert.equal((await rollbackRasterArchive(f.settings)).remoteRestored, 0);
});
