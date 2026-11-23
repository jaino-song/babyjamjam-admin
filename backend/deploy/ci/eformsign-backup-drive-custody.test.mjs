import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { migrateProviderContracts } from '../eformsign-backup/provider-contract-migration.mjs';
import { pairPaths, providerBase, providerFolder } from '../eformsign-backup/provider-contract-paths.mjs';
import { remoteTransport } from '../eformsign-backup/raster-mirror-remote.mjs';

const fake = String.raw`#!/usr/bin/env node
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { basename, dirname, join } = require('node:path');
const [command, ...args] = process.argv.slice(2);
const separator = args.indexOf('--');
assert.ok(separator >= 0);
const flags = args.slice(0, separator);
const operands = args.slice(separator + 1);
const follow = flags.includes('--drive-skip-shortcuts=false');
const recursive = flags.includes('--recursive');
const statePath = join(__dirname, 'metadata.json');
const state = JSON.parse(fs.readFileSync(statePath));
const parentId = flags.find((flag) => flag.startsWith('--drive-root-folder-id='))?.split('=')[1];
let hasLock = true;
try { fs.fstatSync(3); } catch { hasLock = false; }
fs.appendFileSync(join(__dirname, 'calls.jsonl'),
    JSON.stringify({ command, flags, operands, hasLock, follow, recursive, parentId }) + '\n');
const operand = operands.at(-1);
const path = operand?.slice('fixture:'.length);
const dir = (key) => ({
    IsDir: true, Size: -1, ID: 'dir_' + createHash('sha256').update(key).digest('hex').slice(0, 16),
    MimeType: 'inode/directory',
});
const output = (data) => process.stdout.write(JSON.stringify(data));
switch (command) {
    case 'listremotes':
        assert.ok(flags.includes('--long'));
        process.stdout.write('fixture: drive\n');
        break;
    case 'lsjson': {
        if (flags.includes('--stat')) {
            assert.equal(operand, 'fixture:');
            assert.equal(follow, false);
            output({ IsDir: true, Size: -1, Path: '', Name: '' });
            break;
        }
        assert.ok(flags.includes('--drive-export-formats=url'));
        if (follow) {
            assert.equal(recursive, false);
            assert.equal(operand, 'fixture:');
            assert.equal(flags[flags.indexOf('--max-depth') + 1], '1');
        }
        const parent = parentId
            ? Object.keys(state.rows).find((key) => state.rows[key].ID === parentId) : path;
        assert.ok(parent !== undefined && (!parent || state.rows[parent]?.IsDir));
        const prefix = parent ? parent + '/' : '';
        const rows = Object.entries(state.rows).filter(([key]) => key.startsWith(prefix) && key !== parent
            && (recursive || dirname(key) === (parent || '.'))).map(([key, row]) => ({
            ...row, Path: key.slice(prefix.length), Name: basename(key),
        }));
        output(follow && state.inclusive[parent] || rows);
        break;
    }
    case 'cat':
        assert.ok(path in state.files);
        process.stdout.write(Buffer.from(state.files[path], 'base64'));
        break;
    case 'copyto': {
        const bytes = fs.readFileSync(operands[0]);
        const parent = dirname(path);
        let key = '';
        for (const part of parent.split('/')) {
            key = key ? key + '/' + part : part;
            state.rows[key] ??= dir(key);
        }
        state.files[path] = bytes.toString('base64');
        state.rows[path] ??= { IsDir: false, ID: 'file_new_' + createHash('sha256').update(path).digest('hex') };
        state.rows[path].Size = bytes.length;
        state.rows[path].MimeType = 'application/pdf';
        state.rows[path].Hashes = { md5: createHash('md5').update(bytes).digest('hex') };
        fs.writeFileSync(statePath, JSON.stringify(state));
        break;
    }
    case 'deletefile':
        assert.ok(path in state.files);
        delete state.files[path];
        delete state.rows[path];
        fs.writeFileSync(statePath, JSON.stringify(state));
        break;
    default:
        assert.fail('Unexpected command');
}
`;

const archive = 'archive';
const filePath = 'records/sample.pdf';
const bytes = Buffer.from('%PDF-1.4\nSynthetic custody fixture\n');
const digest = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const folder = (id) => ({ IsDir: true, Size: -1, ID: id, MimeType: 'inode/directory' });
const pdf = (id, value = bytes) => ({
    IsDir: false, Size: value.length, ID: id, MimeType: 'application/pdf', Hashes: { md5: digest(value, 'md5') },
});
const listed = (path, row) => ({ ...row, Name: path, Path: path });

async function fixture(t, rows, files = {}) {
    const root = await fs.mkdtemp(join(tmpdir(), 'backup-custody-'));
    const lock = await fs.open(join(root, 'lock'), 'w', 0o600);
    t.after(async () => {
        await lock.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const rcloneBin = join(root, 'rclone');
    const statePath = join(root, 'metadata.json');
    const settings = { rcloneBin, rcloneRemote: 'fixture:' + archive };
    const state = {
        rows, files: Object.fromEntries(Object.entries(files).map(([path, value]) => [path, value.toString('base64')])),
        inclusive: {},
    };
    await fs.writeFile(rcloneBin, fake, { mode: 0o700 });
    const write = () => fs.writeFile(statePath, JSON.stringify(state));
    await write();
    const calls = async () => (await fs.readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    return { root, lock, settings, state, write, calls, remote: remoteTransport(settings, lock.fd) };
}

function assertDataFlags(calls) {
    const data = calls.filter(({ command }) => ['cat', 'copyto', 'deletefile'].includes(command));
    assert.deepEqual(new Set(data.map(({ command }) => command)), new Set(['cat', 'copyto', 'deletefile']));
    for (const { flags, hasLock } of data) {
        assert.deepEqual(flags.filter((flag) => flag.startsWith('--drive-skip-shortcuts=')), ['--drive-skip-shortcuts=true']);
        assert.equal(hasLock, true);
    }
}

async function assertMetadataOnly(f) {
    const calls = await f.calls();
    assert.ok(calls.every(({ command }) => command === 'lsjson' || command === 'listremotes'));
    assert.ok(calls.filter(({ follow }) => follow).every(({ command, recursive, operands }) =>
        command === 'lsjson' && !recursive && operands[0] === 'fixture:'));
}

const validRows = () => ({
    [archive]: folder('archive_id'),
    [`${archive}/records`]: folder('records_id'),
    [`${archive}/${filePath}`]: pdf('sample_id'),
});

test('mirror proves the named Drive root from its parent and uses one no-follow recursive inventory', async (t) => {
    const f = await fixture(t, validRows(), { [`${archive}/${filePath}`]: bytes });
    const { names, root } = await f.remote.inventory();
    await assertMetadataOnly(f);
    assert.deepEqual(root, [null, 'archive_id']);
    const calls = await f.calls();
    const recursive = calls.filter((call) => call.recursive);
    assert.equal(recursive.length, 1);
    assert.ok(recursive[0].flags.includes('--drive-skip-shortcuts=true'));
    const beforeInventory = calls.slice(0, calls.indexOf(recursive[0]));
    assert.ok(beforeInventory.some(({ follow, operands }) => follow && operands[0] === 'fixture:'));
    assert.ok(beforeInventory.some(({ flags, operands }) => !flags.includes('--stat') && operands[0] === 'fixture:'));
    assert.equal((await f.remote.read(filePath, f.remote.fromInventory(names, filePath))).sha256, digest(bytes));
    const readCalls = (await f.calls()).slice(calls.length);
    assert.ok(readCalls.slice(0, readCalls.findIndex(({ command }) => command === 'cat'))
        .some(({ follow, parentId }) => follow && parentId === 'records_id'));
    const local = join(f.root, 'private.pdf');
    await fs.writeFile(local, bytes);
    const next = 'missing/deeper/new.pdf';
    assert.deepEqual(await f.remote.lookup(next), { entry: null, chain: [] });
    await f.remote.upload(next, local);
    assert.equal((await f.remote.lookup(next)).chain.length, 2);
    await f.remote.delete(next);
    assert.equal((await f.remote.lookup(next)).entry, null);
    assert.deepEqual(await fs.readFile(local), bytes);
    assertDataFlags(await f.calls());
});

test('idle Drive inventory uses only root checks and one no-follow recursive listing', async (t) => {
    const f = await fixture(t, validRows());
    const { root } = await f.remote.inventory();
    const offset = (await f.calls()).length;
    for (let i = 0; i < 19; i++) {
        const parent = `${archive}/batch-${i}`;
        f.state.rows[parent] = folder(`batch_${i}`);
        f.state.rows[`${parent}/sample.pdf`] = pdf(`sample_${i}`);
    }
    await f.write();

    const { names } = await f.remote.inventory(root);

    assert.equal(names.size, 40);
    const calls = (await f.calls()).slice(offset);
    assert.ok(calls.every(({ command }) => command === 'lsjson'));
    assert.equal(calls.length, 7);
    const recursive = calls.filter((call) => call.recursive);
    assert.equal(recursive.length, 1);
    assert.ok(recursive[0].flags.includes('--drive-skip-shortcuts=true'));
    assert.equal(calls.filter(({ follow }) => follow).length, 2);
    assert.ok(calls.filter(({ follow }) => follow).every(({ operands, parentId }) =>
        operands[0] === 'fixture:' && parentId === undefined));
});

const nativeLink = () => ({ ...pdf('native_link_id'), MimeType: 'application/x-link-url' });

for (const [name, change, action, reason] of [
    ['an archive root only visible inclusively', (s) => {
        delete s.rows[archive];
        s.inclusive[''] = [listed(archive, folder('archive_id'))];
    }, 'inventory', /remote_shortcut_ambiguity/],
    ['a named archive root with no native ID', (s) => {
        delete s.rows[archive].ID;
    }, 'inventory', /unsafe_remote_listing/],
    ['a conflicting native-link metadata row at the archive root', (s) => {
        s.inclusive[''] = [
            listed(archive, folder('archive_id')),
            listed(archive + '.url', nativeLink()),
        ];
    }, 'inventory', /remote_shortcut_ambiguity/],
    ['a native .url alias at the archive root in both views', (s) => {
        s.rows[archive + '.url'] = nativeLink();
    }, 'inventory', /unsafe_remote_listing/],
    ['a native .url alias at the upload endpoint in both views', (s) => {
        delete s.rows[archive + '/' + filePath];
        s.rows[archive + '/' + filePath + '.url'] = nativeLink();
    }, 'upload', /unsafe_remote_listing/],
    ['an apparent absent ancestor', (s) => {
        delete s.rows[archive + '/records'];
        s.inclusive[archive] = [listed('records', folder('records_id'))];
    }, 'upload', /remote_shortcut_ambiguity/],
    ['an apparent absent endpoint', (s) => {
        delete s.rows[archive + '/' + filePath];
        s.inclusive[archive + '/records'] = [listed('sample.pdf', pdf('sample_id'))];
    }, 'upload', /remote_shortcut_ambiguity/],
    ['an inclusive duplicate with identical visible metadata', (s) => {
        const row = listed('sample.pdf', pdf('sample_id'));
        s.inclusive[archive + '/records'] = [row, row];
    }, 'upload', /ambiguous_path/],
    ['an inclusive ID change with the same name, MIME and hash', (s) => {
        s.inclusive[archive + '/records'] = [listed('sample.pdf', pdf('different_id'))];
    }, 'delete', /remote_shortcut_ambiguity/],
    ['a contradictory underlying ID', (s) => {
        s.rows[archive + '/' + filePath].OrigID = 'different_id';
    }, 'inventory', /unsafe_remote_listing/],
    ['an exposed composite ID', (s) => {
        s.rows[archive + '/records'].ID = 'first\u0009second';
    }, 'inventory', /unsafe_remote_listing/],
    ['a dangling MIME marker', (s) => {
        s.rows[archive + '/' + filePath].MimeType = 'application/vnd.google-apps.shortcut.dangling';
    }, 'inventory', /unsafe_remote_listing/],
]) {
    test(`mirror refuses ${name} before data commands`, async (t) => {
        const f = await fixture(t, validRows());
        change(f.state);
        await f.write();
        const source = join(f.root, 'private.pdf');
        await fs.writeFile(source, bytes);
        const attempt = {
            inventory: () => f.remote.inventory(),
            upload: () => f.remote.upload(filePath, source),
            delete: () => f.remote.delete(filePath),
        };
        await assert.rejects(attempt[action](), reason);
        await assertMetadataOnly(f);
        assert.deepEqual(await fs.readFile(source), bytes);
    });
}

test('mirror revalidates an inventoried endpoint before the first read', async (t) => {
    const f = await fixture(t, validRows());
    const { names } = await f.remote.inventory();
    f.state.inclusive[archive + '/records'] = [listed('sample.pdf', pdf('different_id'))];
    await f.write();
    await assert.rejects(f.remote.read(filePath, f.remote.fromInventory(names, filePath)), /remote_shortcut_ambiguity/);
    await assertMetadataOnly(f);
});

test('installed local rclone keeps ID-less inventory to one recursive listing and zero cats', async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'backup-local-custody-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const bin = join(root, 'rclone');
    const config = join(root, 'rclone.conf');
    const log = join(root, 'calls.jsonl');
    await fs.writeFile(config, '[fixture]\ntype = local\n');
    await fs.mkdir(join(root, archive, 'records'), { recursive: true });
    await fs.writeFile(join(root, archive, filePath), bytes);
    await fs.writeFile(bin, `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
process.exit(spawnSync('/usr/bin/rclone', args, {
    cwd: ${JSON.stringify(root)}, stdio: 'inherit',
    env: { PATH: '/usr/bin:/bin', RCLONE_CONFIG: ${JSON.stringify(config)} },
}).status ?? 1);
`, { mode: 0o700 });
    const settings = { rcloneBin: bin, rcloneRemote: 'fixture:' + archive };
    const before = await remoteTransport(settings).inventory();
    assert.deepEqual(before.root, [null, null]);
    assert.equal(before.names.get(filePath).md5, digest(bytes, 'md5'));
    await fs.writeFile(log, '');
    const after = await remoteTransport(settings).inventory(before.root);
    assert.deepEqual(before, after);
    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter((args) => args.includes('--recursive')).length, 1);
    assert.equal(calls.filter(([command]) => command === 'lsjson').length, 5);
    assert.ok(calls.every(([command]) => command === 'lsjson' || command === 'listremotes'));
    assert.ok(calls.every((args) => args.slice(1, args.indexOf('--')).includes('--drive-skip-shortcuts=true')));
});

async function legacy(t) {
    const old = pairPaths('기타', 'Synthetic', 1);
    const content = [bytes, Buffer.from('%PDF-1.4\nSynthetic audit fixture\n')];
    const doc = {
        docId: 'fixture', kind: 'other', completed: true,
        providerContract: { signerName: 'Fixture', signedDate: '2026-01-02' },
        files: content.map((value, i) => ({
            fileType: ['document', 'audit_trail'][i], sha256: digest(value), byteSize: value.length,
        })),
    };
    const next = pairPaths(providerFolder, providerBase(doc), 1);
    const f = await fixture(t, {
        [archive]: folder('archive_id'),
        [`${archive}/기타`]: folder('source_directory_id'),
        [`${archive}/기타/감사추적`]: folder('audit_directory_id'),
        ...Object.fromEntries(old.map((path, i) => [`${archive}/${path}`, pdf('source_' + i, content[i])])),
    }, Object.fromEntries(old.map((path, i) => [`${archive}/${path}`, content[i]])));
    const local = join(f.root, 'local');
    const stateDir = join(f.root, 'state');
    const statePath = join(stateDir, 'state.json');
    const state = { units: { 'doc:fixture': {
        completed: true, fingerprint: doc.files.map((file) => file.sha256).join(':'),
        files: Object.fromEntries(old.map((path, i) => [path, content[i].length])),
    } } };
    const finalPath = (path) => join(local, path);
    for (const [i, path] of old.entries()) {
        await fs.mkdir(dirname(finalPath(path)), { recursive: true });
        await fs.writeFile(finalPath(path), content[i]);
    }
    await fs.mkdir(stateDir, { mode: 0o700 });
    const saveState = () => fs.writeFile(statePath, JSON.stringify(state));
    await saveState();
    const apply = () => migrateProviderContracts({
        settings: { ...f.settings, stateDir, action: 'apply' }, archive: local,
        statePath, state, reserved: new Set(old), saveState, docs: [doc],
        listingComplete: true, finalPath, timeout: 5000, lockFd: f.lock.fd, log() {},
    });
    return { ...f, apply, content, old, next, finalPath, stateDir };
}

test('legacy migration proves absent destinations and copies and removes only verified files', async (t) => {
    const f = await legacy(t);
    await f.apply();
    for (const [i, path] of f.next.entries()) {
        assert.deepEqual(await fs.readFile(f.finalPath(path)), f.content[i]);
        await assert.rejects(fs.stat(f.finalPath(f.old[i])), { code: 'ENOENT' });
    }
    const calls = await f.calls();
    assertDataFlags(calls);
    assert.ok(calls.filter(({ command }) => command === 'copyto').every(({ flags }) =>
        flags.includes('--immutable') && flags.includes('--ignore-existing')));
    assert.ok(calls.every(({ recursive }) => !recursive));
});

for (const [name, change] of [
    ['a mismatched archive root', (f) => {
        f.state.inclusive[''] = [listed(archive, folder('different_archive_id'))];
    }],
    ['a source ancestor only visible inclusively', (f) => {
        delete f.state.rows[archive + '/기타'];
        f.state.inclusive[archive] = [listed('기타', folder('source_directory_id'))];
    }],
    ['an altered audit endpoint', (f) => {
        const audit = basename(f.old[1]);
        f.state.inclusive[archive + '/기타/감사추적'] = [listed(audit, pdf('different_id', f.content[1]))];
    }],
    ['an apparently absent destination endpoint', (f) => {
        f.state.rows[archive + '/' + providerFolder] = folder('provider_id');
        f.state.inclusive[archive + '/' + providerFolder] = [listed(basename(f.next[0]), pdf('destination_id'))];
    }],
]) {
    test(`legacy migration refuses ${name} before data commands or journal creation`, async (t) => {
        const f = await legacy(t);
        change(f);
        await f.write();
        await assert.rejects(f.apply(), { migrationReason: 'drive_shortcut_ambiguity' });
        await assertMetadataOnly(f);
        assert.deepEqual(await fs.readdir(f.stateDir), ['state.json']);
        for (const [i, path] of f.old.entries()) {
            assert.deepEqual(await fs.readFile(f.finalPath(path)), f.content[i]);
            await assert.rejects(fs.stat(f.finalPath(f.next[i])), { code: 'ENOENT' });
        }
    });
}
