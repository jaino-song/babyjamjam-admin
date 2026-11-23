import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import {
    atName, hashChunks, isPdf, keyOf, MAX_FILE, MAX_JSON, putName, refuse, rootPath, same, segments,
} from './raster-mirror-io.mjs';

const flags = [
    '--retries', '1', '--low-level-retries', '2', '--contimeout', '10s', '--timeout', '45s',
    '--log-level', 'ERROR', '--log-file=', '--drive-skip-shortcuts=false', '--drive-skip-dangling-shortcuts=false',
    '--drive-use-trash=true', '--local-unicode-normalization=false', '--links=true', '--copy-links=false',
];
const timeoutMs = 5 * 60 * 1000;
const utf8 = new TextDecoder('utf-8', { fatal: true });

async function run(bin, lockFd, command, options, operands, consume) {
    const stdio = ['ignore', 'pipe', 'pipe'];
    if (lockFd !== undefined) stdio.push(lockFd);
    const child = spawn(bin, [command, ...options, ...flags, '--', ...operands], { stdio });
    // rclone may report an incomplete listing (e.g. a shortcut loop) on
    // stderr even with exit zero. Never surface or persist those diagnostics.
    let diagnostics = false;
    child.stderr.on('data', () => { diagnostics = true; });
    const exit = new Promise((resolve) => {
        child.once('error', () => resolve(null));
        child.once('close', (code) => resolve(code));
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    try {
        const result = await consume(child.stdout).catch((error) => {
            child.kill('SIGKILL');
            throw error;
        });
        const code = await exit;
        if (code !== 0 || diagnostics) refuse('remote_' + command + '_failed');
        return result;
    } finally {
        await exit;
        clearTimeout(timer);
    }
}

async function collect(stream, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > limit) refuse('remote_output_size');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
}

const idOk = (value) => typeof value === 'string' && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
export const validRemoteId = (value) => value === null || (idOk(value) && value !== '');

function listingMd5(hashes) {
    if (hashes === undefined) return null;
    if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) refuse('unsafe_remote_listing');
    // rclone 1.60.1 reports "md5" even when the requested hash is "MD5".
    let digest = null;
    for (const key of ['md5', 'MD5']) {
        if (!Object.hasOwn(hashes, key)) continue;
        const alias = hashes[key];
        if (typeof alias !== 'string' || !/^[a-f0-9]{32}$/i.test(alias)) refuse('unsafe_remote_listing');
        const normalized = alias.toLowerCase();
        if (digest !== null && digest !== normalized) refuse('unsafe_remote_listing');
        digest = normalized;
    }
    return digest;
}

function entryMeta(value) {
    if (!value || typeof value.IsDir !== 'boolean' || (value.ID !== undefined && !idOk(value.ID))
        || (value.OrigID && value.OrigID !== value.ID) || value.IsBucket === true
        || value.MimeType === 'application/vnd.google-apps.shortcut') {
        refuse('unsafe_remote_listing');
    }
    const { IsDir: isDir, Size: size, ID, Hashes, ModTime, MimeType } = value;
    const md5 = listingMd5(Hashes);
    if (!isDir && (!Number.isSafeInteger(size) || size < 0 || MimeType?.startsWith('application/vnd.google-apps.'))) {
        // Native Drive files are exports rather than byte-addressable PDFs.
        // Ignore native non-PDF entries unless an exact path relies on them.
        if (isPdf(value.Path ?? value.Name)) refuse('unsafe_remote_file');
    }
    const time = Date.parse(ModTime);
    return { isDir, size, id: ID || null, md5, mtime: Number.isFinite(time) ? time / 1000 : null };
}

function parseList(text, recursive, selected) {
    const rows = JSON.parse(utf8.decode(text));
    if (!Array.isArray(rows)) refuse('unsafe_remote_listing');
    const names = new Map();
    for (const row of rows) {
        const path = row?.Path;
        if (selected && typeof path === 'string' && keyOf(path) !== keyOf(selected)) continue;
        const parts = segments(path);
        if (row.Name !== basename(path) || (!recursive && parts.length !== 1) || /\.rclonelink$/i.test(path)) {
            refuse('unsafe_remote_listing');
        }
        const meta = entryMeta(row);
        if (isPdf(path) && (meta.isDir || meta.size <= 0 || meta.size > MAX_FILE)) refuse('unsafe_remote_file');
        putName(names, path, meta);
    }
    const ids = new Set();
    for (const entry of names.values()) {
        const slash = entry.path.lastIndexOf('/');
        if (slash !== -1 && !atName(names, entry.path.slice(0, slash))?.isDir) refuse('unsafe_remote_listing');
        if (entry.id !== null) {
            if (ids.has(entry.id)) refuse('ambiguous_remote_identity');
            ids.add(entry.id);
        }
    }
    return names;
}

export function remoteTransport(settings, lockFd) {
    const { rcloneRemote: target, rcloneBin: bin = 'rclone' } = settings;
    if (target === undefined || target === null) return null;
    const match = typeof target === 'string' && /^([a-zA-Z0-9_][a-zA-Z0-9_. -]*:)(.*)$/u.exec(target);
    if (!match || match[0] !== target) refuse('unsafe_remote_target');
    if (typeof bin !== 'string') refuse('unsafe_remote_executable');
    if (bin.startsWith('/')) rootPath(bin);
    else if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(bin)) refuse('unsafe_remote_executable');
    const [, remote, base] = match;
    const baseParts = base ? segments(base) : [];
    const exact = (path) => remote + path;
    const underBase = (path) => base && path ? base + '/' + path : base || path;
    const invoke = (command, options, operands, consume) => run(bin, lockFd, command, options, operands, consume);
    const empty = (stream) => collect(stream, 1024);
    let boundRoot;

    async function list(path, { recursive = false, hashes = false, selected } = {}) {
        const options = [...(recursive ? ['--recursive'] : []), ...(hashes ? ['--hash-type', 'MD5'] : [])];
        const result = await invoke('lsjson', options, [exact(path)], (stream) => collect(stream, MAX_JSON));
        return parseList(result, recursive, selected);
    }

    async function rootChain() {
        const root = await invoke('lsjson', ['--stat'], [remote], (stream) => collect(stream, MAX_JSON));
        const info = entryMeta(JSON.parse(utf8.decode(root)));
        if (!info.isDir) refuse('unsafe_remote_root');
        const chain = [info.id];
        let current = '';
        for (const part of baseParts) {
            const entry = atName(await list(current, { selected: part }), part);
            if (!entry?.isDir) refuse('unsafe_remote_root');
            chain.push(entry.id);
            current = current ? current + '/' + part : part;
        }
        const ids = chain.filter((id) => id !== null);
        if (new Set(ids).size !== ids.length) refuse('ambiguous_remote_identity');
        if (boundRoot && !same(boundRoot, chain)) refuse('remote_root_changed');
        return chain;
    }

    function fromInventory(names, path) {
        const parts = segments(path);
        const leaf = parts.pop();
        const chain = [];
        let current = '';
        for (const part of parts) {
            current = current ? current + '/' + part : part;
            const entry = atName(names, current);
            if (!entry) return { entry: null, chain };
            if (!entry.isDir) refuse('unsafe_remote_directory');
            chain.push(entry.id);
        }
        const entry = atName(names, current ? current + '/' + leaf : leaf) ?? null;
        if (entry?.isDir) refuse('unsafe_remote_file');
        const ids = [...chain, entry?.id].filter((id) => id);
        if (new Set(ids).size !== ids.length) refuse('ambiguous_remote_identity');
        return { entry, chain };
    }

    async function lookup(path) {
        await rootChain();
        const parts = segments(path);
        const leaf = parts.pop();
        const chain = [];
        let current = '';
        for (const part of parts) {
            const entry = atName(await list(underBase(current)), part);
            if (!entry) return { entry: null, chain };
            if (!entry.isDir) refuse('unsafe_remote_directory');
            chain.push(entry.id);
            current = current ? current + '/' + part : part;
        }
        const entry = atName(await list(underBase(current), { hashes: true }), leaf) ?? null;
        if (entry?.isDir) refuse('unsafe_remote_file');
        const ids = [...chain, entry?.id].filter((id) => id);
        if (new Set(ids).size !== ids.length) refuse('ambiguous_remote_identity');
        return { entry, chain };
    }

    function assertListing(before, after) {
        if (!after.entry || !same(before.chain, after.chain) || before.entry.id !== after.entry.id
            || before.entry.size !== after.entry.size || before.entry.md5 !== after.entry.md5
            || before.entry.mtime !== after.entry.mtime) refuse('remote_identity_changed');
    }

    async function read(path, observed, { output } = {}) {
        const { entry } = observed;
        if (!entry || entry.size <= 0 || entry.size > MAX_FILE) refuse('unsafe_remote_file');
        const bytes = await invoke('cat', [], [exact(underBase(path))], (stream) => hashChunks(stream, { output, limit: entry.size }));
        if (bytes.size !== entry.size || (entry.md5 && entry.md5 !== bytes.md5)) refuse('remote_checksum_changed');
        assertListing(observed, await lookup(path));
        return bytes;
    }

    return {
        target,
        async inventory(expected) {
            boundRoot = expected ?? await rootChain();
            if (expected) await rootChain();
            const names = await list(base, { recursive: true, hashes: true });
            await rootChain();
            return { names, root: boundRoot };
        },
        fromInventory,
        lookup,
        read,
        upload: (path, source) => invoke('copyto', ['--ignore-times'], [source, exact(underBase(path))], empty),
        delete: (path) => invoke('deletefile', [], [exact(underBase(path))], empty),
    };
}
