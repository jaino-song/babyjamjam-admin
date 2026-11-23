// All calls are serialized by the backup worker's flock. The configured remote
// must be a dedicated backup tree. Fresh listings and strong byte proofs guard
// exact-file operations; rclone does not provide compare-and-swap against
// independent remote writers between a proof and its mutation.
// Local stages use private directories and exact file identities. The flock
// covers cooperating writers. These checks cannot fence concurrent same-UID
// changes between a pathname check and a filesystem mutation.
import { randomUUID } from 'node:crypto';
import { fstatSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
    atName, checkPrivate, checkPrivateState, checkRoot, directory, exclusiveFile, fdPath, identity,
    inspectFile, isPdf, keyOf, MirrorError, openChildDirectory, openDirectory, openStagePayload, readJson, refuse, rootInfo, rootPath, same, sameBytes,
    saveJson, scanLocal, segments, shaName, stat, syncDir, validBytes, validIdentity,
} from './raster-mirror-io.mjs';
import { remoteTransport, validRemoteId } from './raster-mirror-remote.mjs';

const modes = ['active', 'rolling-back', 'paused'];
const stagePrefix = '.raster-mirror-';
const renderStage = /^\.render-(?:[a-zA-Z0-9]{6}|[a-f0-9-]{36})$/;
const stageName = /^\.raster-mirror-[a-f0-9-]{36}$/;
const pdfName = (path) => {
    if (segments(path).some((part) => stageName.test(part)) || !isPdf(path)) refuse('unsafe_pdf_path');
    return path;
};
const snapshot = (file) => file ? { id: file.id, bytes: file.bytes } : null;
const localMatches = (actual, expected) => actual && expected
    ? same(actual.id, expected.id) && sameBytes(actual.bytes, expected.bytes) : actual === expected;
const remoteMatches = (actual, expected) => localMatches(actual, expected) && (!actual || same(actual.chain, expected.chain));
const chainPrefix = (old, next) => old.length <= next.length && old.every((id, index) => id === next[index]);
const validChain = (value) => Array.isArray(value) && value.every(validRemoteId);
const validLocal = (item) => item === null || (validIdentity(item?.id) && validBytes(item.bytes));
const validRemote = (item) => item === null || (item && validRemoteId(item.id) && validBytes(item.bytes)
    && validChain(item.chain) && (item.checksum === null || item.checksum === item.bytes.md5));
const relativeParent = (root, path) => dirname(join(root, path));
const validStage = (stage, pattern) => typeof stage?.directory === 'string' && pattern.test(stage.directory)
    && validIdentity(stage.parentId) && validIdentity(stage.directoryId) && validIdentity(stage.fileId);
const stageReady = (op) => op.stage && op.stage.ready !== false; // Legacy intents only saved fully copied stages.

function validateVersion(entry) {
    if (!validBytes(entry?.raw) || !(entry.raster === null || validBytes(entry.raster))
        || !validLocal(entry.local) || !validRemote(entry.remote)) refuse('invalid_manifest');
}

function readRecords(state) {
    if (state.version !== 1 || !modes.includes(state.phase) || !Array.isArray(state.records)) refuse('invalid_manifest');
    const records = new Map();
    for (const [path, entry] of state.records) {
        pdfName(path);
        if (atName(records, path) || !Array.isArray(entry?.history) || !entry.history.length) refuse('invalid_manifest');
        validateVersion(entry);
        for (const version of entry.history) validateVersion(version);
        if (entry.retired !== null) {
            pdfName(entry.retired);
            if (entry.local || entry.remote || keyOf(entry.retired) === keyOf(path)) refuse('invalid_manifest');
        }
        records.set(keyOf(path), { ...entry, path });
    }
    const op = state.intent;
    if (op !== null) {
        pdfName(op.path);
        if (!['publish', 'rollback', 'move'].includes(op.kind) || !validBytes(op.raw) || !validBytes(op.target)
            || !validLocal(op.before?.local) || !validRemote(op.before?.remote) || !validRemote(op.remoteAfter)
            || !validChain(op.remoteChain) || typeof op.remoteStarted !== 'boolean') refuse('invalid_manifest');
        if (op.stage !== null && (!validStage(op.stage, stageName)
            || (op.stage.ready !== undefined && typeof op.stage.ready !== 'boolean'))) refuse('invalid_manifest');
        if (op.stage?.ready === false && op.remoteStarted) refuse('invalid_manifest');
        if (op.discarding !== undefined && (op.discarding !== true || op.kind !== 'publish' || state.phase !== 'rolling-back')) {
            refuse('invalid_manifest');
        }
        if (op.kind === 'move') {
            const from = pdfName(op.from);
            const source = atName(records, from);
            if (!source || source.retired || keyOf(from) === keyOf(op.path) || typeof op.deletingLocal !== 'boolean'
                || typeof op.deletingRemote !== 'boolean') refuse('invalid_manifest');
        }
        if ((op.kind === 'rollback') !== (state.phase === 'rolling-back')
            && !(state.phase === 'rolling-back' && (op.kind === 'move' || op.discarding))) refuse('invalid_manifest');
    }
    const render = state.renderStage;
    if (render !== undefined && (!validStage(render, renderStage) || !validIdentity(render.homeId)
        || !validBytes(render.raw) || !['prepared', 'ready', 'cleaning'].includes(render.phase)
        || (render.phase === 'ready' ? (!validBytes(render.output) || sameBytes(render.output, render.raw))
            : render.output !== undefined))) {
        refuse('invalid_manifest');
    }
    return records;
}

function movesOf(moves = []) {
    if (!Array.isArray(moves)) refuse('invalid_moves');
    const used = new Set();
    return moves.map((move) => {
        const from = pdfName(move?.from);
        const to = pdfName(move?.to);
        for (const path of [from, to]) {
            const key = keyOf(path);
            if (used.has(key)) refuse('conflicting_moves');
            used.add(key);
        }
        return { from, to };
    });
}

function verifyNames(maps) {
    const combined = new Map();
    for (const names of maps) {
        for (const entry of names.values()) {
            const existing = combined.get(keyOf(entry.path));
            if (existing && (existing.path !== entry.path || existing.isDir !== entry.isDir)) refuse('ambiguous_path');
            combined.set(keyOf(entry.path), entry);
        }
    }
    // A deleted endpoint may no longer supply ancestor names to a listing.
    for (const { path } of combined.values()) {
        const parts = path.split('/');
        parts.pop();
        let prefix = '';
        for (const part of parts) {
            prefix = prefix ? prefix + '/' + part : part;
            const entry = atName(combined, prefix);
            if (entry && !entry.isDir) refuse('unsafe_directory');
        }
    }
    return combined;
}

async function openArchive(settings, options) {
    const { archiveDir, stateDir, originalArchiveDir = archiveDir + '.originals' } = settings;
    const roots = [archiveDir, originalArchiveDir, stateDir].map(rootPath);
    const normalized = roots.map(keyOf);
    if (normalized.some((path, index) => normalized.some((other, second) => index !== second
        && (path === other || path.startsWith(other + '/'))))) refuse('overlapping_roots');
    const lockFd = options.lockFd;
    if (lockFd !== undefined) {
        if (!Number.isInteger(lockFd) || lockFd < 0 || lockFd > 2 ** 31 - 1) refuse('unsafe_lock_fd');
        try { fstatSync(lockFd); } catch { refuse('unsafe_lock_fd'); }
    }

    const info = await Promise.all(roots.map(rootInfo));
    const rootIds = info.map(({ id }) => id);
    if (info.some(({ id }, index) => id && info.some((other, second) => index !== second
        && (same(id, other.id) || other.ancestors.some((parent) => same(id, parent)))))) refuse('overlapping_roots');
    // Legacy workers may have created the state root under the default umask.
    // The mirror data always lives in its own worker-only directory.
    if (rootIds[2]) checkPrivate(await stat(stateDir), 0o700, false);
    const home = join(stateDir, 'raster-mirror');
    await directory(home, { privateFrom: home });
    const manifest = join(home, 'manifest.json');
    const rasterDir = join(home, 'rendered');
    const remote = remoteTransport(settings, lockFd);
    const target = remote?.target ?? null;
    await checkPrivateState(home, (path) => path === rasterDir);
    const state = await readJson(manifest);
    if (state && (!same(state.binding?.roots, roots) || !same(state.binding.rootIds, rootIds)
        || state.binding.target !== target || (remote ? !validChain(state.binding.remoteRoot) : state.binding.remoteRoot !== null))) {
        refuse('binding_changed');
    }
    // Read the pause receipt before launching any child for a scheduled publish.
    if (options.action === 'publish' && !options.dryRun && state?.phase !== undefined && state.phase !== 'active'
        && (state.phase !== 'paused' || options.explicitRepublish !== true)) refuse('publication_paused');
    const records = state ? readRecords(state) : new Map();
    const inventories = await Promise.allSettled([
        // Scratch is never part of the PDF corpus. Only journalled allocations
        // may be opened or reclaimed, even when the stage name looks familiar.
        scanLocal(archiveDir, { skipName: (name) => stageName.test(name) }),
        scanLocal(originalArchiveDir, { privateTree: true }),
        remote ? remote.inventory(state?.binding.remoteRoot) : null,
    ]);
    for (const result of inventories) if (result.status === 'rejected') throw result.reason;
    const [visible, originals, remoteInventory] = inventories.map(({ value }) => value);
    const recordNames = new Map([...records].map(([key, { path }]) => [key, { path, isDir: false }]));
    const publicNames = verifyNames([visible, remoteInventory?.names ?? new Map()]);
    const names = verifyNames([publicNames, originals, recordNames]);
    const report = {
        dryRun: Boolean(options.dryRun),
        localPdfs: [...visible.values()].filter((entry) => isPdf(entry.path)).length,
        remotePdfs: [...(remoteInventory?.names.values() ?? [])].filter((entry) => isPdf(entry.path)).length,
        originalPdfs: [...originals.values()].filter((entry) => isPdf(entry.path)).length,
        captured: 0, wouldRender: 0, wouldMove: 0, wouldRestore: 0, rendered: 0, unchanged: 0, moved: 0,
        localPublished: 0, remotePublished: 0, localRemoved: 0, remoteRemoved: 0,
        localRestored: 0, remoteRestored: 0,
    };
    const ctx = {
        archiveDir, originalArchiveDir, stateDir, home, manifest, remote, visible, originals, names, records,
        remoteNames: remoteInventory?.names, dryRun: Boolean(options.dryRun), lockFd, report,
        gsBin: options.gsBin ?? settings.gsBin, qpdfBin: options.qpdfBin ?? settings.qpdfBin,
        rawDir: join(home, 'original-blobs'), rasterDir,
        state: state ?? {
            version: 1, binding: { roots, rootIds, target, remoteRoot: remoteInventory?.root ?? null },
            phase: 'active', records: [], intent: null,
        },
        existed: Boolean(state),
    };
    const caches = await readCache(ctx);
    for (const record of records.values()) {
        for (const { raw, raster } of record.history) {
            const output = caches.cache.get(raw.sha256) ?? caches.stagedRenders.get(raw.sha256)?.bytes;
            if (raster && output && !same(raster, output)) refuse('protected_render_changed');
        }
    }
    return { ...ctx, ...caches };
}

async function save(ctx) {
    ctx.state.records = [...ctx.records].map(([, { path, ...entry }]) => [path, entry]);
    await saveJson(ctx.manifest, ctx.state);
}

async function initialize(ctx) {
    await directory(ctx.archiveDir, { create: true });
    for (const root of [ctx.originalArchiveDir, ctx.stateDir, ctx.home, ctx.rawDir, ctx.rasterDir]) {
        await directory(root, { create: true, privateFrom: root, tighten: root === ctx.stateDir || root === ctx.originalArchiveDir });
    }
    const rootIds = await Promise.all(ctx.state.binding.roots.map(checkRoot));
    if (ctx.existed && !same(rootIds, ctx.state.binding.rootIds)) refuse('binding_changed');
    ctx.state.binding.rootIds = rootIds;
}

async function readCache(ctx) {
    const cache = new Map();
    const stagedRenders = new Map();
    const available = await directory(ctx.rasterDir, { privateFrom: ctx.home });
    const owned = ctx.state.renderStage;
    if (owned) {
        await withRenderStage(ctx, owned, async ({ committed }) => {
            if (owned.phase === 'ready' && !committed) {
                stagedRenders.set(owned.raw.sha256, { bytes: owned.output });
            }
        });
    }
    if (!available) return { cache, stagedRenders };
    for (const name of await fs.readdir(ctx.rasterDir)) {
        if (name === owned?.directory) continue;
        const path = join(ctx.rasterDir, name);
        const pending = renderStage.test(name);
        if (!pending && !shaName(name)) refuse('invalid_cache');
        await directory(path, { privateFrom: ctx.home });
        const members = (await fs.readdir(path)).sort();
        const output = join(path, 'output.pdf');
        const outputInfo = await stat(output);
        if (pending && !members.includes('receipt.json')) {
            // A crash before recording ownership can leave an empty allocation.
            // Leave it alone. Unknown payloads (including legacy scratch) stop recovery.
            if (members.length && (!same(members, ['output.pdf']) || !outputInfo?.isFile()
                || outputInfo.nlink !== 1n || outputInfo.size !== 0n)) refuse('unowned_render_stage');
            if (outputInfo) checkPrivate(outputInfo, 0o600);
            continue;
        }
        if (!same(members, ['output.pdf', 'receipt.json']) || !outputInfo?.isFile() || outputInfo.nlink !== 1n) {
            refuse('invalid_cache');
        }
        checkPrivate(outputInfo, 0o600);
        const receipt = await readJson(join(path, 'receipt.json'));
        if (!shaName(receipt?.raw) || (!pending && receipt.raw !== name)
            || !validBytes(receipt.output) || receipt.raw === receipt.output.sha256) refuse('invalid_cache');
        if (pending) {
            const raw = await inspectFile(join(ctx.rawDir, receipt.raw + '.pdf'), { privateFile: true });
            if (!raw || raw.bytes.sha256 !== receipt.raw) refuse('protected_bytes_changed');
            const rendered = await inspectFile(output, { privateFile: true });
            if (!rendered || !same(rendered.bytes, receipt.output)) refuse('protected_bytes_changed');
            if (stagedRenders.has(receipt.raw)) refuse('ambiguous_cache');
            stagedRenders.set(receipt.raw, {
                bytes: receipt.output, directory: name, parentId: await checkRoot(ctx.rasterDir),
                directoryId: await checkRoot(path), fileId: rendered.id,
            });
        } else {
            cache.set(receipt.raw, receipt.output);
        }
    }
    for (const [raw, { bytes }] of stagedRenders) {
        if (cache.has(raw) && !same(cache.get(raw), bytes)) refuse('ambiguous_cache');
    }
    return { cache, stagedRenders };
}

const blobPath = (ctx, bytes) => join(ctx.rawDir, bytes.sha256 + '.pdf');
const renderPath = (ctx, raw) => join(ctx.rasterDir, raw.sha256, 'output.pdf');

async function verifyPrivate(ctx, path, expected) {
    if (!await directory(dirname(path), { privateFrom: ctx.home })) refuse('protected_bytes_missing');
    const file = await inspectFile(path, { privateFile: true });
    if (!file || !same(file.bytes, expected)) refuse('protected_bytes_changed');
    return path;
}

async function protectedRaw(ctx, bytes, source, { required = false } = {}) {
    const path = blobPath(ctx, bytes);
    if (await stat(path)) return verifyPrivate(ctx, path, bytes);
    if (required || !source) refuse('protected_bytes_missing');
    const staged = await exclusiveFile(ctx.rawDir, '.capture-', source);
    try {
        if (!same(staged.value, bytes) || await stat(path)) refuse('protected_bytes_changed');
        await fs.rename(staged.path, path);
        await syncDir(ctx.rawDir);
        return path;
    } finally {
        await unlinkIfPresent(staged.path);
    }
}

async function unlinkIfPresent(path) {
    await fs.unlink(path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

async function allocateStage(parent, directory, filename) {
    await fs.mkdir(join(fdPath(parent), directory), { mode: 0o700 });
    const dir = await openChildDirectory(parent, directory);
    let handle;
    try {
        const directoryInfo = await dir.stat({ bigint: true });
        checkPrivate(directoryInfo, 0o700);
        handle = await fs.open(join(fdPath(dir), filename), 'wx+', 0o600);
        const file = await handle.stat({ bigint: true });
        checkPrivate(file, 0o600);
        await handle.sync();
        await dir.sync();
        await parent.sync();
        return {
            handle,
            stage: {
                directory, directoryId: identity(directoryInfo),
                parentId: identity(await parent.stat({ bigint: true })), fileId: identity(file),
            },
        };
    } catch (error) {
        await handle?.close();
        throw error;
    } finally {
        await dir.close();
    }
}

async function checkStageDirectory(parent, stage, name = stage.directory) {
    if (!same(identity(await parent.stat({ bigint: true })), stage.parentId)) refuse('directory_changed');
    const entry = await stat(join(fdPath(parent), name));
    if (!entry) return null;
    if (!entry.isDirectory() || !same(identity(entry), stage.directoryId)) refuse('staging_identity_changed');
    checkPrivate(entry, 0o700);
    const dir = await openChildDirectory(parent, name);
    try {
        const opened = await dir.stat({ bigint: true });
        if (!same(identity(opened), stage.directoryId)) refuse('staging_identity_changed');
        checkPrivate(opened, 0o700);
        return dir;
    } catch (error) {
        await dir.close();
        throw error;
    }
}

async function checkStageMembers(dir, allowed) {
    const members = await fs.readdir(fdPath(dir));
    if (members.some((name) => !allowed.includes(name))) refuse('staging_identity_changed');
}

async function checkStagePayload(dir, filename, stage, handle) {
    const info = await stat(join(fdPath(dir), filename));
    if (!info && !handle) return null;
    if (!info?.isFile() || info.nlink !== 1n || !same(identity(info), stage.fileId)) refuse('staging_identity_changed');
    checkPrivate(info, 0o600);
    if (handle) {
        const opened = handle.fd < 0 ? null : await handle.stat({ bigint: true });
        if (!opened || opened.nlink !== 1n || !same(identity(opened), stage.fileId)) refuse('staging_identity_changed');
        checkPrivate(opened, 0o600);
    }
    return info;
}

async function removeOwnedStage(parent, dir, stage, filename) {
    if (dir) {
        const path = join(fdPath(parent), stage.directory);
        async function verifyDirectory() {
            const current = await stat(path);
            if (!current?.isDirectory() || !same(identity(current), stage.directoryId)) refuse('staging_identity_changed');
        }
        await verifyDirectory();
        await checkStageMembers(dir, [filename]);
        if (await checkStagePayload(dir, filename, stage)) await fs.unlink(join(fdPath(dir), filename));
        await dir.sync();
        await verifyDirectory();
        await fs.rmdir(path);
    }
    await parent.sync();
}

async function withRenderStage(ctx, stage, action) {
    if (!same(await checkRoot(ctx.home), stage.homeId) || !same(await checkRoot(ctx.rasterDir), stage.parentId)) {
        refuse('binding_changed');
    }
    const parent = await openDirectory(ctx.rasterDir);
    let dir;
    try {
        checkPrivate(await parent.stat({ bigint: true }), 0o700);
        dir = await checkStageDirectory(parent, stage);
        const finalName = stage.raw.sha256;
        const final = join(fdPath(parent), finalName);
        const committed = Boolean(await stat(final));
        if (committed) {
            if (dir || stage.phase !== 'ready') refuse('staging_identity_changed');
            dir = await checkStageDirectory(parent, stage, finalName);
        }
        if (!dir) {
            if (stage.phase !== 'cleaning') refuse('staging_missing');
            return await action({ parent });
        }
        const prepared = stage.phase !== 'ready';
        await checkStageMembers(dir, prepared ? ['output.pdf'] : ['output.pdf', 'receipt.json']);
        const payload = await checkStagePayload(dir, 'output.pdf', stage);
        if (!payload && stage.phase !== 'cleaning') refuse('staging_missing');
        const receipt = prepared ? null : await readJson(join(fdPath(dir), 'receipt.json'));
        if (!prepared) {
            if ((committed && !receipt) || (receipt && !same(receipt, { raw: finalName, output: stage.output }))) {
                refuse('invalid_cache');
            }
            const rendered = await inspectFile(join(fdPath(dir), 'output.pdf'), { privateFile: true });
            if (!same(rendered?.id, stage.fileId) || !same(rendered?.bytes, stage.output)) refuse('protected_bytes_changed');
        }
        return await action({ parent, dir, receipt, committed });
    } finally {
        await dir?.close();
        await parent.close();
    }
}

async function settleRender(ctx) {
    const stage = ctx.state.renderStage;
    if (!stage) return;
    await withRenderStage(ctx, stage, async ({ parent, dir, receipt, committed }) => {
        if (stage.phase === 'ready') {
            await protectedRaw(ctx, stage.raw, null, { required: true });
            if (!committed) {
                const temp = join(ctx.rasterDir, stage.directory);
                if (!same(await checkRoot(temp), stage.directoryId)) refuse('staging_identity_changed');
                if (!receipt) {
                    await saveJson(join(temp, 'receipt.json'), { raw: stage.raw.sha256, output: stage.output }, {
                        scratch: ctx.home, parentHandle: dir,
                    });
                }
                if (await stat(join(fdPath(parent), stage.raw.sha256))
                    || !same(await checkRoot(temp), stage.directoryId)) refuse('staging_identity_changed');
                await checkStageMembers(dir, ['output.pdf', 'receipt.json']);
                await checkStagePayload(dir, 'output.pdf', stage);
                await fs.rename(join(fdPath(parent), stage.directory), join(fdPath(parent), stage.raw.sha256));
            }
            await parent.sync();
            ctx.stagedRenders.delete(stage.raw.sha256);
            ctx.cache.set(stage.raw.sha256, stage.output);
        } else {
            if (stage.phase !== 'cleaning') {
                // Only a durable cleanup transition permits a missing owned
                // payload or directory on the next invocation.
                stage.phase = 'cleaning';
                await save(ctx);
            }
            await removeOwnedStage(parent, dir, stage, 'output.pdf');
        }
    });
    delete ctx.state.renderStage;
    await save(ctx);
}

async function promoteLegacyRender(ctx, raw, stage) {
    await protectedRaw(ctx, raw, null, { required: true });
    const parent = await openDirectory(ctx.rasterDir);
    let dir;
    try {
        dir = await checkStageDirectory(parent, stage);
        if (!dir) refuse('staging_missing');
        await checkStageMembers(dir, ['output.pdf', 'receipt.json']);
        await checkStagePayload(dir, 'output.pdf', stage);
        const receipt = await readJson(join(fdPath(dir), 'receipt.json'));
        const file = await inspectFile(join(fdPath(dir), 'output.pdf'), { privateFile: true });
        if (receipt?.raw !== raw.sha256 || !same(receipt.output, stage.bytes)
            || !same(file?.bytes, stage.bytes) || !same(file?.id, stage.fileId)) refuse('protected_bytes_changed');
        const committed = join(fdPath(parent), raw.sha256);
        if (await stat(committed)) refuse('cache_collision');
        const temp = join(fdPath(parent), stage.directory);
        const current = await stat(temp);
        if (!current?.isDirectory() || !same(identity(current), stage.directoryId)) refuse('staging_identity_changed');
        await fs.rename(temp, committed);
        await parent.sync();
    } finally {
        await dir?.close();
        await parent.close();
    }
    ctx.stagedRenders.delete(raw.sha256);
    ctx.cache.set(raw.sha256, stage.bytes);
    return stage.bytes;
}

async function ensureRender(ctx, raw, override) {
    const cached = ctx.cache.get(raw.sha256);
    if (cached) {
        await verifyPrivate(ctx, renderPath(ctx, raw), cached);
        return cached;
    }
    const recovered = ctx.stagedRenders.get(raw.sha256);
    if (recovered) return promoteLegacyRender(ctx, raw, recovered);
    for (const record of ctx.records.values()) {
        if (record.history.some((entry) => sameBytes(entry.raw, raw) && entry.raster)) refuse('protected_render_missing');
    }
    const renderer = override ?? (await import('./raster-render.mjs')).renderRasterPdf;
    if (typeof renderer !== 'function') refuse('renderer_unavailable');
    const sourcePath = await protectedRaw(ctx, raw, null, { required: true });
    const homeId = await checkRoot(ctx.home);
    const parent = await openDirectory(ctx.rasterDir);
    let allocation;
    try {
        allocation = await allocateStage(parent, '.render-' + randomUUID(), 'output.pdf');
    } finally {
        await parent.close();
    }
    const { stage, handle: outputHandle } = allocation;
    try {
        Object.assign(stage, { homeId, raw, phase: 'prepared' });
        ctx.state.renderStage = stage;
        // A writer never sees the descriptor until both its inode and the
        // bound stage directory are durably recorded.
        await save(ctx);
        const outputPath = join(ctx.rasterDir, stage.directory, 'output.pdf');
        await withRenderStage(ctx, stage, async ({ dir }) => {
            const empty = await checkStagePayload(dir, 'output.pdf', stage, outputHandle);
            if (empty.size !== 0n) refuse('staging_identity_changed');
        });
        let rendererFailed = false;
        try {
            await renderer({ sourcePath, outputPath, outputHandle, lockFd: ctx.lockFd, gsBin: ctx.gsBin, qpdfBin: ctx.qpdfBin });
        } catch {
            rendererFailed = true;
        }
        const output = await withRenderStage(ctx, stage, async ({ dir }) => {
            const info = await checkStagePayload(dir, 'output.pdf', stage, outputHandle);
            if (rendererFailed || !info.size) return null;
            await outputHandle.sync();
            const file = await inspectFile(join(fdPath(dir), 'output.pdf'), { privateFile: true });
            if (!same(file?.id, stage.fileId)) refuse('staging_identity_changed');
            return file.bytes;
        });
        if (!output || sameBytes(output, raw)) {
            await settleRender(ctx);
            refuse(rendererFailed ? 'renderer_failed' : 'invalid_render');
        }
        await protectedRaw(ctx, raw, null, { required: true });
        stage.phase = 'ready';
        stage.output = output;
        await save(ctx);
        await settleRender(ctx);
        ctx.report.rendered++;
        return output;
    } finally {
        await outputHandle.close();
    }
}

function derivativeHashes(ctx) {
    const hashes = new Set([...ctx.cache.values()].map(({ sha256 }) => sha256));
    for (const { bytes } of ctx.stagedRenders.values()) hashes.add(bytes.sha256);
    for (const record of ctx.records.values()) {
        for (const { raster } of record.history) if (raster) hashes.add(raster.sha256);
    }
    const op = ctx.state.intent;
    if (op && op.kind !== 'rollback') hashes.add(op.target.sha256);
    return hashes;
}

function remoteAt(ctx, path) {
    return ctx.remote?.fromInventory(ctx.remoteNames, path) ?? { entry: null, chain: [] };
}

async function observedRemote(ctx, path, observed, candidates = [], strong = false) {
    if (!observed.entry) return null;
    const { entry, chain } = observed;
    const verified = candidates.find((item) => item && item.id === entry.id && same(item.chain, chain)
        && entry.md5 === item.bytes.md5 && entry.size === item.bytes.size);
    const bytes = !strong && verified ? verified.bytes : await ctx.remote.read(path, observed);
    return { bytes, id: entry.id, chain, checksum: entry.md5 };
}

function localAllowed(actual, op) {
    const staged = stageReady(op) && actual && same(actual.id, op.stage.fileId) && sameBytes(actual.bytes, op.target);
    if (op.remoteStarted && !sameBytes(op.before.local?.bytes, op.target)) return staged;
    return staged || localMatches(actual, op.before.local);
}

function remoteAllowed(actual, op) {
    if (op.remoteAfter) return remoteMatches(actual, op.remoteAfter);
    if (remoteMatches(actual, op.before.remote)) return true;
    if (!op.remoteStarted || !actual || !sameBytes(actual.bytes, op.target)) return false;
    if (op.before.remote) return actual.id === op.before.remote.id && same(actual.chain, op.before.remote.chain);
    // Creation has no Drive ID before the first copy. Recover the first ID
    // only from a durable create intent, a unique chain and a strong byte proof.
    return chainPrefix(op.remoteChain, actual.chain);
}

async function guardRecord(ctx, entry, { strong = false } = {}) {
    const { path } = entry;
    const intent = ctx.state.intent;
    const destination = intent?.path === path;
    const source = intent?.kind === 'move' && intent.from === path;
    const local = snapshot(atName(ctx.visible, path));
    const remote = await observedRemote(ctx, path, remoteAt(ctx, path), [entry.remote, intent?.remoteAfter], strong);
    const localOk = destination ? localAllowed(local, intent)
        : localMatches(local, entry.local) || (source && intent.deletingLocal && !local);
    const remoteOk = destination ? remoteAllowed(remote, intent)
        : remoteMatches(remote, entry.remote) || (source && intent.deletingRemote && !remote);
    if (!localOk || !remoteOk) refuse('public_version_conflict');
    return { local, remote };
}

async function guardRecords(ctx, options) {
    const op = ctx.state.intent;
    for (const entry of ctx.records.values()) await guardRecord(ctx, entry, options);
    if (op && !atName(ctx.records, op.path)) {
        await guardRecord(ctx, { path: op.path, local: null, remote: null }, options);
    }
    if (op?.stage) {
        const local = snapshot(atName(ctx.visible, op.path));
        const transferred = stageReady(op) && same(local?.id, op.stage.fileId) && sameBytes(local?.bytes, op.target);
        await withLocalStage(ctx, op, async ({ payload }) => {
            if ((!payload && !transferred && !op.discarding) || (payload && transferred)) refuse('staging_identity_changed');
        });
    }
}

async function planCapture(ctx, moves, { privateOnly = false } = {}) {
    const plan = [];
    const held = new Set([...moves.flatMap(({ from, to }) => [from, to]), ctx.state.intent?.path, ctx.state.intent?.from].map((path) => path && keyOf(path)));
    const derivatives = derivativeHashes(ctx);
    const missing = new Set([...ctx.records.values()].filter(({ path, retired }) => !retired
        && !atName(ctx.originals, path)).map(({ raw }) => raw.sha256));
    for (const { path } of ctx.names.values()) {
        if (!isPdf(path) || atName(ctx.records, path) || held.has(keyOf(path))) continue;
        pdfName(path);
        const local = atName(ctx.visible, path);
        const original = atName(ctx.originals, path);
        const observed = remoteAt(ctx, path);
        if (!local && !observed.entry && (!original || (ctx.existed && !privateOnly))) continue;
        const remote = await observedRemote(ctx, path, observed);
        const bytes = original?.bytes ?? local?.bytes ?? remote.bytes;
        if (derivatives.has(bytes.sha256)) refuse('derivative_as_original');
        if (missing.has(bytes.sha256)) refuse('move_intent_missing');
        if ((local && !sameBytes(bytes, local.bytes)) || (remote && !sameBytes(bytes, remote.bytes))) refuse('original_authority_conflict');
        plan.push({ path, raw: bytes, original, local, remote, observed });
    }
    return plan;
}

async function capture(ctx, item) {
    const { path, raw, original, local, remote, observed } = item;
    const sourceRoot = original ? ctx.originalArchiveDir : local ? ctx.archiveDir : null;
    const blob = await protectedRaw(ctx, raw, async (output) => {
        if (!sourceRoot) return ctx.remote.read(path, observed, { output });
        const parent = await openDirectory(relativeParent(sourceRoot, path));
        try {
            const read = await inspectFile(join(fdPath(parent), basename(path)), {
                output, privateFile: Boolean(original), allowLoose: true, covered: Boolean(original),
            });
            if (!read || !same(read.id, (original ?? local).id)) refuse('original_changed');
            return read.bytes;
        } finally { await parent.close(); }
    });
    const rawPath = join(ctx.originalArchiveDir, path);
    const parent = relativeParent(ctx.originalArchiveDir, path);
    await directory(parent, { create: true, privateFrom: ctx.originalArchiveDir, tighten: true });
    if (!original) {
        const staged = await exclusiveFile(parent, '.original-', async (output) => {
            const read = await inspectFile(blob, { output, privateFile: true });
            const time = local?.mtime ?? observed.entry?.mtime;
            if (time !== undefined && time !== null) await output.utimes(time, time);
            return read?.bytes;
        });
        try {
            if (!same(staged.value, raw) || await stat(rawPath)) refuse('original_collision');
            await fs.rename(staged.path, rawPath);
            await syncDir(parent);
        } finally {
            await unlinkIfPresent(staged.path);
        }
    }
    const privateFile = await inspectFile(rawPath, { privateFile: true, tighten: true, covered: true, sync: true });
    if (!privateFile || !same(privateFile.bytes, raw) || (original && !same(privateFile.id, original.id))) refuse('original_changed');
    const version = { raw, raster: null, local: snapshot(local ?? null), remote };
    ctx.records.set(keyOf(path), { path, ...version, retired: null, history: [version] });
    ctx.originals.set(keyOf(path), { path, isDir: false, ...privateFile });
}

async function currentRaw(ctx, path, expected) {
    const file = atName(ctx.originals, path);
    if (!file || !sameBytes(file.bytes, expected)) refuse('original_changed');
    await directory(relativeParent(ctx.originalArchiveDir, path), { privateFrom: ctx.originalArchiveDir, tighten: true });
    const read = await inspectFile(join(ctx.originalArchiveDir, path), { privateFile: true, tighten: true, covered: true, sync: true });
    if (!read || !same(read.id, file.id) || !same(read.bytes, expected)) refuse('original_changed');
    return read;
}

function planMove(ctx, { from, to }) {
    const source = atName(ctx.records, from);
    const dest = atName(ctx.records, to);
    const raw = atName(ctx.originals, to)?.bytes;
    if (!source || !raw || atName(ctx.originals, from) || !sameBytes(source.raw, raw)) refuse('move_original_conflict');
    if (source.retired) {
        if (source.retired !== to || !dest || dest.retired || !sameBytes(dest.raw, raw)
            || !dest.raster || !dest.local || (ctx.remote && !dest.remote)) refuse('move_collision');
        return { from, to, raw, replay: true };
    }
    if ((dest && dest.retired !== from) || atName(ctx.visible, to) || remoteAt(ctx, to).entry) refuse('move_collision');
    return { from, to, raw, replay: false };
}

function planPublish(ctx, moves, captures) {
    const pending = ctx.state.intent;
    const movement = pending?.kind === 'move' ? { from: pending.from, to: pending.path } : null;
    const held = new Set(moves.flatMap(({ from, to }) => [from, to]));
    if (movement) {
        held.add(movement.from);
        held.add(movement.to);
    }
    const movePlan = [];
    for (const move of moves) {
        if (movement && same(move, movement)) continue;
        if (movement && [move.from, move.to].some((path) => [movement.from, movement.to].some((name) => keyOf(name) === keyOf(path)))) {
            refuse('conflicting_moves');
        }
        movePlan.push(planMove(ctx, move));
    }
    const derivatives = derivativeHashes(ctx);
    const additions = new Map(captures.map(({ path, raw }) => [path, raw]));
    const work = [];
    for (const path of new Set([...ctx.records.values()].map(({ path }) => path).concat([...additions.keys()]))) {
        if (held.has(path)) continue;
        const record = atName(ctx.records, path);
        const raw = atName(ctx.originals, path)?.bytes ?? additions.get(path);
        if (!raw) continue;
        if (record?.retired) refuse('retired_original_path');
        if (derivatives.has(raw.sha256)) refuse('derivative_as_original');
        const isPending = pending?.kind === 'publish' && pending.path === path;
        if (isPending && sameBytes(pending.raw, raw)) continue;
        const current = !isPending && record?.raster && sameBytes(raw, record.raw)
            && sameBytes(record.local?.bytes, record.raster)
            && (!ctx.remote || sameBytes(record.remote?.bytes, record.raster));
        if (current) ctx.report.unchanged++;
        else work.push({ path, raw });
    }
    return { work, movePlan };
}

function newIntent(ctx, kind, path, raw, target, from) {
    const record = atName(ctx.records, path);
    return {
        kind, path, raw, target,
        before: { local: record?.local ?? null, remote: record?.remote ?? null },
        remoteChain: remoteAt(ctx, path).chain,
        remoteStarted: false, remoteAfter: null, stage: null,
        ...(from && { from, deletingLocal: false, deletingRemote: false }),
    };
}

function updateRemoteInventory(ctx, path, remote) {
    if (!ctx.remote) return;
    if (!remote) {
        ctx.remoteNames.delete(keyOf(path));
        return;
    }
    const parts = path.split('/');
    const leaf = parts.pop();
    let parent = '';
    for (const [index, part] of parts.entries()) {
        parent = parent ? parent + '/' + part : part;
        if (!atName(ctx.remoteNames, parent)) ctx.remoteNames.set(keyOf(parent), { path: parent, isDir: true, id: remote.chain[index] });
    }
    const name = parent ? parent + '/' + leaf : leaf;
    ctx.remoteNames.set(keyOf(name), { path: name, isDir: false, id: remote.id, size: remote.bytes.size, md5: remote.checksum });
}

async function guardPublicRoot(ctx) {
    if (!same(await checkRoot(ctx.archiveDir), ctx.state.binding.rootIds[0])) refuse('binding_changed');
}

async function withLocalStage(ctx, op, action) {
    await guardPublicRoot(ctx);
    const path = relativeParent(ctx.archiveDir, op.path);
    const parent = await openDirectory(path);
    let dir;
    try {
        dir = await checkStageDirectory(parent, op.stage);
        if (dir) await checkStageMembers(dir, ['payload.tmp']);
        const payload = dir && await checkStagePayload(dir, 'payload.tmp', op.stage);
        return await action({ parent, dir, payload });
    } finally {
        await dir?.close();
        await parent.close();
    }
}

async function prepareLocalStage(ctx, op, parent) {
    const { stage, handle } = await allocateStage(parent, stagePrefix + randomUUID(), 'payload.tmp');
    await handle.close();
    op.stage = { ...stage, ready: false };
    await save(ctx);
}

async function copyLocalStage(ctx, op, dir, path, source) {
    const handle = await openStagePayload(path);
    try {
        await checkStagePayload(dir, 'payload.tmp', op.stage, handle);
        // An interrupted copy may contain any prefix of the protected source.
        // Only this inode is ours to reset, and it cannot be published yet.
        await handle.truncate(0);
        const file = await inspectFile(source, { output: handle, privateFile: true });
        if (!same(file?.bytes, op.target)) refuse('protected_bytes_changed');
        await handle.sync();
        await checkStagePayload(dir, 'payload.tmp', op.stage, handle);
        await verifyLocalStage(op, path);
        op.stage.ready = true;
        await save(ctx);
    } finally {
        await handle.close();
    }
}

async function verifyLocalStage(op, path) {
    const staged = await inspectFile(path, { privateFile: true });
    if (!same(staged?.id, op.stage.fileId) || !same(staged?.bytes, op.target)) refuse('staging_identity_changed');
}

async function cleanStage(ctx, op) {
    if (!op.stage) return;
    await withLocalStage(ctx, op, ({ parent, dir }) => removeOwnedStage(parent, dir, op.stage, 'payload.tmp'));
}

async function replaceLocal(ctx, op, source) {
    await guardPublicRoot(ctx);
    const path = join(ctx.archiveDir, op.path);
    await directory(dirname(path), { create: true });
    const parent = await openDirectory(dirname(path));
    let dir;
    try {
        const endpoint = join(fdPath(parent), basename(path));
        const present = snapshot(await inspectFile(endpoint));
        if (!localAllowed(present, op)) refuse('public_version_conflict');
        if (sameBytes(present?.bytes, op.target)) return present;
        if (!op.stage) await prepareLocalStage(ctx, op, parent);
        dir = await checkStageDirectory(parent, op.stage);
        if (!dir) refuse('staging_missing');
        await checkStageMembers(dir, ['payload.tmp']);
        if (!await checkStagePayload(dir, 'payload.tmp', op.stage)) refuse('staging_missing');
        const payload = join(fdPath(dir), 'payload.tmp');
        if (!stageReady(op)) await copyLocalStage(ctx, op, dir, payload, source);
        else await verifyLocalStage(op, payload);
        if (!localMatches(snapshot(await inspectFile(endpoint)), present)) refuse('public_version_conflict');
        await guardPublicRoot(ctx);
        const stagePath = join(fdPath(parent), op.stage.directory);
        const current = await stat(stagePath);
        if (!same(await checkRoot(dirname(path)), op.stage.parentId)) refuse('directory_changed');
        if (!current?.isDirectory() || !same(identity(current), op.stage.directoryId)
            || !await checkStagePayload(dir, 'payload.tmp', op.stage)) refuse('staging_identity_changed');
        await fs.rename(payload, endpoint);
        await parent.sync();
        await dir.sync();
        const published = snapshot(await inspectFile(endpoint));
        if (!published || !same(published.id, op.stage.fileId) || !same(published.bytes, op.target)) refuse('local_verification_failed');
        ctx.report[op.kind === 'rollback' ? 'localRestored' : 'localPublished']++;
        return published;
    } finally {
        await dir?.close();
        await parent.close();
    }
}

async function guardRemoteIntent(ctx, op, verified, strong = false) {
    const listed = await ctx.remote.lookup(op.path);
    const actual = await observedRemote(ctx, op.path, listed, [op.before.remote, op.remoteAfter, verified], strong);
    if (!remoteAllowed(actual, op)) refuse('public_version_conflict');
    if (!actual && !same(listed.chain, op.remoteChain)
        && !(op.remoteStarted && !op.before.remote && chainPrefix(op.remoteChain, listed.chain))) {
        refuse('remote_directory_changed');
    }
    return { actual, listed };
}

async function replaceRemote(ctx, op, source, verified) {
    const { actual, listed } = await guardRemoteIntent(ctx, op, verified);
    if (sameBytes(actual?.bytes, op.target)) return actual;
    if (!op.remoteStarted || !same(op.remoteChain, listed.chain)) {
        op.remoteStarted = true;
        op.remoteChain = listed.chain;
        await save(ctx);
    }
    await verifyPrivate(ctx, source, op.target);
    await ctx.remote.upload(op.path, source);
    const after = await ctx.remote.lookup(op.path);
    if (!after.entry || (actual && (after.entry.id !== actual.id || !same(after.chain, listed.chain)))
        || !chainPrefix(listed.chain, after.chain)) refuse('remote_identity_changed');
    const result = await observedRemote(ctx, op.path, after, [], true);
    if (!same(result.bytes, op.target)) refuse('remote_verification_failed');
    ctx.report[op.kind === 'rollback' ? 'remoteRestored' : 'remotePublished']++;
    return result;
}

async function readVisible(ctx, path) {
    await guardPublicRoot(ctx);
    const parent = relativeParent(ctx.archiveDir, path);
    if (!await checkRoot(parent)) return null;
    const handle = await openDirectory(parent);
    try {
        return snapshot(await inspectFile(join(fdPath(handle), basename(path))));
    } finally { await handle.close(); }
}

async function guardMoveSource(ctx, op) {
    const entry = atName(ctx.records, op.from);
    const local = await readVisible(ctx, op.from);
    const observed = ctx.remote ? await ctx.remote.lookup(op.from) : { entry: null, chain: [] };
    const remote = await observedRemote(ctx, op.from, observed, [], true);
    if ((!localMatches(local, entry.local) && !(op.deletingLocal && !local))
        || (!remoteMatches(remote, entry.remote) && !(op.deletingRemote && !remote))) refuse('move_source_conflict');
    return { local, remote };
}

async function proveMoveDestination(ctx, op, local, remote) {
    await currentRaw(ctx, op.path, op.raw);
    await protectedRaw(ctx, op.raw, null, { required: true });
    const actual = await readVisible(ctx, op.path);
    if (!localMatches(actual, local) || !sameBytes(actual?.bytes, op.target)) refuse('move_destination_conflict');
    if (ctx.remote) {
        const listed = await ctx.remote.lookup(op.path);
        const actualRemote = await observedRemote(ctx, op.path, listed, [], true);
        if (!remoteMatches(actualRemote, remote) || !sameBytes(actualRemote?.bytes, op.target)) refuse('move_destination_conflict');
    }
}

async function removeMoveSource(ctx, op, destLocal, destRemote) {
    const source = await guardMoveSource(ctx, op);
    if (source.local) {
        await proveMoveDestination(ctx, op, destLocal, destRemote);
        op.deletingLocal = true;
        await save(ctx);
        await guardPublicRoot(ctx);
        const parent = await openDirectory(relativeParent(ctx.archiveDir, op.from));
        try {
            const path = join(fdPath(parent), basename(op.from));
            if (!localMatches(snapshot(await inspectFile(path)), source.local)
                || !same(await checkRoot(relativeParent(ctx.archiveDir, op.from)), identity(await parent.stat({ bigint: true })))) {
                refuse('move_source_conflict');
            }
            await fs.unlink(path);
            await parent.sync();
            ctx.report.localRemoved++;
        } finally { await parent.close(); }
    }
    if (source.remote) {
        await proveMoveDestination(ctx, op, destLocal, destRemote);
        op.deletingRemote = true;
        await save(ctx);
        const observed = await ctx.remote.lookup(op.from);
        const remote = await observedRemote(ctx, op.from, observed, [], true);
        if (!remoteMatches(remote, source.remote)) refuse('move_source_conflict');
        await ctx.remote.delete(op.from);
        const after = await ctx.remote.lookup(op.from);
        if (after.entry || !same(after.chain, observed.chain)) refuse('remote_delete_verification_failed');
        ctx.report.remoteRemoved++;
    }
}

async function complete(ctx, op) {
    if (op.kind === 'move') {
        const old = atName(ctx.records, op.from);
        if (!same(old.raw, op.raw) || atName(ctx.originals, op.from)) refuse('move_original_conflict');
        await currentRaw(ctx, op.path, op.raw);
        await guardMoveSource(ctx, op);
    }
    await protectedRaw(ctx, op.raw, null, { required: true });
    const source = op.kind === 'rollback' ? blobPath(ctx, op.raw) : renderPath(ctx, op.raw);
    await verifyPrivate(ctx, source, op.target);
    const verified = ctx.remote ? (await guardRemoteIntent(ctx, op, null, true)).actual : null;
    const local = await replaceLocal(ctx, op, source);
    const remote = ctx.remote ? await replaceRemote(ctx, op, source, verified) : null;
    const record = atName(ctx.records, op.path);
    if (op.kind === 'move') {
        if (!remoteMatches(remote, op.remoteAfter)) {
            op.remoteAfter = remote;
            await save(ctx);
        }
        await removeMoveSource(ctx, op, local, remote);
        const old = atName(ctx.records, op.from);
        ctx.records.set(keyOf(op.from), { ...old, retired: op.path, local: null, remote: null });
        updateRemoteInventory(ctx, op.from, null);
        ctx.report.moved++;
    }
    const version = { raw: op.raw, raster: op.kind === 'rollback' ? record?.raster ?? null : op.target, local, remote };
    const history = record ? [...record.history] : [];
    if (op.kind !== 'rollback' || !history.length) history.push(version);
    ctx.records.set(keyOf(op.path), { path: op.path, retired: null, ...version, history });
    updateRemoteInventory(ctx, op.path, remote);
    // Keep the stage receipt until the published inode and updated snapshots
    // have been verified. If cleanup gets interrupted the op remains resumable.
    await cleanStage(ctx, op);
    ctx.state.intent = null;
    await save(ctx);
}

async function start(ctx, op) {
    ctx.state.intent = op;
    await save(ctx);
    await complete(ctx, op);
}

async function protectPlan(ctx, work) {
    for (const { path, raw } of work) {
        await currentRaw(ctx, path, raw);
        const record = atName(ctx.records, path);
        if (record) await protectedRaw(ctx, record.raw, null, { required: true });
        await protectedRaw(ctx, raw, async (output) => {
            const file = await inspectFile(join(ctx.originalArchiveDir, path), { output, privateFile: true });
            if (!file) refuse('original_changed');
            return file.bytes;
        });
    }
}

async function publishWork(ctx, path, raw, renderer, from) {
    const target = await ensureRender(ctx, raw, renderer);
    await start(ctx, newIntent(ctx, from ? 'move' : 'publish', path, raw, target, from));
}

function verifyMoveSpellings(ctx, moves) {
    for (const { from, to } of moves) {
        for (const path of [from, to]) {
            let prefix = '';
            for (const part of segments(path)) {
                prefix = prefix ? prefix + '/' + part : part;
                atName(ctx.names, prefix);
            }
        }
    }
}

async function prepareArchive(settings, options) {
    const moves = movesOf(options.moves);
    const ctx = await openArchive(settings, options);
    verifyMoveSpellings(ctx, moves);
    await guardRecords(ctx);
    const pending = ctx.state.intent;
    for (const move of moves) {
        if (pending?.kind === 'move' && pending.from === move.from && pending.path === move.to) continue;
        planMove(ctx, move);
    }
    const captures = await planCapture(ctx, moves);
    ctx.report.captured = captures.length;
    if (ctx.dryRun || ctx.state.phase !== 'active') return ctx.report;
    await initialize(ctx);
    await settleRender(ctx);
    for (const item of captures) await capture(ctx, item);
    if (!ctx.existed || captures.length) await save(ctx);
    return ctx.report;
}

async function publishArchive(settings, options) {
    const moves = movesOf(options.moves);
    const ctx = await openArchive(settings, options);
    if (!ctx.existed && !ctx.dryRun) refuse('prepare_required');
    if (ctx.state.phase === 'rolling-back' && !ctx.dryRun) refuse('publication_paused');
    verifyMoveSpellings(ctx, moves);
    await guardRecords(ctx);
    const captures = await planCapture(ctx, moves, { privateOnly: true });
    const { work, movePlan } = planPublish(ctx, moves, captures);
    const pending = ctx.state.intent;
    ctx.report.captured = captures.length;
    ctx.report.wouldMove = movePlan.filter(({ replay }) => !replay).length + Number(pending?.kind === 'move');
    ctx.report.wouldRender = new Set([...work, ...movePlan.filter(({ replay }) => !replay)]
        .filter(({ raw }) => !ctx.cache.has(raw.sha256) && !ctx.stagedRenders.has(raw.sha256)).map(({ raw }) => raw.sha256)).size;
    if (ctx.dryRun) return ctx.report;
    await initialize(ctx);
    await settleRender(ctx);
    // A move's source must already be owned before any raw ingestion. Protect
    // the destination's raw bytes before publishing either endpoint.
    for (const item of captures) await capture(ctx, item);
    if (captures.length) await save(ctx);
    await protectPlan(ctx, [...work, ...movePlan.filter(({ replay }) => !replay).map(({ to, raw }) => ({ path: to, raw }))]);
    if (pending) await complete(ctx, pending);
    for (const move of movePlan) {
        if (!move.replay) await publishWork(ctx, move.to, move.raw, options.renderRasterPdf, move.from);
    }
    for (const { path, raw } of work) await publishWork(ctx, path, raw, options.renderRasterPdf);
    if (ctx.state.phase === 'paused') {
        ctx.state.phase = 'active';
        await save(ctx);
    }
    return ctx.report;
}

async function settlePublishForRollback(ctx, op) {
    const record = atName(ctx.records, op.path);
    const { local, remote } = await guardRecord(ctx, record, { strong: true });
    await protectedRaw(ctx, op.raw, null, { required: true });
    if (!op.discarding) {
        op.discarding = true;
        ctx.state.phase = 'rolling-back';
        await save(ctx);
    }
    await cleanStage(ctx, op);
    const proposed = { raw: op.raw, raster: op.target, local, remote };
    ctx.records.set(keyOf(op.path), { ...record, ...proposed, history: [...record.history, proposed] });
    ctx.state.intent = null;
    await save(ctx);
}

async function rollbackArchive(settings, options) {
    movesOf(options.moves);
    const ctx = await openArchive(settings, options);
    if (!ctx.existed) refuse('prepare_required');
    await guardRecords(ctx, { strong: true });
    const pending = ctx.state.intent;
    const active = [...ctx.records.values()].filter(({ retired }) => !retired);
    for (const { raw } of active) await protectedRaw(ctx, raw, null, { required: true });
    if (pending) await protectedRaw(ctx, pending.raw, null, { required: true });
    ctx.report.wouldRestore = active.filter(({ local, remote, raw }) => !sameBytes(local?.bytes, raw)
        || (ctx.remote && !sameBytes(remote?.bytes, raw))).length;
    if (ctx.dryRun) return ctx.report;
    await initialize(ctx);
    await settleRender(ctx);
    if (pending?.kind === 'publish') await settlePublishForRollback(ctx, pending);
    if (ctx.state.phase !== 'rolling-back') {
        ctx.state.phase = 'rolling-back';
        await save(ctx);
    }
    // A pending move was already authorized by the caller. Settle its two
    // endpoints and retirement using the existing cache before restoring raw.
    if (ctx.state.intent) await complete(ctx, ctx.state.intent);
    for (const { path, raw, local, remote, retired } of ctx.records.values()) {
        if (retired) continue;
        if (sameBytes(local?.bytes, raw) && (!ctx.remote || sameBytes(remote?.bytes, raw))) {
            ctx.report.unchanged++;
            continue;
        }
        await start(ctx, newIntent(ctx, 'rollback', path, raw, raw));
    }
    ctx.state.phase = 'paused';
    await save(ctx);
    return ctx.report;
}

async function redact(operation, settings, options, action) {
    try {
        return await operation(settings, { ...options, action });
    } catch (error) {
        // Native fs, JSON and renderer errors may contain paths or document
        // data. Deliberately discard the original error and its cause.
        if (error instanceof MirrorError) throw error;
        refuse(action + '_failed');
    }
}

export function prepareRasterArchive(settings, options = {}) {
    return redact(prepareArchive, settings, options, 'prepare');
}

export function publishRasterArchive(settings, options = {}) {
    return redact(publishArchive, settings, options, 'publish');
}

export function rollbackRasterArchive(settings, options = {}) {
    return redact(rollbackArchive, settings, options, 'rollback');
}
