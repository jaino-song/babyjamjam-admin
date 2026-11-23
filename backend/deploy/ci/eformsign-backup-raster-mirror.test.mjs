import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { prepareRasterArchive, publishRasterArchive, rollbackRasterArchive } from '../eformsign-backup/raster-mirror.mjs';

const raw = (name) => Buffer.from('%PDF-1.7\nsynthetic signed ' + name);
const image = (source) => Buffer.concat([Buffer.from('%PDF-1.7\nimage\0\xff', 'latin1'), Buffer.from(sha(source), 'hex')]);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const mode = async (path) => (await fs.stat(path)).mode & 0o777;

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
const common = [
    '--retries', '1', '--low-level-retries', '2', '--contimeout', '10s', '--timeout', '45s',
    '--log-level', 'ERROR', '--log-file=', '--drive-skip-shortcuts=false', '--drive-skip-dangling-shortcuts=false',
    '--drive-use-trash=true', '--local-unicode-normalization=false', '--links=true', '--copy-links=false',
];
const expected = {
    lsjson: [[], ['--stat'], ['--hash-type', 'MD5'], ['--recursive', '--hash-type', 'MD5']],
    cat: [[]],
    copyto: [['--ignore-times']],
    deletefile: [[]],
};
const valid = Object.hasOwn(expected, command) && expected[command].some((specific) =>
    JSON.stringify(flags) === JSON.stringify(specific.concat(common)));
if (at < 0 || !valid || operands.length !== (command === 'copyto' ? 2 : 1)) stop();
function getKey(operand) {
    if (!operand.startsWith('fake:')) stop();
    const key = operand.slice(5);
    if (key.startsWith('/') || key.split('/').includes('..')) stop();
    return key;
}
const key = getKey(operands.at(-1));
const file = path.join(root, key);
let locked = false;
try { fs.fstatSync(3); locked = fs.readlinkSync('/proc/self/fd/3') === path.join(__dirname, 'lock'); } catch {}
const hash = (bytes, kind = 'sha256') => crypto.createHash(kind).update(bytes).digest('hex');
const input = command === 'copyto' ? fs.readFileSync(operands[0]) : null;
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ command, key, locked, sha: input && hash(input), flags }) + '\n');
function info(key, relative) {
    const full = path.join(root, key);
    const stat = fs.lstatSync(full);
    const isDir = stat.isDirectory();
    return {
        Name: path.basename(relative), Path: relative, IsDir: isDir, Size: isDir ? -1 : stat.size,
        ModTime: stat.mtime.toISOString(),
        ...(control.noIds ? {} : { ID: control.ids?.[key] ?? 'id:' + key }),
        ...(flags.includes('--hash-type') && !isDir && !control.noHashes
            ? { Hashes: { MD5: hash(fs.readFileSync(full), 'md5') } } : {}),
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
    process.stdout.write(JSON.stringify(flags.includes('--stat') ? info(key, key) : list(key)));
} else if (command === 'cat') {
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) stop();
    process.stdout.write(fs.readFileSync(file));
} else {
    if (control.failBefore === command) stop();
    if (command === 'copyto') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, input);
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
    const renderRasterPdf = async ({ sourcePath, outputPath, lockFd }) => {
        const source = await fs.readFile(sourcePath);
        renders.push({ sha: sha(source), lockFd });
        await fs.writeFile(outputPath, image(source), { flag: 'wx', mode: 0o600 });
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
    assert.ok((await f.calls()).every(({ command }) => ['lsjson', 'cat'].includes(command)));
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
    assert.ok((await f.calls()).slice(offset).every(({ command }) => command === 'lsjson'));
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
        renderRasterPdf: async ({ outputPath }) => {
            await fs.writeFile(outputPath, 'unfinished');
            throw new Error('private document.pdf with confidential stderr');
        },
    }), { message: 'raster_archive_renderer_failed' });
    assert.deepEqual(await fs.readFile(join(f.settings.archiveDir, name)), source);
    assert.deepEqual(await fs.readFile(blobPath(f, source)), source);
    assert.equal((await f.publish()).rendered, 1);
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
    await movePrivate(f, old, next);
    assert.equal((await prepareRasterArchive(f.settings)).captured, 0);
    await absent(join(f.original, old));
    await assert.rejects(f.publish(), { message: 'raster_archive_move_intent_missing' });
    await f.control({ failAfter: 'deletefile' });
    const lock = await fs.open(await put(f.root, 'lock', ''), 'r');
    t.after(() => lock.close());
    const moves = [{ from: old, to: next }];
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
    await assert.rejects(prepareRasterArchive(f.settings), { message: 'raster_archive_move_intent_missing' });
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

const systemRclone = '/usr/bin/rclone';
test('installed rclone copyto, lsjson, cat and deletefile work on a hermetic local backend', {
    skip: spawnSync(systemRclone, ['version'], { stdio: 'ignore' }).status !== 0,
}, async (t) => {
    const f = await fixture(t);
    // This wrapper supplies only a local backend config and changes the working
    // directory to the synthetic remote root. It cannot resolve a Drive remote.
    const config = await put(f.root, 'rclone.conf', '[sandbox]\ntype = local\n');
    const wrapper = [
        '#!/bin/sh',
        'cd ' + JSON.stringify(join(f.root, 'drive')) + ' || exit 1',
        'exec /usr/bin/rclone --config ' + JSON.stringify(config) + ' "$@"',
    ].join('\n');
    await fs.writeFile(f.settings.rcloneBin, wrapper);
    f.settings.rcloneRemote = 'sandbox:archive';
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
