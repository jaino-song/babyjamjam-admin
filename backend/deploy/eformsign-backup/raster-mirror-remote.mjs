import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import {
    atName, hashChunks, isPdf, keyOf, MAX_FILE, MAX_JSON, putName, refuse, rootPath, same, segments,
} from './raster-mirror-io.mjs';

const flags = [
    '--retries', '1', '--low-level-retries', '2', '--contimeout', '10s', '--timeout', '45s',
    '--log-level', 'ERROR', '--log-file=', '--drive-skip-dangling-shortcuts=false',
    '--drive-use-trash=true', '--local-unicode-normalization=false', '--links=true', '--copy-links=false',
];
const timeoutMs = 5 * 60 * 1000;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const driveView = ['--drive-skip-gdocs=false', '--drive-export-formats=url'];

async function run(bin, lockFd, timeout, command, options, operands, consume, inclusive = false, signal) {
    signal?.throwIfAborted();
    const stdio = ['ignore', 'pipe', 'pipe'];
    if (lockFd !== undefined) stdio.push(lockFd);
    const child = spawn(bin, [
        command, ...options, ...flags, `--drive-skip-shortcuts=${!inclusive}`, '--', ...operands,
    ], { stdio });
    // rclone may report an incomplete listing (e.g. a shortcut loop) on
    // stderr even with exit zero. Never surface or persist those diagnostics.
    let diagnostics = false;
    child.stderr.on('data', () => { diagnostics = true; });
    const exit = new Promise((resolve) => {
        child.once('error', () => resolve(null));
        child.once('close', (code) => resolve(code));
    });
    const stop = () => child.kill('SIGKILL');
    const timer = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
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
        signal?.removeEventListener('abort', stop);
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
const driveId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,1024}$/.test(value);
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
        || (value.OrigID !== undefined && (!idOk(value.OrigID) || value.OrigID !== value.ID))
        || (value.IsBucket !== undefined && value.IsBucket !== false)
        || (value.ModTime !== undefined && typeof value.ModTime !== 'string')
        || (value.MimeType !== undefined && (typeof value.MimeType !== 'string'
            || /^application\/vnd\.google-apps\.shortcut/i.test(value.MimeType)
            || (value.MimeType !== '' && value.IsDir !== ['inode/directory', 'application/vnd.google-apps.folder'].includes(value.MimeType))))) {
        refuse('unsafe_remote_listing');
    }
    const { IsDir: isDir, Size: size, ID, Hashes, ModTime, MimeType } = value;
    const md5 = listingMd5(Hashes);
    const time = typeof ModTime === 'string' ? Date.parse(ModTime) : NaN;
    return {
        isDir, size, id: ID || null, md5, mtime: Number.isFinite(time) ? time / 1000 : null,
        modified: ModTime, mime: MimeType,
    };
}

function parseJson(text) {
    try { return JSON.parse(utf8.decode(text)); }
    catch { refuse('unsafe_remote_listing'); }
}

function parseList(text, { recursive, selected, drive, legacy }) {
    const rows = parseJson(text);
    if (!Array.isArray(rows)) refuse('unsafe_remote_listing');
    const names = new Map();
    const selectedKeys = selected && new Set([keyOf(selected), ...(drive ? [keyOf(selected + '.url')] : [])]);
    for (const row of rows) {
        const path = legacy && row?.Path === undefined ? row?.Name : row?.Path;
        if (selectedKeys && typeof path === 'string' && typeof row.Name === 'string'
            && !selectedKeys.has(keyOf(path)) && !selectedKeys.has(keyOf(row.Name))) continue;
        const parts = segments(path);
        if (row.Name !== basename(path) || (!recursive && parts.length !== 1) || /\.rclonelink$/i.test(path)) {
            refuse('unsafe_remote_listing');
        }
        const meta = entryMeta(row);
        if (drive && (!driveId(meta.id) || !Number.isSafeInteger(meta.size)
            || (meta.modified && meta.mtime === null))) refuse('unsafe_remote_listing');
        if (!legacy && isPdf(path) && (meta.isDir || !Number.isSafeInteger(meta.size)
            || meta.size <= 0 || meta.size > MAX_FILE || meta.mime?.startsWith('application/vnd.google-apps.'))) {
            refuse('unsafe_remote_file');
        }
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

export function remoteTransport(settings, lockFd, legacyTimeout, deadline, signal) {
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
    const legacy = legacyTimeout !== undefined;
    const invoke = (command, options, operands, consume, inclusive) => {
        const configured = legacyTimeout ?? timeoutMs;
        const budget = deadline === undefined ? configured : Math.min(configured, deadline - performance.now());
        if (deadline !== undefined && budget <= 0) refuse('remote_time_budget');
        return run(bin, lockFd, budget, command, options, operands, consume, inclusive, signal);
    };
    const metadata = (stream) => collect(stream, legacy ? 16 * 1024 * 1024 : MAX_JSON);
    const empty = (stream) => collect(stream, 1024);
    let boundRoot;
    let backend;
    const observedPaths = new Map();

    async function backendType() {
        if (backend) return backend;
        // Read only rclone's type summary. A direct local backend has
        // independent link checks and needs no second view of its inventory.
        const result = await invoke('listremotes', ['--long'], [], metadata);
        const types = utf8.decode(result).split('\n').filter((line) => line.toLowerCase().startsWith(remote.toLowerCase() + ' '));
        const type = types.length === 1 && types[0].startsWith(remote + ' ') && types[0].slice(remote.length).trim();
        if (type !== 'drive' && type !== 'local') refuse('unsafe_remote_backend');
        backend = type;
        return type;
    }

    async function list(path, { recursive = false, hashes = false, selected, inclusive = false, parentId = null } = {}) {
        const drive = await backendType() === 'drive';
        const options = [
            ...(recursive ? ['--recursive'] : []), ...(hashes ? ['--hash-type', 'MD5'] : []),
            // Link export gives even otherwise unlistable native Drive objects a
            // metadata row. Its added suffix is also checked in selected lists.
            ...(drive ? ['--max-depth', recursive ? '-1' : '1', ...driveView] : []),
            ...(inclusive ? ['--drive-auth-owner-only=false'] : []),
            ...(inclusive && parentId !== null
                ? [`--drive-root-folder-id=${parentId}`, '--drive-shared-with-me=false', '--drive-starred-only=false'] : []),
        ];
        // Inclusive metadata must never resolve a parent by name. An absent
        // parent ID is only valid for the operator's bare configured namespace.
        if (inclusive && (recursive || !drive || (path && parentId === null))) refuse('unsafe_remote_listing');
        const result = await invoke('lsjson', options, [inclusive ? remote : exact(path)], metadata, inclusive);
        return parseList(result, { recursive, selected, drive, legacy });
    }

    async function pairedList(path, options, parentId) {
        const safe = await list(path, options);
        if (backend === 'drive' && !same(safe, await list(path, { ...options, inclusive: true, parentId }))) {
            refuse('remote_shortcut_ambiguity');
        }
        return safe;
    }

    function archiveEntry(names, path) {
        if (backend === 'drive' && atName(names, path + '.url')?.mime === 'application/x-link-url') {
            refuse('unsafe_remote_listing');
        }
        return atName(names, path);
    }

    async function rootChain() {
        await backendType();
        const root = await invoke('lsjson', ['--stat'], [remote], metadata);
        const info = entryMeta(parseJson(root));
        if (!info.isDir || (backend === 'drive' && info.id !== null && !driveId(info.id))) refuse('unsafe_remote_root');
        const chain = [info.id];
        if (boundRoot && boundRoot[0] !== info.id) refuse('remote_root_changed');
        let current = '';
        for (const part of baseParts) {
            const entry = archiveEntry(await pairedList(current, { selected: part }, current ? chain.at(-1) : null), part);
            if (!entry?.isDir) refuse('unsafe_remote_root');
            if (entry.id !== null && chain.includes(entry.id)) refuse('ambiguous_remote_identity');
            if (boundRoot && boundRoot[chain.length] !== entry.id) refuse('remote_root_changed');
            chain.push(entry.id);
            current = current ? current + '/' + part : part;
        }
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
            const entry = archiveEntry(names, current);
            if (!entry) return { entry: null, chain };
            if (!entry.isDir) refuse('unsafe_remote_directory');
            chain.push(entry.id);
        }
        const entry = archiveEntry(names, current ? current + '/' + leaf : leaf) ?? null;
        if (entry?.isDir) refuse('unsafe_remote_file');
        const ids = [...chain, entry?.id].filter((id) => id);
        if (new Set(ids).size !== ids.length) refuse('ambiguous_remote_identity');
        return { entry, chain };
    }

    async function lookup(path) {
        const root = await rootChain();
        boundRoot ??= root;
        const parts = segments(path);
        const leaf = parts.pop();
        const chain = [];
        let current = '';
        let parentId = base ? root.at(-1) : null;
        for (const part of parts) {
            const entry = archiveEntry(await pairedList(underBase(current), {}, parentId), part);
            if (!entry) return { entry: null, chain };
            if (!entry.isDir) refuse('unsafe_remote_directory');
            if (entry.id !== null && (root.includes(entry.id) || chain.includes(entry.id))) refuse('ambiguous_remote_identity');
            chain.push(entry.id);
            parentId = entry.id;
            current = current ? current + '/' + part : part;
        }
        const entry = archiveEntry(await pairedList(underBase(current), { hashes: !legacy }, parentId), leaf) ?? null;
        if (entry?.isDir) refuse('unsafe_remote_file');
        if (entry?.id && (root.includes(entry.id) || chain.includes(entry.id))) refuse('ambiguous_remote_identity');
        return { entry: entry && { ...entry, path }, chain };
    }

    function assertListing(before, after) {
        if (!same(before, after)) refuse('remote_identity_changed');
    }

    async function checkPath(path) {
        const observed = await lookup(path);
        observedPaths.set(path, observed);
        return observed;
    }

    async function beforeMutation(path) {
        const before = observedPaths.get(path);
        const after = await lookup(path);
        if (before) assertListing(before, after);
        return after;
    }

    function content(command, options, operands, consume) {
        return invoke(command, backend === 'drive' ? [...options, ...driveView] : options, operands, consume);
    }

    async function readVerified(path, observed, consume) {
        if (!observed.entry) refuse('unsafe_remote_file');
        const before = await lookup(path);
        if (!before.entry || !same(before.chain, observed.chain)
            || Object.entries(observed.entry).some(([key, value]) => !same(value, before.entry[key]))) {
            refuse('remote_identity_changed');
        }
        const result = await content('cat', [], [exact(underBase(path))], consume);
        assertListing(before, await checkPath(path));
        return result;
    }

    async function read(path, observed, { output } = {}) {
        const { entry } = observed;
        if (!entry || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > MAX_FILE) refuse('unsafe_remote_file');
        const bytes = await readVerified(path, observed, (stream) => hashChunks(stream, { output, limit: entry.size }));
        if (bytes.size !== entry.size || (entry.md5 && entry.md5 !== bytes.md5)) refuse('remote_checksum_changed');
        return bytes;
    }

    return {
        target,
        async inventory(expected, { hashes = true } = {}) {
            boundRoot = expected ?? await rootChain();
            if (expected) await rootChain();
            // The recursive inventory supplies positive no-follow evidence.
            // Exact-path lookup pairs shallow views before any content access
            // or creation so a skipped entry cannot be treated as absent.
            const names = await list(base, { recursive: true, hashes });
            if (!hashes) {
                for (const entry of names.values()) delete entry.md5;
            }
            await rootChain();
            if (backend === 'drive') {
                for (const { id } of names.values()) {
                    if (boundRoot.includes(id)) refuse('ambiguous_remote_identity');
                }
            }
            return { names, root: boundRoot };
        },
        fromInventory,
        lookup: checkPath,
        read,
        ...(legacy && { readVerified }),
        async upload(path, source) {
            const observed = await beforeMutation(path);
            if (legacy && observed.entry) refuse('remote_destination_exists');
            const options = legacy ? ['--immutable', '--ignore-existing'] : ['--ignore-times'];
            await content('copyto', options, [source, exact(underBase(path))], empty);
        },
        async delete(path) {
            if (!(await beforeMutation(path)).entry) refuse('remote_identity_changed');
            await content('deletefile', [], [exact(underBase(path))], empty);
        },
    };
}
