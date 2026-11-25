import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const unit = new URL('../eformsign-backup/', import.meta.url);
const raster = ['--raster'];
const archive = ['--raster-archive'];
const migrate = ['--raster', '--migrate-provider-contracts'];
const SIGNED = ['signed-doc', 'signed-audit'];
const TOKEN = 'fixture-token-value';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pair = (folder, name) => [`${folder}/${name}.pdf`, `${folder}/감사추적/[감사추적]_${name}.pdf`];
const oldPair = pair('기타', 'Synthetic Private Name');
const newPair = pair('제공인력 계약서', '제공인력_계약서_Synthetic Private Name_2026-01-02');
const derivative = (bytes) => 'public-image:' + bytes;
const put = async (path, content) => {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, content, { mode: 0o600 });
};
const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));
const absent = (path) => assert.rejects(fs.lstat(path), { code: 'ENOENT' });

const fixtureMirror = String.raw`
import assert from 'node:assert/strict';
import { fstatSync, readFileSync, appendFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const { TEST_DRIVE, TEST_EVENTS, TEST_FAIL, TEST_LOCK, TEST_EXPLICIT, TEST_AGGREGATE, TEST_INSPECTION } = process.env;
const log = (row) => appendFileSync(TEST_EVENTS, JSON.stringify(row) + '\n');
const read = (path) => fs.readFile(path, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
});
async function list(root, prefix = '') {
    const entries = await fs.readdir(join(root, prefix), { withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
    });
    const paths = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const path = join(prefix, entry.name);
        if (entry.isDirectory()) paths.push(...await list(root, path));
        else if (entry.isFile() && path.endsWith('.pdf')) paths.push(path);
        else if (entry.isSymbolicLink() && path.endsWith('.pdf')) throw Error('unexpected link');
    }
    return paths.sort();
}
async function put(path, bytes) {
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, bytes, { mode: 0o600 });
}
const codes = new WeakMap();
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestPath = ({ stateDir }) => join(stateDir, 'fixture-mirror.json');
const manifest = async (settings) => JSON.parse(await read(manifestPath(settings)));
const store = (settings, value) => put(manifestPath(settings), JSON.stringify(value));
const known = (code, report) => {
    const error = new Error('fixture-token-value Synthetic Private Name /private/source.pdf');
    codes.set(error, { code, report, private: error.message });
    throw error;
};
export function describeRasterArchiveError(error) {
    if (TEST_FAIL === 'throw-inspector') throw Error('fixture-token-value /private/source.pdf');
    return codes.get(error) ?? null;
}
function start(call, settings, options) {
    assert.ok(Number.isInteger(options.lockFd) && fstatSync(options.lockFd).isFile());
    assert.equal(spawnSync('/usr/bin/flock', ['-n', '-E', '75', TEST_LOCK, 'true']).status, 75);
    assert.ok(!('tokenFile' in settings));
    log({ call, settings, options });
    if (call === 'inspect') return;
    if (call === 'prepare' && TEST_FAIL === 'kill-prepare' && !options.dryRun) process.kill(process.pid, 'SIGKILL');
    assert.equal(options.explicitRepublish === true, TEST_EXPLICIT === 'yes');
    if (TEST_FAIL === call && (!options.dryRun || call === 'rollback')
        || TEST_FAIL === 'dry-' + call && options.dryRun
        || call === 'publish' && !options.dryRun && ['throw-inspector', 'hostile-code'].includes(TEST_FAIL)) {
        class SpoofedMirrorError extends Error {}
        throw Object.assign(new SpoofedMirrorError('raster_archive_public_version_conflict '
            + settings.originalArchiveDir + ' signed-doc Synthetic Private Name fixture-token-value'),
        { code: 'raster_archive_public_version_conflict', report: { failedCount: 99 } });
    }
    if (TEST_FAIL === 'known-' + call && !options.dryRun) {
        known(call === 'prepare' ? 'raster_archive_binding_changed' : 'raster_archive_public_version_conflict',
            { failedCount: 99, raw: settings.originalArchiveDir });
    }
    if (TEST_FAIL === 'aggregate-' + call && !options.dryRun) {
        known('raster_archive_documents_failed', JSON.parse(TEST_AGGREGATE));
    }
}
async function strictPrivate(settings) {
    for (const path of await list(settings.originalArchiveDir)) {
        const info = await fs.lstat(join(settings.originalArchiveDir, path));
        assert.equal(info.nlink, 1);
    }
}
export async function inspectRasterArchive(settings, options) {
    start('inspect', settings, options);
    await strictPrivate(settings);
    if (TEST_INSPECTION) return JSON.parse(TEST_INSPECTION);
    const state = await manifest(settings);
    const unpublished = !state && (await list(settings.originalArchiveDir)).length === 0;
    const result = { manifestPresent: Boolean(state), unpublished, retiredPaths: state?.retiredPaths ?? [], phase: state?.phase ?? null };
    if (TEST_FAIL === 'invalid-inspection') return { ...result, retiredPaths: ['../private/source.pdf'] };
    if (TEST_FAIL === 'missing-phase') delete result.phase;
    return result;
}
async function checkCapture(settings, options) {
    const { archiveDir, originalArchiveDir } = settings;
    const current = await manifest(settings);
    if (current?.phase === 'paused' && !options.explicitRepublish) known('raster_archive_publication_paused');
    if (!current || current.phase === 'paused') {
        for (const path of await list(archiveDir)) {
            const bytes = await read(join(archiveDir, path));
            const privateBytes = await read(join(originalArchiveDir, path));
            if (privateBytes === null || privateBytes === bytes
                || current?.phase === 'paused' && bytes === 'public-image:' + privateBytes) continue;
            const proof = options.legacyProofs?.find((value) => value.path === path);
            if (current?.phase !== 'paused' || proof?.sha256 !== digest(bytes) || proof.size !== Buffer.byteLength(bytes)
                || settings.rcloneRemote && bytes !== await read(join(TEST_DRIVE, path))) {
                known('raster_archive_public_version_conflict');
            }
        }
    }
    return current;
}
export async function prepareRasterArchive(settings, options) {
    start('prepare', settings, options);
    assert.equal(Object.hasOwn(options, 'preMove'), false);
    await strictPrivate(settings);
    if (options.moves) {
        assert.equal(options.movesOnly, true);
        return { opaque: 301 };
    }
    const current = await checkCapture(settings, options);
    if (options.dryRun) {
        if (!options.bootstrapId) return { opaque: 301 };
        const inventory = [];
        for (const root of [settings.archiveDir, settings.originalArchiveDir, TEST_DRIVE]) {
            const entries = await list(root);
            inventory.push(await Promise.all(entries.map(async (path) => [path, digest(await read(join(root, path)))])));
        }
        return { bootstrap: { id: options.bootstrapId, digest: digest(JSON.stringify(inventory)),
            rootChains: [[], [], []], homeId: null, legacy: null } };
    }
    const { archiveDir, originalArchiveDir } = settings;
    await fs.mkdir(originalArchiveDir, { mode: 0o700, recursive: true });
    if (!current || current.phase === 'paused' && Object.hasOwn(options, 'legacyProofs')) {
        for (const path of await list(archiveDir)) {
            await put(join(originalArchiveDir, path), await read(join(archiveDir, path)));
            if (TEST_FAIL === 'captured-before-manifest') throw Error('fixture-token-value');
        }
    }
    if (!current) await store(settings, { phase: 'active', retiredPaths: [] });
    await options.beforeCapture?.();
    return { opaque: 301 };
}
export async function publishRasterArchive(settings, options) {
    start('publish', settings, options);
    const { archiveDir, originalArchiveDir, rcloneRemote } = settings;
    const roots = rcloneRemote ? [archiveDir, TEST_DRIVE] : [archiveDir];
    const current = await manifest(settings);
    const moves = options.moves ?? [];
    const expected = [];
    if (moves.length) {
        assert.equal(options.movesOnly, true);
        assert.equal(Boolean(options.preMove), Boolean(options.dryRun));
    } else {
        assert.equal(Object.hasOwn(options, 'movesOnly'), false);
        assert.equal(Object.hasOwn(options, 'preMove'), false);
        if (options.dryRun) await checkCapture(settings, options);
    }
    for (const { from, to } of moves) {
        const raw = await read(join(originalArchiveDir, options.preMove ? from : to));
        assert.notEqual(raw, null);
        const bytes = 'public-image:' + raw;
        for (const root of roots) {
            assert.ok([null, bytes].includes(await read(join(root, to))));
            assert.equal(await read(join(root, from)), bytes);
        }
        expected.push({ from, to, bytes });
    }
    if (options.dryRun) return { opaque: 302 };
    const failures = [];
    if (!moves.length) {
        for (const path of await list(originalArchiveDir)) {
            const raw = await read(join(originalArchiveDir, path));
            if (raw.startsWith('bad-limit:') && TEST_FAIL !== 'repaired') {
                failures.push({ id: digest(path.normalize('NFC')).slice(0, 16), reason: 'RASTER_LIMIT' });
                continue;
            }
            for (const root of roots) await put(join(root, path), 'public-image:' + raw);
        }
        if (failures.length) known('raster_archive_documents_failed',
            { failedCount: failures.length, failures: failures.slice(0, 10), raw: originalArchiveDir });
    }
    if (TEST_FAIL === 'move-publish' && moves.length) throw Error('Synthetic Private Name ' + originalArchiveDir);
    if (TEST_FAIL === 'move-aggregate' && moves.length) known('raster_archive_documents_failed', JSON.parse(TEST_AGGREGATE));
    const retired = new Map(current.retiredPaths.map((path) => [path.normalize('NFC'), path]));
    for (const { from, to, bytes } of expected) {
        for (const root of roots) {
            await put(join(root, to), bytes);
            await fs.unlink(join(root, from));
        }
        retired.set(from.normalize('NFC'), from);
        retired.delete(to.normalize('NFC'));
    }
    if (moves.length || current.phase !== 'active') {
        await store(settings, { phase: 'active', retiredPaths: [...retired.values()] });
    }
    log({ call: 'published' });
    return { opaque: 302 };
}
export async function rollbackRasterArchive(settings, options) {
    start('rollback', settings, options);
    const { archiveDir, originalArchiveDir, rcloneRemote } = settings;
    const roots = rcloneRemote ? [archiveDir, TEST_DRIVE] : [archiveDir];
    for (const path of await list(originalArchiveDir)) {
        for (const root of roots) {
            const raw = await read(join(originalArchiveDir, path));
            await put(join(root, path), raw);
            assert.equal(await read(join(root, path)), raw);
        }
    }
    await store(settings, { ...await manifest(settings), phase: 'paused' });
    return { opaque: 303 };
}
`;

const instrument = String.raw`
import { appendFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const { readFile, link, open, rename } = fs;
const { TEST_TOKEN, TEST_EVENTS, TEST_FAIL_LINK, TEST_KILL_LINK, TEST_KILL_RESTORE } = process.env;
const crash = process.env.TEST_RASTER_CRASH;
const kill = () => process.kill(process.pid, 'SIGKILL');
const observeToken = (path) => {
    if (String(path) === TEST_TOKEN) appendFileSync(TEST_EVENTS, '{"call":"token"}\n');
};
fs.readFile = async (path, ...rest) => {
    observeToken(path);
    return readFile(path, ...rest);
};
fs.open = async (path, ...rest) => {
    observeToken(path);
    if (crash === 'before-bootstrap' && String(path).includes('/.bootstrap-')
        || crash === 'after-blob' && String(path).includes('/.original-')) kill();
    return open(path, ...rest);
};
fs.rename = async (from, to) => {
    if (String(to).endsWith('/manifest.json') && (crash === 'before-authority' && String(from).includes('/.bootstrap-')
        || crash === 'after-capture' && String(from).includes('/.journal-'))) kill();
    if (crash === 'before-active' && String(to).endsWith('/raster-cutover.json')
        && JSON.parse(await readFile(from, 'utf8')).phase === 'active') kill();
    return rename(from, to);
};
fs.link = async (from, to) => {
    if (TEST_FAIL_LINK && String(to).includes('/제공인력 계약서/')) throw Error('private stage failure ' + to);
    const result = await link(from, to);
    if (TEST_KILL_LINK && String(from).endsWith('/payload.stage') && String(to).endsWith('.pdf')
        || TEST_KILL_RESTORE && String(from).includes('/records/pre-raster-') && String(to).endsWith('/journal.json')) {
        process.kill(process.pid, 'SIGKILL');
    }
    return result;
};
syncBuiltinESMExports();
`;

const rawDrive = String.raw`#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { dirname, join } = require('node:path');
const args = process.argv.slice(2);
const [command] = args;
const root = process.env.TEST_DRIVE;
fs.appendFileSync(process.env.TEST_RAW_DRIVE, JSON.stringify(args) + '\n');
if (command === 'copy') {
    fs.cpSync(args[2], root, { recursive: true });
    process.exit(0);
}
const delimiter = args.indexOf('--');
assert.ok(delimiter > 0);
const operands = args.slice(delimiter + 1);
const flags = args.slice(1, delimiter);
const common = [
    '--retries', '1', '--low-level-retries', '2', '--contimeout', '10s', '--timeout', '45s',
    '--log-level', 'ERROR', '--log-file=', '--drive-skip-dangling-shortcuts=false',
    '--drive-use-trash=true', '--local-unicode-normalization=false', '--links=true', '--copy-links=false',
    '--drive-skip-shortcuts=true',
];
const expected = {
    listremotes: [['--long']],
    lsjson: [['--stat'], []],
    cat: [[]],
    copyto: [['--immutable', '--ignore-existing']],
    deletefile: [[]],
};
assert.ok(Object.hasOwn(expected, command) && expected[command].some((specific) =>
    JSON.stringify(flags) === JSON.stringify(specific.concat(common))));
const operandCount = command === 'listremotes' ? 0 : command === 'copyto' ? 2 : 1;
assert.equal(operands.length, operandCount);
const target = (remote) => {
    assert.ok(remote.startsWith('mock:'));
    const path = remote.slice(5);
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'));
    return join(root, path);
};
const entry = (path, name) => {
    const stat = fs.lstatSync(path);
    const isDirectory = stat.isDirectory();
    return {
        Name: name, Path: name, IsDir: isDirectory, ID: String(stat.ino),
        Size: isDirectory ? -1 : stat.size,
        ModTime: stat.mtime.toISOString(), MimeType: isDirectory ? 'inode/directory' : 'application/pdf',
    };
};
if (command === 'listremotes') {
    console.log('mock: local');
} else if (command === 'lsjson') {
    const dir = target(operands[0]);
    if (flags[0] === '--stat') {
        assert.equal(operands[0], 'mock:');
        console.log(JSON.stringify(entry(dir, '')));
    } else {
        console.log(JSON.stringify(fs.readdirSync(dir).map((name) => entry(join(dir, name), name))));
    }
} else if (command === 'cat') {
    process.stdout.write(fs.readFileSync(target(operands[0])));
} else if (command === 'copyto') {
    const final = target(operands[1]);
    fs.mkdirSync(dirname(final), { recursive: true });
    fs.copyFileSync(operands[0], final, fs.constants.COPYFILE_EXCL);
} else if (command === 'deletefile') {
    fs.unlinkSync(target(operands[0]));
}
`;

const mirrorDrive = String.raw`#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { basename, dirname, join, relative } = require('node:path');
const [command, ...args] = process.argv.slice(2);
const delimiter = args.indexOf('--');
assert.ok(delimiter >= 0);
const flags = args.slice(0, delimiter);
const operands = args.slice(delimiter + 1);
const root = process.env.TEST_DRIVE;
const hidden = process.env.TEST_HIDDEN_REMOTE;
const inclusive = flags.includes('--drive-skip-shortcuts=false');
const parent = flags.find((flag) => flag.startsWith('--drive-root-folder-id='));
const remotePath = (operand) => {
    assert.ok(operand.startsWith('mock:'));
    return join(root, operand.slice(5));
};
const hash = (bytes, kind = 'sha256') => createHash(kind).update(bytes).digest('hex');
const info = (path, name) => {
    const stat = fs.lstatSync(path);
    return { Name: basename(name), Path: name, ID: String(stat.ino), IsDir: stat.isDirectory(),
        Size: stat.isDirectory() ? -1 : stat.size, ModTime: stat.mtime.toISOString(),
        MimeType: stat.isDirectory() ? 'inode/directory' : 'application/pdf',
        ...(stat.isFile() && flags.includes('--hash-type') && { Hashes: { md5: hash(fs.readFileSync(path), 'md5') } }) };
};
function list(dir, prefix = '') {
    return fs.readdirSync(join(dir, prefix)).flatMap((name) => {
        const path = join(prefix, name);
        const full = join(dir, path);
        if (!inclusive && relative(root, full) === hidden) return [];
        const row = info(full, path);
        return row.IsDir && flags.includes('--recursive') ? [row, ...list(dir, path)] : [row];
    });
}
function findDir(id, dir = root) {
    if (String(fs.statSync(dir).ino) === id) return dir;
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!file.isDirectory()) continue;
        const found = findDir(id, join(dir, file.name));
        if (found) return found;
    }
}
const path = operands.length && (parent ? findDir(parent.split('=')[1]) : remotePath(operands.at(-1)));
const input = command === 'copyto' && fs.readFileSync(operands[0]);
fs.appendFileSync(process.env.TEST_RAW_DRIVE, JSON.stringify({
    command, key: path ? relative(root, path) : null, inclusive, sha: input && hash(input),
}) + '\n');
if (command === 'listremotes') {
    console.log(hidden || process.env.TEST_DRIVE_BACKEND === 'drive' ? 'mock: drive' : 'mock: local');
} else if (command === 'lsjson') {
    console.log(JSON.stringify(flags.includes('--stat') ? info(path, '') : list(path)));
} else if (command === 'cat') {
    process.stdout.write(fs.readFileSync(path));
} else if (command === 'copyto') {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, input);
    const source = fs.statSync(operands[0]);
    fs.utimesSync(path, source.atime, source.mtime);
} else if (command === 'deletefile') {
    fs.unlinkSync(path);
} else {
    assert.fail(command);
}
`;

const qpdf = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { dirname } = require('node:path');
const args = process.argv.slice(2);
const inputs = args.slice(2, -2);
const payloads = inputs.map((path) => fs.readFileSync(path));
const staged = inputs.map((path, i) => {
    const root = dirname(path);
    const info = fs.lstatSync(root);
    const input = fs.lstatSync(path);
    return { digest: createHash('sha256').update(payloads[i]).digest('hex'),
        private: root.startsWith('/tmp/eformsign-backup-qpdf-') && root === dirname(args.at(-1))
            && info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o7777) === 0o700
            && path.endsWith('.pdf') && input.isFile() && input.uid === process.getuid() && (input.mode & 0o7777) === 0o600 };
});
fs.appendFileSync(process.env.TEST_EVENTS, JSON.stringify({ call: 'merge', staged }) + '\n');
fs.writeFileSync(args.at(-1), 'merged:' + payloads.join('|'));
`;

async function fixture(t, { explicit = false, remote = true, real = false, driveBackend = 'local' } = {}) {
    const home = await fs.mkdtemp(join(tmpdir(), 'eformsign-raster-cli-'));
    t.after(() => fs.rm(home, { recursive: true, force: true }));
    const worker = join(home, 'worker');
    await fs.mkdir(worker);
    for (const name of [
        'backup.mjs', 'provider-contract-migration.mjs', 'provider-contract-paths.mjs', 'provider-contract-publication.mjs',
        'raster-mirror-remote.mjs', 'raster-mirror-io.mjs', 'ready-events.mjs', 'ready-originals.mjs', 'ready-wake.mjs',
    ]) {
        await fs.copyFile(new URL(name, unit), join(worker, name));
    }
    const publisher = join(worker, 'raster-mirror.mjs');
    const publicRoot = join(home, 'archive');
    const originals = explicit ? join(home, 'separate-originals') : publicRoot + '.originals';
    const stateRoot = join(home, '.local/state/eformsign-backup');
    const guard = join(stateRoot, 'raster-cutover.json');
    const journal = join(stateRoot, 'provider-contract-migration/journal.json');
    const state = join(stateRoot, 'state.json');
    const drive = join(home, 'drive');
    const events = join(home, 'events');
    const rawLog = join(home, 'rclone-log');
    const tokenFile = join(home, 'token-file');
    const settingsPath = join(home, 'settings.json');
    const lock = join(stateRoot, 'run.lock');
    const qpdfBin = join(worker, 'qpdf');
    const rcloneBin = join(worker, 'rclone');
    await Promise.all([
        put(lock, ''),
        real ? fs.copyFile(new URL('raster-mirror.mjs', unit), publisher) : fs.writeFile(publisher, fixtureMirror),
        ...(real ? [fs.copyFile(new URL('raster-render.mjs', unit), join(worker, 'raster-render.mjs'))] : []),
        fs.writeFile(join(worker, 'instrument.mjs'), instrument),
        fs.writeFile(qpdfBin, qpdf, { mode: 0o700 }),
        fs.writeFile(rcloneBin, real ? mirrorDrive : rawDrive, { mode: 0o700 }),
        ...(real && remote ? [fs.mkdir(drive)] : []),
    ]);

    const listing = { docs: [], status: 200, nextCursor: null, postStatus: 201 };
    const requests = [];
    const reports = [];
    const files = new Map();
    const server = createServer(async (req, res) => {
        const { pathname, searchParams } = new URL(req.url, 'http://localhost');
        assert.equal(req.headers.authorization, 'Bearer ' + TOKEN);
        if (pathname.endsWith('/documents')) {
            requests.push('listing');
            if (searchParams.has('cursor')) { res.writeHead(503).end(); return; }
            res.writeHead(listing.status).end(JSON.stringify({ items: listing.docs, nextCursor: listing.nextCursor }));
        } else if (req.method === 'POST' && pathname.endsWith('/runs')) {
            requests.push('report');
            const parts = [];
            for await (const part of req) parts.push(part);
            reports.push(JSON.parse(Buffer.concat(parts)));
            await fs.appendFile(events, '{"call":"report"}\n');
            res.writeHead(listing.postStatus).end();
        } else {
            requests.push('file');
            const data = files.get(decodeURIComponent(pathname.split('/').at(-1)));
            if (data === undefined) res.writeHead(404).end();
            else res.end(data);
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => {
        server.closeAllConnections();
        return new Promise((done) => server.close(done));
    });
    const config = { apiBaseUrl: 'http://127.0.0.1:' + server.address().port, tokenFile, archiveDir: publicRoot,
        stateDir: stateRoot, rcloneBin, qpdfBin: real ? '/usr/bin/qpdf' : qpdfBin, gsBin: real ? '/usr/bin/gs' : 'fixture-gs',
        ...(explicit ? { originalArchiveDir: originals } : {}), ...(remote ? { rcloneRemote: real ? 'mock:' : 'mock:backup' } : {}) };
    const settings = (overrides = {}) => fs.writeFile(settingsPath, JSON.stringify({ ...config, ...overrides }));
    await settings();
    const doc = (id, metadata = {}, bytes = SIGNED) => ({
        docId: id, title: 'Synthetic Private Name', kind: 'other', createdAt: '2026-01-03T00:00:00Z', completed: true,
        ...metadata,
        files: ['document', 'audit_trail'].map((fileType, i) => {
            const fileId = id + '-' + i;
            files.set(fileId, bytes[i]);
            return { fileId, fileType, sha256: sha(bytes[i]), byteSize: Buffer.byteLength(bytes[i]) };
        }),
    });
    const lines = async (path) => (await fs.readFile(path, 'utf8').catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
    })).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const run = async (args = [], code = 0, options = {}) => {
        const start = (await lines(events)).length;
        const previousRequests = requests.length;
        const nodeArgs = ['--import', join(worker, 'instrument.mjs'), join(worker, 'backup.mjs'), '--settings', settingsPath, ...args];
        const command = options.legacyLock ? '/usr/bin/flock' : process.execPath;
        const commandArgs = options.legacyLock ? ['-n', lock, process.execPath, ...nodeArgs] : nodeArgs;
        const result = await exec(command, commandArgs, {
            timeout: real ? 45000 : 12000,
            env: { PATH: process.env.PATH, HOME: home, TEST_TOKEN: tokenFile, TEST_DRIVE: drive, TEST_EVENTS: events,
                TEST_LOCK: lock, TEST_RAW_DRIVE: rawLog, TEST_ORIGINALS: originals, TEST_FAIL: options.fail ?? '',
                TEST_FAIL_LINK: options.interruptRaw ? 'yes' : '',
                TEST_KILL_LINK: options.killLink ? 'yes' : '', TEST_KILL_RESTORE: options.killRestore ? 'yes' : '',
                TEST_RASTER_CRASH: options.crash ?? '', TEST_HIDDEN_REMOTE: options.hiddenRemote ?? '',
                TEST_DRIVE_BACKEND: driveBackend,
                TEST_AGGREGATE: JSON.stringify(options.aggregate ?? {}),
                TEST_INSPECTION: options.inspection ? JSON.stringify(options.inspection) : '',
                TEST_EXPLICIT: options.explicitRetry || args.includes('--raster-archive') && !args.includes('--rollback') ? 'yes' : '' },
        }).catch((error) => error);
        assert.equal(result.signal ?? result.code ?? 0, code, result.stdout + result.stderr);
        assert.equal(result.stderr, '');
        for (const value of [...SIGNED, TOKEN, originals, publicRoot, 'Synthetic Private Name']) {
            assert.ok(!result.stdout.includes(value), 'worker output contained a private fixture value');
        }
        return { log: result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
            events: (await lines(events)).slice(start), requests: requests.slice(previousRequests) };
    };
    const seed = (root, paths, bytes = SIGNED) => Promise.all(paths.map((path, i) => put(join(root, path), bytes[i])));
    return { home, settings, run, publisher, publicRoot, originals, drive, stateRoot, journal, state, lock, guard,
        listing, reports, files, doc, token: () => put(tokenFile, TOKEN), untoken: () => fs.unlink(tokenFile),
        seed, raw: () => lines(rawLog) };
}

const names = (result) => result.events.map(({ call }) => call);
const archiveCalls = (result) => result.events.filter(({ call }) => call === 'prepare' || call === 'publish');
const report = (f, expected) => {
    const run = f.reports.at(-1);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(run[key], value, key);
};
const expect = async (root, paths, bytes) => {
    for (const [i, path] of paths.entries()) assert.equal(await fs.readFile(join(root, path), 'utf8'), bytes[i]);
};
const expectPublished = async (f, paths, raw = SIGNED) => {
    await expect(f.originals, paths, raw);
    for (const root of [f.publicRoot, f.drive]) {
        await expect(root, paths, raw.map(derivative));
        const originals = new Set([...SIGNED, ...raw].map(sha));
        for (const path of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
            if (path.isFile()) assert.ok(!originals.has(sha(await fs.readFile(join(path.parentPath ?? path.path, path.name)))));
        }
    }
};
const stand = async (f, action, code, options) => {
    const result = await f.run([...archive, ...action], code, options);
    assert.ok(!names(result).includes('token'));
    assert.deepEqual(result.requests, []);
    return result;
};
async function snapshot(root) {
    const rows = await fs.readdir(root, { recursive: true, withFileTypes: true }).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return [];
    });
    return Promise.all(rows.map(async (row) => {
        const path = join(row.parentPath ?? row.path, row.name);
        const { mode, size, mtimeMs, ino } = await fs.lstat(path);
        return [path, mode, size, mtimeMs, ino, row.isFile() ? sha(await fs.readFile(path)) : null];
    })).then((entries) => entries.sort(([a], [b]) => a.localeCompare(b)));
}
const tree = (f) => Promise.all([f.publicRoot, f.originals, f.stateRoot, f.drive].map(snapshot));

test('service switch and settings-only opt-in download and report only after publishing a distinct pair', async (t) => {
    const service = await fs.readFile(new URL('eformsign-backup.service', unit), 'utf8');
    const start = service.match(/^ExecStart=(.*)$/m)[1].split(' ');
    assert.deepEqual(start, ['/usr/bin/env', 'node', '%h/eformsign-backup/backup.mjs', '--settings',
        '%h/.config/eformsign-backup/settings.json', '--raster']);
    for (const explicit of [false, true]) {
        const f = await fixture(t, { explicit });
        await stand(f, ['--apply'], 0);
        await f.token();
        f.listing.docs = [f.doc('first')];
        const args = explicit ? [] : start.slice(5);
        const first = await f.run(args);
        assert.deepEqual(first.requests, ['listing', 'file', 'file', 'report']);
        assert.deepEqual(names(first), ['token', 'inspect', 'prepare', 'publish', 'published', 'report']);
        const settings = first.events.find(({ call }) => call === 'prepare').settings;
        assert.deepEqual([settings.archiveDir, settings.originalArchiveDir, settings.stateDir, settings.rcloneRemote, settings.gsBin],
            [f.publicRoot, f.originals, f.stateRoot, 'mock:backup', 'fixture-gs']);
        report(f, { totalDocs: 1, savedFiles: 2, skippedFiles: 0, status: 'success', driveStatus: 'ok' });
        await expectPublished(f, oldPair);
        const entry = (await readJson(f.state)).units['doc:first'];
        assert.deepEqual(entry.files, Object.fromEntries(oldPair.map((path, i) => [path, SIGNED[i].length])));
        assert.equal(entry.fingerprint, SIGNED.map(sha).join(':'));
        const repeat = await f.run(args);
        assert.deepEqual(repeat.requests, ['listing', 'report']);
        report(f, { savedFiles: 0, skippedFiles: 2, status: 'success', driveStatus: 'ok' });
        assert.deepEqual(await f.raw(), []);
    }
});

test('historical folders, private chunks and both merged PDFs are published', async (t) => {
    const f = await fixture(t);
    const historic = ['서비스계약서/old.pdf', '제공기록지/old.pdf', '제공기록지/원본/old.pdf',
        '제공인력 계약서/old.pdf', '기타/old.pdf'];
    await f.seed(f.publicRoot, historic, historic.map(() => 'historic-raw'));
    await put(join(f.publicRoot, '.old/hidden.pdf'), 'hidden');
    await stand(f, ['--apply'], 0);
    await f.token();
    const chunk = (i) => ({ kind: 'service_record', customerName: 'Fixture', serviceStartDate: '2026-01-02',
        serviceRecordChunk: { caseId: 'x', snapshotVersion: 1, chunkCount: 2, chunkIndex: i, firstSessionIndex: i } });
    const second = ['signed-doc-second', 'signed-audit-second'];
    f.listing.docs = [f.doc('two', chunk(1), second), f.doc('one', chunk(0))];
    const result = await f.run(raster);
    const title = '제공기록지_Fixture_2026-01-02';
    const chunks = [pair('제공기록지/원본', title + '_1장'), pair('제공기록지/원본', title + '_2장')];
    await expectPublished(f, chunks[0]);
    await expectPublished(f, chunks[1], second);
    await expectPublished(f, pair('제공기록지', title), SIGNED.map((value, i) => 'merged:' + value + '|' + second[i]));
    await expectPublished(f, historic, historic.map(() => 'historic-raw'));
    const merges = result.events.filter(({ call }) => call === 'merge');
    const expected = await Promise.all([0, 1].map((i) => Promise.all(chunks.map(async (paths) => ({
        digest: sha(await fs.readFile(join(f.originals, paths[i]))), private: true,
    })))));
    assert.deepEqual(merges.map(({ staged }) => staged), expected);
    report(f, { savedFiles: 6, skippedFiles: 0, status: 'success' });
    assert.deepEqual(await f.raw(), []);
});

test('ordinary publication failure preserves raw bytes and retry does not download; setup and listing fail closed', async (t) => {
    const f = await fixture(t);
    await f.token();
    f.listing.docs = [f.doc('first')];
    const before = await f.run(raster, 1);
    assert.deepEqual(before.requests, ['report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    await f.untoken();
    await stand(f, ['--apply'], 0);
    await f.token();
    const failed = await f.run(raster, 2, { fail: 'publish' });
    assert.deepEqual(failed.requests, ['listing', 'file', 'file', 'report']);
    report(f, { status: 'partial', driveStatus: 'failed', savedFiles: 2 });
    await expect(f.originals, oldPair, SIGNED);
    for (const path of oldPair) {
        await absent(join(f.publicRoot, path));
        await absent(join(f.drive, path));
    }
    assert.deepEqual((await f.run(raster)).requests, ['listing', 'report']);
    report(f, { status: 'success', savedFiles: 0, skippedFiles: 2 });
    await expectPublished(f, oldPair);

    const prepare = await f.run(raster, 1, { fail: 'prepare' });
    assert.deepEqual(prepare.requests, ['report']);
    assert.ok(prepare.log.some(({ reason }) => reason === 'raster_prepare_failed'));
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    f.listing.nextCursor = 'next';
    const listing = await f.run(raster, 1);
    assert.deepEqual(listing.requests, ['listing', 'listing', 'report']);
    assert.deepEqual(names(listing), ['token', 'inspect', 'prepare', 'report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });

    f.listing.nextCursor = null;
    await put(join(f.originals, oldPair[0]), 'forged-doc');
    const tampered = await f.run(raster, 1);
    assert.deepEqual(names(tampered), ['token', 'inspect', 'prepare', 'report']);
    assert.equal(f.reports.at(-1).failures[0].reason, 'original_sha256_mismatch');
    await expect(f.publicRoot, oldPair, SIGNED.map(derivative));
    await fs.unlink(f.publisher);
    const missing = await f.run(raster, 1);
    assert.deepEqual(missing.requests, ['report']);
    assert.ok(missing.log.some(({ reason }) => reason === 'raster_publisher_unavailable'));
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    assert.deepEqual(await f.raw(), []);
});

test('standalone lifecycle is offline and immutable in dry-run; rollback gates legacy raw copy', async (t) => {
    const f = await fixture(t);
    await f.seed(f.publicRoot, oldPair);
    await f.seed(f.drive, oldPair);
    const initial = await tree(f);
    assert.deepEqual(names(await stand(f, [], 0)), ['inspect', 'prepare', 'publish']);
    assert.deepEqual(await tree(f), initial);
    await stand(f, ['--apply'], 1, { fail: 'prepare' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    await stand(f, ['--apply'], 1, { fail: 'publish' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    const refused = await f.run([], 1);
    assert.deepEqual(refused.requests, []);
    assert.deepEqual(names(refused), []);
    await stand(f, ['--apply'], 0);
    assert.equal((await readJson(f.guard)).phase, 'active');
    assert.equal((await fs.stat(f.guard)).mode & 0o777, 0o600);
    await expectPublished(f, oldPair);
    await stand(f, ['--apply'], 1, { fail: 'publish' });
    assert.equal((await readJson(f.guard)).phase, 'preparing');
    await stand(f, ['--apply'], 0);
    await stand(f, ['--rollback'], 1, { fail: 'rollback' });
    assert.equal((await readJson(f.guard)).phase, 'rollingBack');
    await stand(f, ['--apply'], 1);
    await stand(f, ['--rollback'], 0);
    await absent(f.guard);
    await expect(f.publicRoot, oldPair, SIGNED);
    await expect(f.drive, oldPair, SIGNED);
    await expect(f.originals, oldPair, SIGNED);
    assert.deepEqual(await f.raw(), []);
    // The pre-cutover invocation takes the lock externally; an uninstalled mirror is fine.
    await fs.unlink(f.publisher);
    await f.token();
    await f.run([], 0, { legacyLock: true });
    assert.equal((await f.raw())[0][0], 'copy');
});

test('legacy follows a lock ancestor link until a cutover entry exists; raster refuses the ancestor', async (t) => {
    const f = await fixture(t);
    const ancestor = join(f.home, '.local');
    const physical = join(f.home, 'old-local');
    await fs.rename(ancestor, physical);
    await fs.symlink(physical, ancestor);
    await f.token();
    f.listing.docs = [f.doc('legacy-record')];
    const first = await f.run([], 0, { legacyLock: true });
    assert.deepEqual(first.requests, ['listing', 'file', 'file', 'report']);
    assert.equal(names(first)[0], 'token');
    await expect(f.publicRoot, oldPair, SIGNED);
    const baseline = await f.raw();
    assert.equal(baseline.length, 1);
    assert.equal(baseline[0][0], 'copy');

    const rejectedRaster = await f.run(archive, 1);
    assert.equal(rejectedRaster.log[0].reason, 'unsafe_raster_directory');
    assert.deepEqual(rejectedRaster.events, []);
    assert.deepEqual(rejectedRaster.requests, []);
    await f.untoken();
    const marker = join(physical, 'state/eformsign-backup/raster-cutover.json');
    for (const variant of ['regular', 'unreadable', 'dangling', 'symlink']) {
        if (variant === 'regular' || variant === 'unreadable') {
            await put(marker, '{}');
            if (variant === 'unreadable') await fs.chmod(marker, 0o000);
        } else {
            await fs.symlink(variant === 'dangling' ? join(f.home, 'absent-marker') : f.state, marker);
        }
        const refused = await f.run([], 1, { legacyLock: true });
        assert.equal(refused.log[0].reason, 'raster_cutover_blocks_legacy');
        assert.deepEqual(refused.requests, []);
        assert.deepEqual(refused.events, []);
        assert.deepEqual(await f.raw(), baseline);
        await fs.unlink(marker);
    }
});

test('invalid modes, unsafe roots, damaged guards and lock contention leave state and API untouched', async (t) => {
    const f = await fixture(t);
    const initial = await tree(f);
    for (const args of [['--raster', '--raster'], [...archive, '--apply', '--rollback'], [...archive, '--limit', '1']]) {
        const result = await f.run(args, 1);
        assert.deepEqual(result.events, []);
        assert.deepEqual(result.requests, []);
    }
    await f.settings({ originalArchiveDir: join(f.publicRoot, 'private') });
    assert.deepEqual((await f.run(raster, 1)).events, []);
    await fs.symlink(f.stateRoot, join(f.home, 'symlink-state'));
    await f.settings({ stateDir: join(f.home, 'symlink-state') });
    assert.deepEqual((await f.run(raster, 1)).events, []);
    await f.settings();
    assert.deepEqual(await tree(f), initial);

    const holder = spawn('/usr/bin/flock', ['-n', f.lock, 'sh', '-c', 'printf held; read gate'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = once(holder, 'close');
    try {
        assert.equal(String((await once(holder.stdout, 'data'))[0]), 'held');
        const result = await stand(f, ['--apply'], 1);
        assert.equal(result.log[0].reason, 'timer_lock_held');
        assert.deepEqual(await tree(f), initial);
    } finally {
        holder.stdin.end('\n');
        await closed;
    }
    await put(f.guard, '{broken');
    const damaged = await stand(f, ['--apply'], 1);
    assert.equal(damaged.log[0].reason, 'invalid_raster_cutover');
    assert.deepEqual((await f.run([], 1)).events, []);
    await fs.unlink(f.guard);
    await stand(f, ['--apply'], 0);
    const active = await tree(f);
    await f.settings({ stateDir: join(f.home, 'foreign-state') });
    const foreign = await f.run(raster, 1);
    assert.deepEqual(foreign.events, []);
    assert.equal(foreign.log[0].reason, 'raster_cutover_settings_changed');
    await f.settings({ rcloneRemote: 'mock:backup/' });
    assert.equal((await stand(f, [], 1)).log[0].reason, 'raster_cutover_settings_changed');
    await f.settings();
    await fs.chmod(f.guard, 0o644);
    assert.equal((await stand(f, [], 1)).log[0].reason, 'unsafe_raster_cutover');
    await fs.chmod(f.guard, 0o600);
    assert.deepEqual(await tree(f), active);
    await fs.unlink(join(f.home, 'settings.json'));
    const missing = await f.run([], 1);
    assert.deepEqual(missing.events, []);
    assert.deepEqual(missing.requests, []);
    assert.deepEqual(await f.raw(), []);
});

test('cutover refuses public scratch and old receipts; preserves only a finished bound predecessor', async (t) => {
    const f = await fixture(t);
    const legacyJournal = { version: 1, id: '12345678-1234-1234-1234-123456789abc', archive: f.publicRoot,
        remote: 'mock:backup', phase: 'applying', moves: [] };
    for (const phase of ['applying', 'rollingBack']) {
        await put(f.journal, JSON.stringify({ ...legacyJournal, phase }));
        assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'finish_legacy_provider_migration_first');
        await absent(f.guard);
    }
    await put(f.journal, JSON.stringify({ ...legacyJournal, archive: join(f.home, 'foreign'), phase: 'applied' }));
    assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'foreign_pre_raster_migration');
    await fs.unlink(f.journal);
    for (const path of [join(f.stateRoot, 'provider-contract-publication.json'), join(f.stateRoot, 'provider-contract-prepared-stages.json'),
        join(f.publicRoot, 'folder/copy.tmp'), join(f.publicRoot, '.provider-contract-x/unsafe'),
        join(f.publicRoot, '.provider-publication-x/unsafe')]) {
        await put(path, 'do not remove');
        const before = await tree(f);
        await stand(f, [], 1);
        await stand(f, ['--apply'], 1);
        assert.deepEqual(await tree(f), before);
        await fs.rm(path.includes('/.provider-') ? dirname(path) : path, { recursive: true });
        await absent(f.guard);
    }
    const savedBytes = JSON.stringify({ ...legacyJournal, phase: 'applied' }, null, 4);
    await put(f.journal, savedBytes);
    const before = await tree(f);
    await stand(f, [], 0);
    assert.deepEqual(await tree(f), before);
    await stand(f, ['--apply'], 1, { fail: 'prepare' });
    const saved = join(dirname(f.journal), 'records/pre-raster-' + legacyJournal.id + '-applied.json');
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.deepEqual((await readJson(f.guard)).predecessor, { id: legacyJournal.id, phase: 'applied' });
    await absent(f.journal);
    await stand(f, ['--apply'], 0);
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.equal((await f.run([...migrate, '--rollback'], 1)).log[0].reason, 'pre_raster_rollback_requires_archive_rollback');
    await stand(f, ['--rollback'], 0);
    assert.equal(await fs.readFile(saved, 'utf8'), savedBytes);
    assert.deepEqual(await f.raw(), []);
});

async function providerFixture(t) {
    const f = await fixture(t);
    await stand(f, ['--apply'], 0);
    await f.token();
    const original = f.doc('provider');
    const sentinel = f.doc('sentinel', { title: 'Synthetic Sentinel' }, ['fixture-doc', 'fixture-audit']);
    f.listing.docs = [original, sentinel];
    await f.run(raster);
    f.listing.docs = [{ ...original, providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } }, sentinel];
    return { ...f, sentinelPaths: pair('기타', sentinel.title) };
}

const movesOf = (result, call = 'publish') => result.events
    .filter((event) => event.call === call && !event.options.dryRun && event.options.moves?.length)
    .map((event) => event.options.moves);
const forward = oldPair.map((path, i) => ({ from: path, to: newPair[i] }));
const reverse = forward.map(({ from, to }) => ({ from: to, to: from }));
const moveCalls = (result) => archiveCalls(result).map(({ call, options }) => {
    const flags = { ...options };
    delete flags.lockFd;
    return { call, options: flags };
});
const moveSteps = (moves) => [
    { call: 'publish', options: { moves, movesOnly: true, preMove: true, dryRun: true } },
    { call: 'prepare', options: { moves, movesOnly: true } },
    { call: 'publish', options: { moves, movesOnly: true } },
];

test('provider forward and reverse publish exact moves, retain durable intent, and replay only the unfinished direction', async (t) => {
    const f = await providerFixture(t);
    const before = await tree(f);
    const plan = await f.run(migrate);
    assert.deepEqual(plan.requests, ['listing']);
    assert.deepEqual(moveCalls(plan), moveSteps(forward).slice(0, 1));
    assert.deepEqual(await tree(f), before);
    const apply = await f.run([...migrate, '--apply'], 1, { fail: 'move-publish' });
    assert.deepEqual(apply.requests, ['listing']);
    assert.deepEqual(moveCalls(apply), moveSteps(forward));
    let journal = await readJson(f.journal);
    assert.equal(journal.phase, 'applied');
    assert.deepEqual([journal.raster.direction, journal.raster.pending, journal.raster.moves], ['forward', true, forward]);
    await expect(f.originals, newPair, SIGNED);
    for (const path of oldPair) await absent(join(f.originals, path));
    assert.deepEqual((await f.run([...migrate, '--rollback'], 1)).events, []);
    await stand(f, ['--rollback'], 1);
    await f.untoken();
    f.listing.status = 503;
    const retry = await f.run([...migrate, '--apply']);
    assert.deepEqual(retry.requests, []);
    assert.deepEqual(moveCalls(retry), moveSteps(forward).slice(1));
    assert.ok(!names(retry).includes('token'));
    await expectPublished(f, newPair);
    for (const root of [f.publicRoot, f.drive]) for (const path of oldPair) await absent(join(root, path));
    assert.equal((await readJson(f.journal)).raster.pending, false);
    await f.token();
    f.listing.status = 200;
    assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), []);
    await f.untoken();

    const failedReverse = await f.run([...migrate, '--rollback'], 1, { fail: 'move-publish' });
    assert.deepEqual(failedReverse.requests, []);
    assert.deepEqual(moveCalls(failedReverse), moveSteps(reverse));
    journal = await readJson(f.journal);
    assert.equal(journal.phase, 'rolledBack');
    assert.deepEqual([journal.raster.direction, journal.raster.pending, journal.raster.moves], ['reverse', true, reverse]);
    assert.deepEqual((await f.run([...migrate, '--apply'], 1)).events, []);
    await f.token();
    const ordinary = await f.run(raster);
    assert.deepEqual(movesOf(ordinary), [reverse]);
    assert.deepEqual(movesOf(ordinary, 'prepare'), [reverse]);
    assert.deepEqual(names(ordinary), ['token', 'inspect', 'prepare', 'publish', 'published', 'prepare', 'publish', 'published', 'report']);
    assert.deepEqual(ordinary.requests, ['listing', 'report']);
    assert.equal((await readJson(f.journal)).raster.pending, false);
    await expectPublished(f, oldPair);
    for (const root of [f.originals, f.publicRoot, f.drive]) for (const path of newPair) await absent(join(root, path));
    assert.deepEqual(movesOf(await f.run([...migrate, '--rollback'])), []);
    assert.deepEqual(movesOf(await f.run(raster)), []);
    await expectPublished(f, f.sentinelPaths, ['fixture-doc', 'fixture-audit']);
    assert.deepEqual(await f.raw(), []);
});

test('provider validates foreign state, collisions, and refuses ordinary polling while raw relocation is incomplete', async (t) => {
    const f = await providerFixture(t);
    await put(join(f.originals, newPair[0]), 'foreign');
    const target = await f.run([...migrate, '--apply'], 1);
    assert.equal(target.log[0].reason, 'local_target_exists');
    assert.deepEqual(names(target), ['token', 'inspect']);
    await fs.unlink(join(f.originals, newPair[0]));
    await put(join(f.drive, newPair[0]), 'foreign');
    const conflict = await f.run(migrate, 1);
    assert.equal(conflict.log[0].reason, 'raster_publish_failed');
    assert.equal((await f.run([...migrate, '--apply'], 1)).log[0].reason, 'raster_publish_failed');
    assert.equal(await fs.readFile(join(f.drive, newPair[0]), 'utf8'), 'foreign');
    await expect(f.originals, oldPair, SIGNED);
    await absent(f.journal);
    await fs.unlink(join(f.drive, newPair[0]));

    const interrupted = await f.run([...migrate, '--apply'], 1, { interruptRaw: true });
    assert.deepEqual(movesOf(interrupted), []);
    const saved = await readJson(f.journal);
    assert.equal(saved.phase, 'applying');
    assert.deepEqual([saved.raster.pending, saved.raster.moves], [true, forward]);
    assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
    report(f, { status: 'failed', driveStatus: 'failed', savedFiles: 0 });
    await stand(f, ['--rollback'], 1);
    await put(f.journal, JSON.stringify({ ...saved, archive: '/foreign-originals' }));
    assert.equal((await f.run([...migrate, '--apply'], 1)).log[0].reason, 'migration_settings_changed');
    await put(f.journal, JSON.stringify(saved));
    await f.untoken();
    const retry = await f.run([...migrate, '--apply']);
    assert.deepEqual(retry.requests, []);
    assert.deepEqual(movesOf(retry), [forward]);
    await expectPublished(f, newPair);
    assert.deepEqual(await f.raw(), []);
});

test('without Drive local publishing is still required and the run reports skipped/partial', async (t) => {
    const f = await fixture(t, { remote: false });
    await stand(f, [], 0);
    await stand(f, ['--apply'], 0);
    await f.token();
    f.listing.docs = [f.doc('first')];
    assert.deepEqual(names(await f.run([...raster, '--limit', '1'], 2)), ['token', 'inspect', 'prepare', 'publish', 'published', 'report']);
    report(f, { savedFiles: 2, skippedFiles: 0, status: 'partial', driveStatus: 'skipped', limited: true });
    await expect(f.originals, oldPair, SIGNED);
    await expect(f.publicRoot, oldPair, SIGNED.map(derivative));
    await absent(f.drive);
    assert.deepEqual(await f.raw(), []);
});

const opaqueFailure = (path, reason = 'RASTER_LIMIT') => ({ docId: 'raster:' + sha(path.normalize('NFC')).slice(0, 16), reason });
const fixtureManifest = (f) => join(f.stateRoot, 'fixture-mirror.json');
const receipt = (f) => join(f.stateRoot, 'provider-contract-publication.json');
const preparedReceipt = (f) => join(f.stateRoot, 'provider-contract-prepared-stages.json');
const documentsFailed = 'raster_archive_documents_failed';
const badPath = '기타/00-bad.pdf';
const badBytes = 'bad-limit: synthetic signed source';

function syntheticPdf(label) {
    const stream = '0 0 16 16 re f\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 24 24] /Resources << >> /Contents 4 0 R >>',
        '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
        '<< /Title (' + label + ') >>',
    ];
    let pdf = '%PDF-1.7\n';
    const offsets = ['0000000000 65535 f \n'];
    for (const [index, object] of objects.entries()) {
        offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n \n');
        pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    }
    return pdf + 'xref\n0 ' + offsets.length + '\n' + offsets.join('')
        + 'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + pdf.length + '\n%%EOF\n';
}

async function realDerivative(root, path, signed) {
    const bytes = await fs.readFile(join(root, path));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.notEqual(sha(bytes), sha(signed));
    return bytes;
}

test('real cutover and timer report distinct stable path IDs for equal malformed originals', async (t) => {
    const f = await fixture(t, { real: true, remote: false, explicit: true });
    const badPaths = ['기타/00-Synthetic e\u0301.pdf', '기타/01-Synthetic beta.pdf'];
    const healthy = '기타/02-Healthy.pdf';
    const signed = syntheticPdf('healthy');
    await f.seed(f.publicRoot, [...badPaths, healthy], [badBytes, badBytes, signed]);
    const before = await tree(f);
    await stand(f, [], 0);
    assert.deepEqual(await tree(f), before);
    await absent(f.originals);
    await absent(f.guard);
    await absent(join(f.stateRoot, 'raster-mirror'));

    const failures = badPaths.map((path) => opaqueFailure(path, 'RASTER_INVALID_SOURCE'));
    const first = await stand(f, ['--apply'], 2);
    assert.deepEqual(first.log, [{ rasterArchive: 'apply', status: 'partial', reason: documentsFailed,
        failedFiles: 2, failures, exitCode: 2 }]);
    const guard = await fs.readFile(f.guard);
    assert.equal(JSON.parse(guard).phase, 'partial');
    const rendered = await realDerivative(f.publicRoot, healthy, signed);
    await expect(f.originals, [...badPaths, healthy], [badBytes, badBytes, signed]);

    await f.token();
    const laterBytes = [syntheticPdf('later document'), syntheticPdf('later audit')];
    f.listing.docs = [f.doc('later', { title: 'New healthy pair' }, laterBytes)];
    const next = await f.run(raster, 2);
    report(f, { status: 'partial', savedFiles: 2, failedFiles: 2, failures });
    const later = pair('기타', 'New healthy pair');
    await expect(f.originals, later, laterBytes);
    for (const [index, path] of later.entries()) await realDerivative(f.publicRoot, path, laterBytes[index]);
    assert.deepEqual(await fs.readFile(join(f.publicRoot, healthy)), rendered);
    await expect(f.publicRoot, badPaths, [badBytes, badBytes]);
    assert.deepEqual(await fs.readFile(f.guard), guard);
    const output = JSON.stringify([first.log, next.log, f.reports]);
    for (const path of badPaths) {
        assert.ok(!output.includes(path) && !output.includes(path.split('/').at(-1)));
    }
    assert.ok(!output.includes(sha(badBytes).slice(0, 16)) && !output.includes(badBytes));
});

async function partialCutover(f) {
    const valid = ['기타/Z1.pdf', '기타/Z2.pdf'];
    for (const root of [f.publicRoot, f.drive]) {
        await f.seed(root, [badPath, ...valid], [badBytes, ...SIGNED]);
    }
    const result = await stand(f, ['--apply'], 2);
    assert.deepEqual(result.log, [{ rasterArchive: 'apply', status: 'partial', reason: documentsFailed,
        failedFiles: 1, failures: [opaqueFailure(badPath)], exitCode: 2 }]);
    assert.equal((await readJson(f.guard)).phase, 'partial');
    await expect(f.originals, [badPath, ...valid], [badBytes, ...SIGNED]);
    for (const root of [f.publicRoot, f.drive]) {
        await expect(root, [badPath, ...valid], [badBytes, ...SIGNED.map(derivative)]);
        assert.deepEqual((await fs.readdir(join(root, '기타'))).sort(), ['00-bad.pdf', 'Z1.pdf', 'Z2.pdf']);
    }
    return valid;
}

test('first cutover and later timer publish valid siblings while a stable bad source remains', async (t) => {
    const f = await fixture(t);
    const valid = await partialCutover(f);
    const stableGuard = await readJson(f.guard);
    await stand(f, ['--apply'], 2);
    assert.deepEqual(await readJson(f.guard), stableGuard);
    assert.deepEqual((await f.run([], 1)).requests, []);
    assert.deepEqual((await f.run(migrate, 1)).requests, []);

    await f.token();
    const arrived = f.doc('arrived', { title: 'Later valid' }, ['new-document', 'new-audit']);
    f.listing.docs = [arrived];
    const result = await f.run(raster, 2, { explicitRetry: true });
    assert.deepEqual(result.requests, ['listing', 'file', 'file', 'report']);
    assert.ok(result.events.filter(({ call }) => ['prepare', 'publish'].includes(call))
        .every(({ options }) => options.explicitRepublish === true && !Object.hasOwn(options, 'legacyProofs')));
    report(f, { status: 'partial', savedFiles: 2, failedFiles: 1, driveStatus: 'failed', failures: [opaqueFailure(badPath)] });
    const later = pair('기타', 'Later valid');
    for (const root of [f.publicRoot, f.drive]) {
        await expect(root, [badPath, ...valid, ...later], [badBytes, ...SIGNED.map(derivative), ...['new-document', 'new-audit'].map(derivative)]);
    }
    assert.deepEqual(await readJson(f.guard), stableGuard);

    f.listing.status = 503;
    await f.run(raster, 1, { explicitRetry: true });
    report(f, { status: 'failed', failedFiles: 0, failures: [] });
    assert.deepEqual(await readJson(f.guard), stableGuard);
    f.listing.status = 200;

    const missing = f.doc('missing', { title: 'Download interrupted' }, ['raw-document', 'raw-audit']);
    f.files.delete('missing-0');
    f.listing.docs.push(missing);
    await f.run(raster, 2, { explicitRetry: true, fail: 'repaired' });
    report(f, { status: 'partial', failedFiles: 1, driveStatus: 'ok', failures: [{ docId: 'missing', reason: 'file_http_404' }] });
    assert.deepEqual(await readJson(f.guard), stableGuard);

    f.files.set('missing-0', 'raw-document');
    await f.run([...raster, '--limit', '1'], 2, { explicitRetry: true, fail: 'repaired' });
    assert.deepEqual(await readJson(f.guard), stableGuard);
    report(f, { status: 'partial', failedFiles: 0, limited: true });
    await f.run([...raster, '--limit', '2'], 0, { explicitRetry: true, fail: 'repaired' });
    report(f, { status: 'success', failedFiles: 0, driveStatus: 'ok', limited: true });
    assert.deepEqual(await readJson(f.guard), { ...stableGuard, phase: 'active' });
    await expect(f.originals, [badPath, ...valid], [badBytes, ...SIGNED]);
    for (const root of [f.publicRoot, f.drive]) await expect(root, [badPath, ...valid], [badBytes, ...SIGNED].map(derivative));
    assert.deepEqual(await f.raw(), []);
});

test('partial guard survives global retry failures and activates without Drive even when the POST fails', async (t) => {
    const f = await fixture(t, { remote: false });
    await f.seed(f.publicRoot, [badPath], [badBytes]);
    await stand(f, ['--apply'], 2);
    const guard = await readJson(f.guard);
    await f.token();
    await f.run(raster, 2, { explicitRetry: true });
    report(f, { status: 'partial', driveStatus: 'skipped', failedFiles: 1, failures: [opaqueFailure(badPath)] });
    await f.run(raster, 1, { explicitRetry: true, fail: 'known-prepare' });
    await stand(f, ['--apply'], 1, { fail: 'publish' });
    assert.deepEqual(await readJson(f.guard), guard);
    f.listing.postStatus = 503;
    const result = await f.run(raster, 3, { explicitRetry: true, fail: 'repaired' });
    assert.deepEqual(result.requests, ['listing', 'report', 'report']);
    report(f, { status: 'partial', driveStatus: 'skipped', failedFiles: 0, failures: [] });
    assert.deepEqual(await readJson(f.guard), { ...guard, phase: 'active' });
    await expect(f.publicRoot, [badPath], [derivative(badBytes)]);
});

test('active run adds full failure count once and emits ten bounded opaque details after raw errors', async (t) => {
    const f = await fixture(t);
    await stand(f, ['--apply'], 0);
    const guard = await readJson(f.guard);
    const bad = [...Array(13)].map((_, n) => '기타/Corrupt ' + String(n).padStart(2, '0') + '.pdf');
    await f.seed(f.originals, bad, bad.map(() => badBytes));
    const prior = derivative('prior verified version of a failed replacement');
    for (const root of [f.publicRoot, f.drive]) await f.seed(root, [bad[0]], [prior]);
    const missing = f.doc('missing', { title: 'Raw failure' });
    f.files.delete('missing-0');
    f.listing.docs = [missing];
    await f.token();
    const details = bad.slice(0, 10).map((path) => opaqueFailure(path));
    const result = await f.run(raster, 2);
    assert.ok(result.log.some((row) => row.reason === documentsFailed && row.failedFiles === 13));
    report(f, { status: 'partial', failedFiles: 14, driveStatus: 'failed',
        failures: [{ docId: 'missing', reason: 'file_http_404' }, ...details] });
    await f.run(raster, 2);
    report(f, { failedFiles: 14, failures: [{ docId: 'missing', reason: 'file_http_404' }, ...details] });
    for (const root of [f.publicRoot, f.drive]) await expect(root, [bad[0]], [prior]);
    assert.deepEqual(await readJson(f.guard), guard);
    f.listing.docs = Array.from({ length: 205 }, (_, i) => f.doc('incomplete-' + i)).map((doc) => ({ ...doc, files: [] }));
    await f.run(raster, 2);
    const capped = f.reports.at(-1);
    assert.equal(capped.failedFiles, 218);
    assert.equal(capped.failures.length, 200);
    assert.deepEqual(capped.failures.slice(-10), details);
});

test('only branded mirror codes and structurally valid publish aggregates reach logs or reports', async (t) => {
    const f = await fixture(t);
    const valid = { failedCount: 1, failures: [{ id: '0000000000000001', reason: 'RASTER_LIMIT' }] };
    await stand(f, ['--apply'], 0);
    const guard = await readJson(f.guard);
    await f.token();
    const assertFallback = async (fail, aggregate) => {
        const result = await f.run(raster, 2, { fail, aggregate });
        assert.ok(result.log.some(({ reason }) => reason === 'raster_publish_failed'));
        report(f, { failedFiles: 0, failures: [], status: 'partial', driveStatus: 'failed' });
        assert.deepEqual(await readJson(f.guard), guard);
        assert.ok(!JSON.stringify([result.log, f.reports.at(-1)]).includes('/private/source.pdf'));
    };
    for (const fail of ['hostile-code', 'throw-inspector']) await assertFallback(fail);
    const mirror = await fs.readFile(f.publisher, 'utf8');
    await put(f.publisher, mirror.replace('export function describeRasterArchiveError', 'function describeRasterArchiveError'));
    await assertFallback('known-publish');
    await put(f.publisher, mirror);
    for (const aggregate of [
        {}, { ...valid, failedCount: 0 }, { ...valid, failedCount: -1 }, { ...valid, failedCount: 2 ** 53 },
        { failedCount: 12, failures: Array(11).fill(valid.failures[0]) },
        { ...valid, failures: [{ ...valid.failures[0], id: '000000000000000A' }] },
        { ...valid, failures: [{ ...valid.failures[0], reason: 'RASTER_LIMIT /private/source.pdf' }] },
        { ...valid, failedCount: 8 },
    ]) await assertFallback('aggregate-publish', aggregate);
    const known = await f.run(raster, 2, { fail: 'known-publish' });
    assert.deepEqual(known.log[0], { reason: 'raster_archive_public_version_conflict' });
    report(f, { failedFiles: 0, failures: [] });
    const prepare = await f.run(raster, 1, { fail: 'known-prepare' });
    assert.deepEqual(prepare.log[0], { reason: 'raster_archive_binding_changed' });
    assert.deepEqual(prepare.requests, ['report']);
    const wrongPrepare = await f.run(raster, 1, { fail: 'aggregate-prepare', aggregate: valid });
    assert.deepEqual(wrongPrepare.log[0], { reason: 'raster_prepare_failed' });
    report(f, { failedFiles: 0, failures: [] });
    assert.deepEqual(await readJson(f.guard), guard);

    const rollback = await stand(f, ['--rollback'], 1, { fail: 'known-rollback' });
    assert.deepEqual(rollback.log[0], { rasterArchive: 'rollback', reason: 'raster_archive_public_version_conflict', exitCode: 1 });
    const rollingBack = { ...guard, phase: 'rollingBack' };
    assert.deepEqual(await readJson(f.guard), rollingBack);
    const wrongRollback = await stand(f, ['--rollback'], 1, { fail: 'aggregate-rollback', aggregate: valid });
    assert.deepEqual(wrongRollback.log[0], { rasterArchive: 'rollback', reason: 'raster_rollback_failed', exitCode: 1 });
    assert.deepEqual(await readJson(f.guard), rollingBack);
    await stand(f, ['--rollback'], 0);
    await absent(f.guard);
});

test('immutable first preflight and proven empty cancellation preserve or reattach the exact predecessor', async (t) => {
    const f = await fixture(t);
    const legacy = { version: 1, id: '00000000-0000-0000-0000-000000000001', phase: 'applied', moves: [],
        archive: f.publicRoot, remote: 'mock:backup' };
    await put(f.journal, JSON.stringify(legacy));
    const before = await tree(f);
    await stand(f, [], 1, { fail: 'dry-publish' });
    await stand(f, ['--apply'], 1, { fail: 'dry-publish' });
    const peer = await fs.readFile(f.publisher, 'utf8');
    await put(f.publisher, peer.replace('export async function inspectRasterArchive', 'async function inspectRasterArchive'));
    assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'raster_inspect_failed');
    await put(f.publisher, peer);
    assert.deepEqual(await tree(f), before);

    await stand(f, ['--apply'], 1, { fail: 'prepare' });
    const guard = await readJson(f.guard);
    assert.equal(guard.origin, 'fresh');
    await absent(f.journal);
    const record = join(dirname(f.journal), 'records', 'pre-raster-' + legacy.id + '-applied.json');
    assert.deepEqual(await readJson(record), legacy);
    const stopped = await tree(f);
    await stand(f, ['--rollback'], 1, { fail: 'invalid-inspection' });
    assert.deepEqual(await tree(f), stopped);
    await put(f.journal, JSON.stringify(legacy)); // Byte-identical but foreign inode.
    const foreign = await tree(f);
    await stand(f, ['--rollback'], 1);
    assert.deepEqual(await tree(f), foreign);
    await fs.unlink(f.journal);

    await stand(f, ['--rollback'], 'SIGKILL', { killRestore: true });
    assert.deepEqual(await readJson(f.guard), guard);
    assert.equal((await fs.stat(f.journal)).ino, (await fs.stat(record)).ino);
    const result = await stand(f, ['--rollback'], 0);
    assert.deepEqual(names(result), ['inspect']);
    await absent(f.guard);
    await absent(f.originals);
    assert.deepEqual(await readJson(f.journal), legacy);
    assert.deepEqual(await readJson(record), legacy);
});

test('missing-manifest rollback requires the fresh guard publication checkpoint', async (t) => {
    const guards = [
        ['v1 guard', { version: 1 }],
        ['v2 existing guard', { version: 2, origin: 'existing', proofDigest: null }],
    ];
    for (const [name, fields] of guards) {
        await t.test(name, async (t) => {
            const f = await fixture(t);
            const legacy = { version: 1, id: '00000000-0000-0000-0000-000000000001', phase: 'applied', moves: [],
                archive: f.publicRoot, remote: 'mock:backup' };
            await put(f.journal, JSON.stringify(legacy));
            await stand(f, ['--apply'], 1, { fail: 'prepare' });
            const { binding, predecessor } = await readJson(f.guard);
            await put(f.guard, JSON.stringify({ ...fields, phase: 'preparing', binding, predecessor }));
            await absent(fixtureManifest(f));
            await absent(f.originals);
            await absent(f.journal);
            const before = await tree(f);

            const result = await stand(f, ['--rollback'], 1);
            assert.deepEqual(result.log, [{ rasterArchive: 'rollback', reason: 'raster_cutover_manifest_required', exitCode: 1 }]);
            assert.deepEqual(names(result), ['inspect']);
            assert.deepEqual(await tree(f), before);
            assert.deepEqual(await f.raw(), []);
        });
    }
});

test('rollback rejects inconsistent inspector observations without modifying the archive or clearing its guard', async (t) => {
    const observations = [
        ['active manifest marked unpublished', { manifestPresent: true, unpublished: true, retiredPaths: [], phase: 'active' }],
        ['present manifest with unknown phase', { manifestPresent: true, unpublished: false, retiredPaths: [], phase: 'unknown' }],
        ['absent manifest with active phase', { manifestPresent: false, unpublished: true, retiredPaths: [], phase: 'active' }],
        ['absent manifest with a retired PDF', { manifestPresent: false, unpublished: true, retiredPaths: [oldPair[0]], phase: null }],
    ];
    for (const [name, inspection] of observations) {
        await t.test(name, async (t) => {
            const f = await fixture(t);
            await stand(f, ['--apply'], 1, { fail: 'prepare' });
            assert.equal((await readJson(f.guard)).phase, 'preparing');
            const before = await tree(f);

            const result = await stand(f, ['--rollback'], 1, { inspection });
            assert.deepEqual(result.log, [{ rasterArchive: 'rollback', reason: 'raster_inspect_failed', exitCode: 1 }]);
            assert.deepEqual(names(result), ['inspect']);
            assert.deepEqual(await tree(f), before);
            assert.deepEqual(await f.raw(), []);
        });
    }
});

test('unbound interrupted capture preserves private bytes and blocks cutover retry', async (t) => {
    const f = await fixture(t);
    await f.seed(f.publicRoot, oldPair);
    await f.seed(f.drive, oldPair);
    await stand(f, ['--apply'], 1, { fail: 'captured-before-manifest' });
    const guard = await readJson(f.guard);
    assert.equal(guard.phase, 'preparing');
    const stopped = await tree(f);
    for (const action of [[], ['--apply'], ['--rollback']]) {
        assert.equal((await stand(f, action, 1)).log[0].reason, 'raster_cutover_manifest_required');
        assert.deepEqual(await tree(f), stopped);
    }
    await put(f.guard, JSON.stringify({ version: 1, phase: 'rollingBack', predecessor: null, binding: guard.binding }));
    const legacy = await tree(f);
    await stand(f, ['--rollback'], 1);
    assert.deepEqual(await tree(f), legacy);
});

const mirrorHome = (f) => join(f.stateRoot, 'raster-mirror');
const realManifest = (f) => join(mirrorHome(f), 'manifest.json');
const remoteWrites = async (f) => (await f.raw()).filter(({ command }) => ['copyto', 'deletefile'].includes(command));
const predecessorFor = (f) => ({ version: 1, id: '00000000-0000-0000-0000-000000000001',
    phase: 'applied', moves: [], archive: f.publicRoot, remote: 'mock:' });
const predecessorRecord = (f, legacy) => join(dirname(f.journal), 'records', 'pre-raster-' + legacy.id + '-applied.json');

test('ordinary bootstrap custody accepts a preseeded original and repeats without rewriting', async (t) => {
    const f = await fixture(t, { real: true, explicit: true, remote: false });
    const path = '2026/signed.pdf';
    const signed = syntheticPdf('preseeded signed source');
    await f.seed(f.originals, [path], [signed]);
    const original = join(f.originals, path);
    const before = await fs.stat(original);

    await stand(f, ['--apply'], 0);
    assert.equal((await readJson(f.guard)).phase, 'active');
    await expect(f.originals, [path], [signed]);
    const after = await fs.stat(original);
    assert.deepEqual([after.ino, after.mtimeMs], [before.ino, before.mtimeMs]);
    await realDerivative(f.publicRoot, path, signed);
    const roots = [f.originals, f.publicRoot, mirrorHome(f)];
    const settled = await Promise.all(roots.map(snapshot));

    await stand(f, ['--apply'], 0);
    assert.deepEqual(await Promise.all(roots.map(snapshot)), settled);
});

test('ordinary provider destination accepts existing and newly required public directories', async (t) => {
    const f = await fixture(t, { real: true });
    const signed = [syntheticPdf('provider document'), syntheticPdf('provider audit')];
    await stand(f, ['--apply'], 0);
    await f.token();
    const doc = f.doc('provider', {}, signed);
    f.listing.docs = [doc];
    await f.run(raster);

    const destinations = newPair.map((path) => dirname(join(f.publicRoot, path)));
    await fs.mkdir(destinations[0]);
    await absent(destinations[1]);
    const published = (paths) => Promise.all(paths.map((path, i) => realDerivative(f.publicRoot, path, signed[i])));
    const derivatives = await published(oldPair);
    f.listing.docs = [{ ...doc, providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } }];

    await f.run([...migrate, '--apply']);
    assert.equal((await readJson(f.journal)).phase, 'applied');
    assert.ok((await fs.stat(destinations[1])).isDirectory());
    await expect(f.originals, newPair, signed);
    assert.deepEqual(await published(newPair), derivatives);
    assert.deepEqual(await Promise.all(newPair.map((path) => fs.readFile(join(f.drive, path)))), derivatives);
    for (const root of [f.originals, f.publicRoot, f.drive]) {
        for (const path of oldPair) await absent(join(root, path));
    }

    await f.run([...migrate, '--rollback']);
    assert.equal((await readJson(f.journal)).phase, 'rolledBack');
    await expect(f.originals, oldPair, signed);
    assert.deepEqual(await published(oldPair), derivatives);
    assert.deepEqual(await Promise.all(oldPair.map((path) => fs.readFile(join(f.drive, path)))), derivatives);
    for (const root of [f.originals, f.publicRoot, f.drive]) {
        for (const path of newPair) await absent(join(root, path));
    }
});

test('real cutover cannot cancel or retry after publication and loss of custody metadata', async (t) => {
    const f = await fixture(t, { real: true, explicit: true });
    const path = 'fixture/Original contract.pdf';
    const signed = syntheticPdf('published during cutover');
    const legacy = predecessorFor(f);
    const predecessorBytes = JSON.stringify(legacy, null, 4);
    await put(f.journal, predecessorBytes);
    await f.seed(f.publicRoot, [path], [signed]);
    await stand(f, ['--apply'], 'SIGKILL', { crash: 'before-active' });
    const published = await realDerivative(f.publicRoot, path, signed);
    assert.deepEqual(await fs.readFile(join(f.drive, path)), published);
    await expect(f.originals, [path], [signed]);
    const current = await readJson(f.guard);
    assert.deepEqual([current.version, current.phase, current.publication], [3, 'preparing', 'possible']);
    const { phase, binding, predecessor, origin, proofDigest } = current;
    const oldGuard = { version: 2, phase, binding, predecessor, origin, proofDigest };
    const preserved = predecessorRecord(f, legacy);
    assert.equal(await fs.readFile(preserved, 'utf8'), predecessorBytes);
    const writes = await remoteWrites(f);
    assert.deepEqual(writes.map(({ command, sha: digest }) => [command, digest]), [['copyto', sha(published)]]);
    // The interrupted active-guard allocation is independent of the durable
    // guard being tested. Model loss of that allocation in all variants.
    for (const name of await fs.readdir(f.stateRoot)) {
        if (name.startsWith('raster-cutover.json.') && name.endsWith('.tmp')) await fs.unlink(join(f.stateRoot, name));
    }
    await fs.rm(mirrorHome(f), { recursive: true });
    const assertRefused = async () => {
        const before = await tree(f);
        const remoteCalls = await f.raw();
        for (const action of [[], ['--apply'], ['--rollback']]) {
            assert.equal((await stand(f, action, 1)).log[0].reason, 'raster_cutover_manifest_required');
            assert.deepEqual(await tree(f), before);
            assert.deepEqual(await f.raw(), remoteCalls);
        }
        assert.equal(await fs.readFile(preserved, 'utf8'), predecessorBytes);
        await absent(f.journal);
    };
    await assertRefused(); // Absent home, private originals and published bytes survive.
    await put(f.guard, JSON.stringify(oldGuard));
    await assertRefused(); // Exact version-2 guard has no publication checkpoint.
    await fs.mkdir(join(mirrorHome(f), 'original-blobs'), { recursive: true, mode: 0o700 });
    await fs.mkdir(join(mirrorHome(f), 'rendered'), { mode: 0o700 });
    await assertRefused(); // An empty mirror home provides no affirmative evidence for v2.
    await fs.rm(f.originals, { recursive: true });
    await assertRefused(); // Old guard and surviving derivatives, with no private copy.
    await fs.rm(mirrorHome(f), { recursive: true });
    await put(f.guard, JSON.stringify(current));
    await assertRefused(); // Loss of both roots under the durable publication checkpoint.
    assert.deepEqual(await fs.readFile(join(f.publicRoot, path)), published);
    assert.deepEqual(await fs.readFile(join(f.drive, path)), published);
    await f.seed(f.originals, [path], [signed]);
    await fs.unlink(join(f.publicRoot, path));
    await fs.unlink(join(f.drive, path));
    await assertRefused(); // Only the signed private original survives, with the home absent.
    await fs.mkdir(join(mirrorHome(f), 'original-blobs'), { recursive: true, mode: 0o700 });
    await assertRefused();
    await expect(f.originals, [path], [signed]);
});

test('real never-started cutover cancels cleanly and reattaches an exact predecessor', async (t) => {
    for (const withPredecessor of [false, true]) {
        const f = await fixture(t, { real: true, explicit: true });
        const legacy = predecessorFor(f);
        const bytes = JSON.stringify(legacy, null, 4);
        if (withPredecessor) await put(f.journal, bytes);
        await stand(f, ['--apply'], 'SIGKILL', { crash: 'before-bootstrap' });
        assert.equal((await readJson(f.guard)).publication, 'initial');
        await absent(realManifest(f));
        await absent(f.journal);
        const before = await f.raw();
        if (withPredecessor) {
            const link = join(f.originals, 'unbound.pdf');
            await fs.symlink(predecessorRecord(f, legacy), link);
            const footprint = await fs.readlink(link);
            assert.equal((await stand(f, ['--rollback'], 1)).log[0].reason, 'raster_cutover_manifest_required');
            assert.equal(await fs.readlink(link), footprint);
            await fs.unlink(link);
        }
        await stand(f, ['--rollback'], 0);
        await absent(f.guard);
        assert.deepEqual(await f.raw(), before);
        if (withPredecessor) {
            assert.equal(await fs.readFile(f.journal, 'utf8'), bytes);
            assert.equal((await fs.stat(f.journal)).ino, (await fs.stat(predecessorRecord(f, legacy))).ino);
        } else await absent(f.journal);
    }
});

test('real first capture resumes across the authority rename and private writes', async (t) => {
    for (const crash of ['before-authority', 'after-blob', 'after-capture']) {
        await t.test(crash, async (t) => {
            const f = await fixture(t, { real: true, explicit: true });
            const paths = ['00-Document.pdf', '01-Remote-only.pdf', '02-Audit.pdf'];
            const signed = paths.map((_, i) => syntheticPdf('first capture ' + i));
            await f.seed(f.publicRoot, paths.slice(0, 1), signed.slice(0, 1));
            await f.seed(f.drive, paths.slice(1, 2), signed.slice(1, 2));
            await f.seed(f.originals, paths.slice(2), signed.slice(2)); // Explicit operator-owned private seed.
            const audit = join(f.originals, paths[2]);
            const auditBefore = await fs.stat(audit);
            await stand(f, ['--apply'], 'SIGKILL', { crash });
            const initial = crash === 'before-authority';
            assert.equal((await readJson(f.guard)).publication, initial ? 'initial' : 'capturing');
            if (initial) {
                await absent(realManifest(f));
                assert.ok((await fs.readdir(mirrorHome(f))).some((name) => name.startsWith('.bootstrap-')));
            } else {
                const bound = await readJson(realManifest(f));
                assert.deepEqual(bound.initialCapture.map(({ path, raw }) => [path, raw.sha256]),
                    paths.map((path, i) => [path, sha(signed[i])]));
                assert.deepEqual(await fs.readFile(join(mirrorHome(f), 'original-blobs', sha(signed[0]) + '.pdf'), 'utf8'), signed[0]);
            }
            if (crash === 'after-capture') await expect(f.originals, paths, signed);
            else await absent(join(f.originals, paths[0]));
            assert.deepEqual(await remoteWrites(f), []);
            assert.equal(await fs.readFile(audit, 'utf8'), signed[2]);
            const stopped = await tree(f);
            await stand(f, [], 0);
            assert.deepEqual(await tree(f), stopped);
            if (initial) {
                const foreign = 'foreign.pdf';
                await f.seed(f.originals, [foreign], [syntheticPdf('unbound private file')]);
                const ambiguous = await tree(f);
                assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'raster_archive_original_authority_conflict');
                assert.deepEqual(await tree(f), ambiguous);
                assert.deepEqual(await remoteWrites(f), []);
                await fs.unlink(join(f.originals, foreign));
            }

            await stand(f, ['--apply'], 0);
            assert.equal((await readJson(f.guard)).phase, 'active');
            assert.equal((await readJson(realManifest(f))).initialCapture, undefined);
            for (const [i, path] of paths.entries()) {
                const visible = await realDerivative(f.publicRoot, path, signed[i]);
                assert.deepEqual(await fs.readFile(join(f.drive, path)), visible);
            }
            await expect(f.originals, paths, signed);
            assert.equal((await fs.stat(audit)).ino, auditBefore.ino);
            assert.equal((await fs.stat(audit)).mtimeMs, auditBefore.mtimeMs);
            const writes = await remoteWrites(f);
            assert.equal(writes.length, paths.length);
            assert.ok(writes.every(({ command, sha: digest }) => command === 'copyto' && !signed.map(sha).includes(digest)));
        });
    }
});

test('real provider preflight sees inclusive-only destinations before forward or reverse raw allocation', async (t) => {
    const f = await fixture(t, { real: true, driveBackend: 'drive' });
    const signed = [syntheticPdf('provider document'), syntheticPdf('provider audit')];
    await stand(f, ['--apply'], 0);
    await f.token();
    const doc = f.doc('provider', {}, signed);
    f.listing.docs = [doc];
    await f.run(raster, 0);
    const endpoints = async (paths) => Promise.all(paths.map((path, i) => realDerivative(f.publicRoot, path, signed[i])));
    const derivativeBefore = await endpoints(oldPair);
    f.listing.docs = [{ ...doc, providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } }];
    for (const path of newPair) await fs.mkdir(dirname(join(f.drive, path)), { recursive: true });

    async function refuseHidden(path, actions, source, target) {
        const hidden = syntheticPdf('other remote object');
        await f.seed(f.drive, [path], [hidden]);
        const before = await tree(f);
        const writes = await remoteWrites(f);
        for (const action of actions) {
            const callOffset = (await f.raw()).length;
            const result = await f.run([...migrate, ...action], 1, { hiddenRemote: path });
            assert.equal(result.log[0].reason, 'raster_archive_guard_failed');
            const calls = (await f.raw()).slice(callOffset);
            assert.ok(calls.some(({ command, inclusive, key }) => command === 'lsjson' && inclusive && key === dirname(path)));
            assert.deepEqual(await tree(f), before);
            assert.deepEqual(await remoteWrites(f), writes);
            await expect(f.originals, source, signed);
            for (const destination of target) await absent(join(f.originals, destination));
            await expect(f.drive, [path], [hidden]);
        }
        await fs.unlink(join(f.drive, path));
    }
    for (const path of newPair) await refuseHidden(path, [[], ['--apply']], oldPair, newPair);
    await absent(f.journal);
    await f.run(migrate, 0);
    await f.run([...migrate, '--apply'], 0);
    const moved = await readJson(f.journal);
    assert.equal(moved.raster.pending, false);
    assert.deepEqual(await endpoints(newPair), derivativeBefore);
    await refuseHidden(oldPair[1], [['--rollback']], newPair, oldPair);
    assert.deepEqual(await readJson(f.journal), moved);
    await f.run([...migrate, '--rollback'], 0);
    await expect(f.originals, oldPair, signed);
    assert.deepEqual(await endpoints(oldPair), derivativeBefore);
    const rolledBack = await readJson(f.journal);
    assert.equal(rolledBack.phase, 'rolledBack');

    const record = join(dirname(f.journal), 'records', 'post-raster-' + rolledBack.id + '-rolledBack.json');
    await fs.mkdir(dirname(record), { recursive: true, mode: 0o700 });
    await fs.link(f.journal, record);
    await fs.unlink(f.journal);
    await fs.unlink(f.guard);
    await fs.rm(mirrorHome(f), { recursive: true });
    const missing = await tree(f);
    assert.equal((await stand(f, [], 1)).log[0].reason, 'raster_cutover_manifest_required');
    assert.deepEqual(await tree(f), missing);
});

const proofOf = (path, bytes) => ({ path, sha256: sha(bytes), size: Buffer.byteLength(bytes) });
const orderProofs = (rows) => rows.sort((a, b) => a.path < b.path ? -1 : Number(a.path > b.path));

test('only authoritative paused legacy proofs can recutover newer public bytes and retry with the same inputs', async (t) => {
    const f = await fixture(t);
    await stand(f, ['--apply'], 0);
    await f.token();
    f.listing.docs = [f.doc('current')];
    await f.run(raster);
    await stand(f, ['--rollback'], 0);
    const paused = await tree(f);
    assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
    assert.deepEqual(await tree(f), paused);
    const existing = await readJson(f.state);
    const revised = ['legacy-reviewed-doc', 'legacy-completed-audit'];
    const rolling = pair('서비스계약서', 'Synthetic reviewed state');
    const excluded = ['Historical', 'Merged', 'Duplicate', 'BadHash'].map((name) => pair('기타', name));
    const legacyRow = (paths, bytes = SIGNED) => ({ completed: true, fingerprint: bytes.map(sha).join(':'),
        files: Object.fromEntries(paths.map((path, i) => [path, Buffer.byteLength(bytes[i])])) });
    const state = { ...existing, units: {
        'doc:current': legacyRow(oldPair, revised),
        'doc:review': { completed: false, fingerprint: sha('legacy-review') + ':', files: { [rolling[0]]: 13, [rolling[1]]: null } },
        'doc:current@historical': legacyRow(excluded[0]),
        'merged:chunk:1': legacyRow(excluded[1]),
        'doc:duplicateOne': legacyRow(excluded[2]),
        'doc:duplicateTwo': legacyRow(excluded[2]),
        'doc:badHash': { ...legacyRow(excluded[3]), fingerprint: 'not-hex:' + sha(SIGNED[1]) },
    } };
    await put(f.state, JSON.stringify(state));
    await f.seed(f.publicRoot, oldPair, revised);
    await f.seed(f.drive, oldPair, revised);
    const expected = orderProofs([...oldPair.map((path, i) => proofOf(path, revised[i])), proofOf(rolling[0], 'legacy-review')]);
    const changed = await tree(f);
    const missingPhase = await stand(f, ['--apply'], 1, { fail: 'missing-phase' });
    assert.deepEqual(archiveCalls(missingPhase), []);
    assert.deepEqual(await tree(f), changed);
    const mirrorState = await readJson(fixtureManifest(f));
    await put(fixtureManifest(f), JSON.stringify({ ...mirrorState, phase: 'active' }));
    assert.deepEqual(archiveCalls(await stand(f, ['--apply'], 1)), []);
    await put(fixtureManifest(f), JSON.stringify(mirrorState));

    const dryBefore = await tree(f);
    const dry = await stand(f, [], 0);
    assert.deepEqual(archiveCalls(dry).map(({ options }) => options.legacyProofs), [expected, expected]);
    assert.deepEqual(await tree(f), dryBefore);
    const killed = await stand(f, ['--apply'], 'SIGKILL', { fail: 'kill-prepare' });
    assert.deepEqual(archiveCalls(killed).map(({ options }) => options.legacyProofs), [expected, expected, expected]);
    const guard = await readJson(f.guard);
    assert.equal(guard.phase, 'preparing');
    assert.equal(guard.origin, 'pausedLegacy');
    assert.equal(guard.proofDigest, sha(JSON.stringify(expected)));

    await put(f.state, JSON.stringify({ ...state, units: { ...state.units,
        'doc:current': { ...state.units['doc:current'], fingerprint: SIGNED.map(sha).join(':') },
    } }));
    const diverged = await tree(f);
    assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, 'raster_cutover_legacy_proofs_changed');
    assert.deepEqual(await tree(f), diverged);
    await put(f.state, JSON.stringify(state));
    const retry = await stand(f, ['--apply'], 0);
    assert.ok(archiveCalls(retry).length >= 3);
    assert.ok(archiveCalls(retry).every(({ options }) => options.explicitRepublish && JSON.stringify(options.legacyProofs) === JSON.stringify(expected)));
    await expectPublished(f, oldPair, revised);
    f.listing.docs = [f.doc('current', {}, revised)];
    const activeTimer = await f.run(raster);
    assert.ok(archiveCalls(activeTimer).every(({ options }) => !Object.hasOwn(options, 'legacyProofs')
        && !Object.hasOwn(options, 'explicitRepublish')));
    const activeApply = await stand(f, ['--apply'], 1, { fail: 'prepare' });
    assert.equal((await readJson(f.guard)).origin, 'existing');
    const activeRetry = await stand(f, ['--apply'], 0);
    assert.ok([...archiveCalls(activeApply), ...archiveCalls(activeRetry)].every(({ options }) => !Object.hasOwn(options, 'legacyProofs')));
    assert.deepEqual(await f.raw(), []);
});

test('paused recutover refuses unsafe, ambiguous or unsupported changed legacy evidence', async (t) => {
    const f = await fixture(t);
    await f.seed(f.publicRoot, oldPair);
    await f.seed(f.drive, oldPair);
    await stand(f, ['--apply'], 0);
    await stand(f, ['--rollback'], 0);
    const revised = ['legacy-changed', 'legacy-audit-changed'];
    await f.seed(f.publicRoot, oldPair, revised);
    const candidate = { files: Object.fromEntries(oldPair.map((path, i) => [path, Buffer.byteLength(revised[i])])),
        fingerprint: revised.map(sha).join(':'), completed: true };
    const save = (units) => put(f.state, JSON.stringify({ version: 2, units }));
    const refused = async (reason) => {
        const before = await tree(f);
        assert.equal((await stand(f, ['--apply'], 1)).log[0].reason, reason);
        assert.deepEqual(await tree(f), before);
    };
    await save({ 'doc:current': candidate });
    await refused('raster_archive_public_version_conflict'); // Drive still has the old originals.
    await f.seed(f.drive, oldPair, revised);
    await save({ 'merged:case:1': candidate });
    await refused('raster_archive_public_version_conflict');
    await save({ 'doc:current': candidate, 'doc:current@archived': candidate });
    await refused('raster_archive_public_version_conflict');
    await save({ 'doc:current': { ...candidate, files: { ...candidate.files, [oldPair[0]]: 1 } } });
    await refused('raster_archive_public_version_conflict');
    await save({ 'doc:current': { ...candidate, files: { ...candidate.files, [oldPair[0]]: 1.5 } } });
    await refused('raster_backup_failed');
    await save({ 'doc:current': candidate });
    await fs.chmod(f.state, 0o644);
    await refused('unsafe_original_state');
    await fs.chmod(f.state, 0o600);
    const stateLink = join(f.stateRoot, 'fixture-state-link');
    await fs.link(f.state, stateLink);
    await refused('unsafe_original_state');
    await fs.unlink(f.state);
    await fs.symlink(stateLink, f.state);
    await refused('unsafe_original_state');
    await fs.unlink(f.state);
    await fs.rename(stateLink, f.state);
    await stand(f, ['--apply'], 0);
    await expectPublished(f, oldPair, revised);
});

test('a paused manifest can enter scheduled replay only via recorded explicit partial authorization', async (t) => {
    const f = await fixture(t);
    await f.seed(f.publicRoot, [badPath], [badBytes]);
    await f.seed(f.drive, [badPath], [badBytes]);
    await stand(f, ['--apply'], 0, { fail: 'repaired' });
    await stand(f, ['--rollback'], 0);
    await f.token();
    assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
    await stand(f, ['--apply'], 2);
    const guard = await readJson(f.guard);
    assert.equal(guard.origin, 'pausedLegacy');
    assert.equal(guard.phase, 'partial');
    assert.equal((await readJson(fixtureManifest(f))).phase, 'paused');
    const explicitRetry = await stand(f, ['--apply'], 2);
    assert.ok(archiveCalls(explicitRetry).every(({ options }) => options.explicitRepublish
        && !Object.hasOwn(options, 'legacyProofs')));
    const timer = await f.run(raster, 2, { explicitRetry: true });
    assert.ok(archiveCalls(timer).every(({ options }) => options.explicitRepublish
        && !Object.hasOwn(options, 'legacyProofs')));
    await f.run(raster, 0, { explicitRetry: true, fail: 'repaired' });
    assert.deepEqual(await readJson(f.guard), { ...guard, phase: 'active' });
});

test('old and prepared publication receipts each block all legacy operator modes before any I/O', async (t) => {
    const f = await fixture(t);
    await f.token();
    f.listing.docs = [f.doc('current')];
    for (const path of [receipt(f), preparedReceipt(f)]) {
        await fs.symlink('missing-receipt-target', path);
        for (const action of [[], ['--apply'], ['--rollback']]) {
            const refused = await f.run(['--migrate-provider-contracts', ...action], 1);
            assert.deepEqual(refused.requests, []);
            assert.deepEqual(refused.events, []);
            assert.equal(refused.log[0].reason, 'finish_provider_publication_first');
            assert.ok((await fs.lstat(path)).isSymbolicLink());
        }
        await stand(f, ['--apply'], 1);
        assert.ok((await fs.lstat(path)).isSymbolicLink());
        await fs.unlink(path);
    }
    assert.deepEqual(await f.raw(), []);
});

for (const provider of [true, false]) {
    test('raster recovers a real first hardlink crash for ' + (provider ? 'provider' : 'generic') + ' PDFs before any mirror scan', async (t) => {
        const f = await fixture(t);
        await stand(f, ['--apply'], 0);
        await f.token();
        const metadata = provider ? { providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } } : {};
        const base = provider ? newPair : oldPair;
        const dir = provider ? '제공인력 계약서' : '기타';
        const basename = base[0].slice(dir.length + 1, -4);
        const next = pair(dir, basename + ' (2)');
        f.listing.docs = [f.doc('revision', metadata)];
        await f.run(raster);
        const oldState = await readJson(f.state);
        const revised = ['second-version-doc', 'second-version-audit'];
        f.listing.docs = [f.doc('revision', metadata, revised)];
        const crashed = await f.run(raster, 'SIGKILL', { killLink: true });
        assert.deepEqual(crashed.requests, ['listing', 'file', 'file']);
        const saved = await readJson(receipt(f));
        assert.equal(saved.version, provider ? 1 : 2);
        assert.equal((await fs.stat(join(f.originals, next[0]))).nlink, 2);
        await absent(join(f.originals, next[1]));
        assert.deepEqual(await readJson(f.state), oldState);
        await stand(f, ['--rollback'], 1);

        const badPaths = provider ? [pair('기타', 'Wrong'), pair('제공기록지/원본', 'Wrong')]
            : [newPair, pair('Unexpected folder', 'Wrong')];
        for (const paths of badPaths) {
            const malformed = { ...saved, next: { ...saved.next,
                files: Object.fromEntries(paths.map((path, i) => [path, saved.files[i].byteSize])) } };
            await put(receipt(f), JSON.stringify(malformed));
            const before = await tree(f);
            assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
            assert.deepEqual(await tree(f), before);
        }
        await put(receipt(f), JSON.stringify(saved));

        const first = join(f.originals, next[0]);
        const second = join(f.originals, next[1]);
        const outside = join(f.home, 'unowned');
        await fs.link(first, outside);
        let before = await tree(f);
        assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
        assert.deepEqual(await tree(f), before);
        assert.equal(await fs.readFile(outside, 'utf8'), revised[0]);
        await fs.unlink(outside);
        await fs.mkdir(dirname(second), { recursive: true, mode: 0o700 });
        await put(outside, revised[1]);
        await fs.symlink(outside, second);
        before = await tree(f);
        assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
        assert.deepEqual(await tree(f), before);
        await fs.unlink(second);
        await put(second, revised[1]);
        await fs.utimes(second, new Date(saved.createdAt), new Date(saved.createdAt));
        before = await tree(f);
        assert.deepEqual((await f.run(raster, 1)).requests, ['report']);
        assert.deepEqual(await tree(f), before);
        await fs.unlink(second);

        const resumed = await f.run(raster);
        assert.deepEqual(resumed.requests, ['listing', 'report']);
        assert.deepEqual(names(resumed), ['token', 'inspect', 'prepare', 'publish', 'published', 'report']);
        await expectPublished(f, base);
        await expectPublished(f, next, revised);
        for (const path of next) {
            const info = await fs.stat(join(f.originals, path));
            assert.equal(info.nlink, 1);
            assert.equal(info.mtimeMs, Date.parse(saved.createdAt));
        }
        const state = await readJson(f.state);
        assert.deepEqual(state.units[saved.key], saved.next);
        assert.deepEqual(state.units[saved.history], saved.before);
        await absent(receipt(f));
        await absent(preparedReceipt(f));
        assert.ok(!(await fs.readdir(f.originals)).some((path) => path.startsWith('.provider-publication-')));
        assert.equal(await fs.readFile(outside, 'utf8'), revised[1]);
        assert.deepEqual((await f.run(raster)).requests, ['listing', 'report']);
        assert.deepEqual(await readJson(f.state), state);
        assert.deepEqual(await f.raw(), []);
    });
}

test('targeted move replay survives an unrelated bad source and keeps genuine failed moves pending', async (t) => {
    const f = await providerFixture(t);
    await f.seed(f.originals, [badPath], [badBytes]);
    const aggregate = { failedCount: 1, failures: [{ id: '0000000000000001', reason: 'RASTER_LIMIT' }] };
    const result = await f.run([...migrate, '--apply'], 1, { fail: 'move-aggregate', aggregate });
    assert.deepEqual(result.log[0], { migration: 'apply', reason: documentsFailed, failedFiles: 1,
        failures: [{ docId: 'raster:0000000000000001', reason: 'RASTER_LIMIT' }], exitCode: 1 });
    assert.deepEqual(moveCalls(result), moveSteps(forward));
    const guard = await readJson(f.guard);
    const pending = await readJson(f.journal);
    assert.equal(pending.raster.pending, true);
    await f.run([...migrate, '--rollback'], 1);
    assert.deepEqual(await readJson(f.journal), pending);
    const retry = await f.run([...migrate, '--apply']);
    assert.deepEqual(movesOf(retry), [forward]);
    assert.deepEqual(retry.requests, []);
    assert.equal((await readJson(f.journal)).raster.pending, false);
    await expectPublished(f, newPair);

    f.listing.docs.push(f.doc('new', { title: 'New valid pair' }));
    const later = await f.run(raster, 2);
    assert.deepEqual(later.requests, ['listing', 'file', 'file', 'report']);
    assert.ok(archiveCalls(later).every(({ options }) => !Object.hasOwn(options, 'movesOnly')));
    report(f, { savedFiles: 2, failedFiles: 1, failures: [opaqueFailure(badPath)] });
    await expectPublished(f, pair('기타', 'New valid pair'));
    assert.deepEqual(await readJson(f.guard), guard);
    assert.deepEqual(await f.raw(), []);
});

test('NFC-equivalent retired names reserve both paths, with exact journal-owned reuse for the original pair', async (t) => {
    const f = await fixture(t);
    await stand(f, ['--apply'], 0);
    await f.token();
    const date = '2026-01-02';
    const decomp = 'Synthetic e\u0301';
    const comp = decomp.normalize('NFC');
    const initial = f.doc('retired-one');
    const second = f.doc('retired-two', { title: 'Second initial private pair' }, ['next-one', 'next-two']);
    const withName = (doc, signerName) => ({ ...doc, providerContract: { signerName, signedDate: date } });
    f.listing.docs = [initial, second];
    await f.run(raster);
    f.listing.docs = [withName(initial, decomp), second];
    const originalNames = pair('제공인력 계약서', '제공인력_계약서_' + decomp + '_' + date);
    const exact = oldPair.map((from, i) => ({ from, to: originalNames[i] }));
    assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), [exact]);
    const inverse = exact.map(({ from, to }) => ({ from: to, to: from }));
    const reverseRun = await f.run([...migrate, '--rollback']);
    assert.deepEqual(moveCalls(reverseRun), moveSteps(inverse));
    for (const root of [f.originals, f.publicRoot, f.drive]) for (const path of originalNames) await absent(join(root, path));
    f.listing.docs = [withName(initial, comp), second];
    assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), [exact]);
    await f.run([...migrate, '--rollback']);

    f.listing.docs = [initial, withName(second, comp)];
    const allocated = pair('제공인력 계약서', '제공인력_계약서_' + comp + '_' + date + ' (2)');
    const secondOld = pair('기타', second.title);
    const unrelated = secondOld.map((from, i) => ({ from, to: allocated[i] }));
    assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), [unrelated]);
    await expectPublished(f, allocated, ['next-one', 'next-two']);
    for (const path of originalNames) await absent(join(f.originals, path));
    await f.run([...migrate, '--rollback']);
    f.listing.docs = [initial, second, withName(f.doc('later-with-same-name'), comp)];
    await f.run(raster);
    const ordinary = pair('제공인력 계약서', '제공인력_계약서_' + comp + '_' + date + ' (3)');
    await expectPublished(f, ordinary);
    assert.deepEqual(await f.raw(), []);
});

for (const changed of ['fingerprint', 'allocation']) {
    test('journal key alone cannot reclaim a retired pair after a change to its ' + changed, async (t) => {
        const f = await providerFixture(t);
        await f.run([...migrate, '--apply']);
        await f.run([...migrate, '--rollback']);
        const [before, sentinel] = f.listing.docs;
        let recorded;
        if (changed === 'fingerprint') {
            const revised = f.doc(before.docId, {}, ['new-fingerprint-doc', 'new-fingerprint-audit']);
            f.listing.docs = [revised, sentinel];
            await f.run(raster);
            f.listing.docs = [{ ...revised, providerContract: before.providerContract }, sentinel];
            recorded = pair('기타', 'Synthetic Private Name (2)');
        } else {
            const state = await readJson(f.state);
            state.units['doc:provider'].reservedPaths = ['기타/reserved.pdf'];
            await put(f.state, JSON.stringify(state));
            recorded = oldPair;
        }
        const available = pair('제공인력 계약서', '제공인력_계약서_Synthetic Private Name_2026-01-02 (2)');
        const revisedMove = recorded.map((from, i) => ({ from, to: available[i] }));
        assert.deepEqual(movesOf(await f.run([...migrate, '--apply'])), [revisedMove]);
        for (const path of newPair) await absent(join(f.originals, path));
    });
}

test('known legacy publication resumes under the timer before operator dry run and migration can use the case', async (t) => {
    const f = await fixture(t);
    await f.settings({ rcloneRemote: 'mock:' });
    await f.token();
    const original = f.doc('legacy-revision', { providerContract: { signerName: 'Synthetic Private Name', signedDate: '2026-01-02' } });
    const candidate = f.doc('legacy-candidate', { title: 'Eligible legacy candidate' });
    f.listing.docs = [original, candidate];
    await f.run([], 0, { legacyLock: true });
    const revised = f.doc(original.docId, { providerContract: original.providerContract }, ['revised-doc', 'revised-audit']);
    const eligible = { ...candidate, providerContract: original.providerContract };
    f.listing.docs = [revised, eligible];
    await f.run([], 137, { legacyLock: true, killLink: true });
    assert.equal((await readJson(receipt(f))).version, 1);
    const commands = await f.raw();
    for (const action of [[], ['--apply'], ['--rollback']]) {
        assert.deepEqual((await f.run(['--migrate-provider-contracts', ...action], 1)).requests, []);
    }
    assert.deepEqual(await f.raw(), commands);
    // Do not let normal allocation rename the candidate before proving the operator can do it.
    f.listing.docs = [revised, candidate];
    assert.deepEqual((await f.run([], 0, { legacyLock: true })).requests, ['listing', 'report']);
    await absent(receipt(f));
    f.listing.docs = [revised, eligible];
    const beforeDryRun = await tree(f);
    const rawOffset = (await f.raw()).length;
    const dryRun = await f.run(['--migrate-provider-contracts']);
    assert.deepEqual(dryRun.log, [{ migration: 'dry-run', pairs: 1, skipped: 1 }]);
    assert.deepEqual(await tree(f), beforeDryRun);
    const rawReads = (await f.raw()).slice(rawOffset);
    assert.equal(rawReads[0]?.[0], 'listremotes');
    assert.equal(rawReads.filter(([command]) => command === 'listremotes').length, 1);
    assert.ok(rawReads.some(([command, flag]) => command === 'lsjson' && flag === '--stat'));
    assert.ok(rawReads.some(([command, flag]) => command === 'lsjson' && flag === '--retries'));
    assert.equal(rawReads.filter(([command]) => command === 'cat').length, 2);
    assert.ok(rawReads.every(([command]) => ['listremotes', 'lsjson', 'cat'].includes(command)));
    await f.run(['--migrate-provider-contracts', '--apply']);
    const journal = await readJson(f.journal);
    assert.equal(journal.phase, 'applied');
    const destinations = journal.moves[0].files.map(({ new: path }) => path);
    for (const root of [f.publicRoot, f.drive]) await expect(root, destinations, SIGNED);
});
