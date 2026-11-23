import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const MAX_FILE = 2 ** 32;
export const MAX_JSON = 32 * 1024 * 1024;
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const uid = BigInt(process.getuid());
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const badSegment = /[\\:\x00-\x1f\x7f]|\p{Cs}/u;

export class MirrorError extends Error {
    constructor(reason) {
        super('raster_archive_' + reason);
    }
}

export function refuse(reason) {
    throw new MirrorError(reason);
}

export const isPdf = (path) => /\.pdf$/i.test(path);
export const keyOf = (path) => path.normalize('NFC');
export const same = isDeepStrictEqual;
export const shaName = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const sameBytes = (left, right) => Boolean(left && right && left.sha256 === right.sha256 && left.size === right.size);

export function segments(path) {
    if (typeof path !== 'string' || Buffer.byteLength(path) > 4095) refuse('unsafe_path');
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || badSegment.test(part) || Buffer.byteLength(part) > 255)) {
        refuse('unsafe_path');
    }
    return parts;
}

export function rootPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path === '/' || normalize(path) !== path) refuse('unsafe_root');
    segments(path.slice(1));
    return path;
}

export function putName(names, path, value) {
    const key = keyOf(path);
    if (names.has(key)) refuse('ambiguous_path');
    names.set(key, { path, ...value });
}

export function atName(names, path) {
    const value = names.get(keyOf(path));
    if (value && value.path !== path) refuse('ambiguous_path');
    return value;
}

export function identity(info) {
    return [info.dev, info.ino, info.birthtimeNs].map(String);
}

export function validIdentity(value) {
    return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'string' && /^\d+$/.test(part));
}

export function validBytes(value) {
    return shaName(value?.sha256) && typeof value.md5 === 'string' && /^[a-f0-9]{32}$/.test(value.md5)
        && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_FILE;
}

export async function stat(path) {
    return fs.lstat(path, { bigint: true }).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
}

export function checkDirectory(info) {
    if (!info?.isDirectory()) refuse('unsafe_directory');
}

export function checkPrivate(info, mode, strict = true, covered = false) {
    if (info.uid !== uid || (!covered && (info.mode & 0o022n) !== 0n) || (strict && (info.mode & 0o7777n) !== BigInt(mode))) {
        refuse('unsafe_private_permissions');
    }
}

function checkFile(info) {
    if (!info?.isFile() || info.nlink !== 1n) refuse('unsafe_file');
}

export async function rootInfo(path) {
    let current = '/';
    const ancestors = [];
    for (const part of segments(path.slice(1))) {
        current = join(current, part);
        const info = await stat(current);
        if (!info) return { id: null, ancestors };
        checkDirectory(info);
        const id = identity(info);
        if (current === path) return { id, ancestors };
        ancestors.push(id);
    }
    refuse('unsafe_root');
}

export async function checkRoot(path) {
    return (await rootInfo(path)).id;
}

export async function syncDir(path) {
    const handle = await fs.open(path, directoryFlags);
    try { await handle.sync(); } finally { await handle.close(); }
}

export async function directory(path, { create = false, privateFrom = null, tighten = false } = {}) {
    let current = '/';
    let covered = false;
    for (const part of segments(path.slice(1))) {
        const parent = current;
        current = join(current, part);
        const privateDir = privateFrom && (current === privateFrom || current.startsWith(privateFrom + '/'));
        let info = await stat(current);
        if (!info) {
            if (!create) return null;
            await fs.mkdir(current, { mode: privateDir ? 0o700 : 0o755 });
            await syncDir(parent);
            info = await stat(current);
        }
        checkDirectory(info);
        if (privateDir) {
            checkPrivate(info, 0o700, !tighten, covered);
            if (tighten && (info.mode & 0o7777n) !== 0o700n) {
                const handle = await fs.open(current, directoryFlags);
                try {
                    if (!same(identity(await handle.stat({ bigint: true })), identity(info))) refuse('directory_changed');
                    await handle.chmod(0o700);
                    await handle.sync();
                } finally {
                    await handle.close();
                }
            }
            covered = true;
        }
    }
    return current;
}

export async function openDirectory(path) {
    // Anchor public rename/delete and local staging to an open directory on Linux.
    let handle = await fs.open('/', directoryFlags);
    try {
        for (const part of segments(path.slice(1))) {
            const child = await fs.open(join(fdPath(handle), part), directoryFlags);
            await handle.close();
            handle = child;
        }
        return handle;
    } catch (error) {
        await handle.close();
        throw error;
    }
}

export const fdPath = (handle) => '/proc/self/fd/' + handle.fd;

export async function hashChunks(chunks, { output, limit = MAX_FILE } = {}) {
    const hash = createHash('sha256');
    const md5 = createHash('md5');
    let size = 0;
    for await (const bytes of chunks) {
        size += bytes.length;
        if (size > limit) refuse('file_size');
        hash.update(bytes);
        md5.update(bytes);
        if (output) {
            let offset = 0;
            while (offset < bytes.length) {
                const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset);
                if (!bytesWritten) refuse('file_write');
                offset += bytesWritten;
            }
        }
    }
    if (!size) refuse('file_size');
    return { sha256: hash.digest('hex'), md5: md5.digest('hex'), size };
}

export async function inspectFile(path, { output, privateFile = false, allowLoose = false, tighten = false, covered = false, sync = false } = {}) {
    const before = await stat(path);
    if (!before) return null;
    checkFile(before);
    if (privateFile) checkPrivate(before, 0o600, !allowLoose && !tighten, covered);
    const handle = await fs.open(path, readFlags);
    try {
        const opened = await handle.stat({ bigint: true });
        checkFile(opened);
        if (!same(identity(before), identity(opened))) refuse('file_changed');
        if (privateFile) {
            checkPrivate(opened, 0o600, !allowLoose && !tighten, covered);
            if (tighten && (opened.mode & 0o7777n) !== 0o600n) await handle.chmod(0o600);
        }
        const bytes = await hashChunks(handle.createReadStream({ autoClose: false }), { output });
        const after = await handle.stat({ bigint: true });
        const current = await stat(path);
        if (opened.size !== BigInt(bytes.size) || opened.size !== after.size || opened.mtimeNs !== after.mtimeNs
            || current?.ctimeNs !== after.ctimeNs || !same(identity(after), identity(current))) {
            refuse('file_changed');
        }
        if (sync) await handle.sync();
        return { bytes, id: identity(after), mtime: Number(after.mtimeNs) / 1e9 };
    } finally {
        await handle.close();
    }
}

export async function scanLocal(root, { privateTree = false } = {}) {
    const names = new Map();
    if (!await checkRoot(root)) return names;
    const rootMeta = await stat(root);
    const covered = privateTree && rootMeta.uid === uid && (rootMeta.mode & 0o7777n) === 0o700n;
    async function walk(relative = '') {
        const parent = join(root, relative);
        const info = await stat(parent);
        checkDirectory(info);
        if (privateTree) checkPrivate(info, 0o700, false, covered);
        for (const rawName of await fs.readdir(parent, { encoding: 'buffer' })) {
            const name = utf8.decode(rawName);
            const path = relative ? relative + '/' + name : name;
            segments(path);
            const full = join(root, path);
            const info = await stat(full);
            if (!info || info.isSymbolicLink()) refuse('unsafe_file');
            const isDir = info.isDirectory();
            if (isPdf(path)) checkFile(info);
            putName(names, path, { isDir });
            // Existing scratch payloads are .stage/.tmp files (including the
            // publication worker's .provider-publication-* directories).
            // Scan their structure for symlinks, but only index actual PDFs.
            if (isDir) {
                await walk(path);
            } else if (isPdf(path)) {
                const file = await inspectFile(full, { privateFile: privateTree, allowLoose: true, covered });
                if (!file) refuse('file_changed');
                Object.assign(atName(names, path), file);
            }
        }
    }
    await walk();
    return names;
}

export async function readJson(path) {
    const before = await stat(path);
    if (!before) return null;
    checkFile(before);
    checkPrivate(before, 0o600);
    if (before.size > BigInt(MAX_JSON)) refuse('state_size');
    const handle = await fs.open(path, readFlags);
    try {
        const opened = await handle.stat({ bigint: true });
        if (!same(identity(before), identity(opened)) || opened.size !== before.size) refuse('state_changed');
        return JSON.parse(await handle.readFile('utf8'));
    } finally {
        await handle.close();
    }
}

export async function exclusiveFile(parent, prefix, write) {
    const path = join(parent, prefix + randomUUID() + '.tmp');
    const handle = await fs.open(path, 'wx', 0o600);
    try {
        const value = await write(handle);
        await handle.sync();
        return { path, value };
    } catch (error) {
        await fs.unlink(path);
        throw error;
    } finally {
        await handle.close();
    }
}

export async function saveJson(path, value) {
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text) > MAX_JSON) refuse('state_size');
    const parent = dirname(path);
    const staged = await exclusiveFile(parent, '.journal-', (handle) => handle.writeFile(text));
    try {
        await fs.rename(staged.path, path);
        await syncDir(parent);
    } finally {
        await fs.unlink(staged.path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
}

export async function checkPrivateState(path, isUnfinishedOutput) {
    const info = await stat(path);
    if (!info) return;
    if (info.isDirectory()) {
        checkPrivate(info, 0o700);
        for (const name of await fs.readdir(path)) await checkPrivateState(join(path, name), isUnfinishedOutput);
    } else {
        checkFile(info);
        const unfinished = isUnfinishedOutput(path);
        checkPrivate(info, 0o600, !unfinished, unfinished);
    }
}
