import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import {
    checkPrivate, fdPath, identity, inspectFile, openChildDirectory, openDirectory, readJson, rootPath, stat, syncDir, validIdentity,
} from './raster-mirror-io.mjs';

const content = (file) => file ? { sha256: file.bytes.sha256, size: file.bytes.size } : null;
const inputContent = (file) => file ? { sha256: file.sha256.toLowerCase(), size: file.byteSize } : null;
const evidence = (file) => file ? { ...content(file), id: file.id } : null;
const fail = () => { throw new Error('ready_original_ownership'); };

const prefixes = { original: '.ready-raw-', qpdf: 'eformsign-backup-qpdf-' };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const payload = 'payload.tmp';
const scratchError = () => { throw new Error('ready_original_scratch'); };

function checkPayload(info) {
    if (!info?.isFile() || info.nlink !== 1n) scratchError();
    checkPrivate(info, 0o600);
}

async function scratchParent(stage, binding) {
    rootPath(stage.parent);
    if (stage.kind === 'qpdf') {
        if (stage.parent !== '/tmp') scratchError();
    } else {
        const rel = relative(binding.originalRoot, stage.parent);
        if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) scratchError();
    }
    const parent = await openDirectory(stage.parent);
    try {
        const info = await parent.stat({ bigint: true });
        if (stage.kind === 'qpdf') {
            if (info.uid !== 0n || !(info.mode & 0o1000n)) scratchError();
        } else {
            checkPrivate(info, 0o700, false, true);
        }
        if (stage.parentId && !same(identity(info), stage.parentId)) scratchError();
        return { parent, parentId: identity(info) };
    } catch (error) {
        await parent.close();
        throw error;
    }
}

export function readyScratch(binding) {
    const journal = join(binding.stateRoot, 'ready-original-scratch.json');
    const next = journal + '.next';
    const removeNext = async () => {
        const info = await stat(next);
        if (!info) return;
        checkPayload(info);
        await fs.unlink(next);
    };
    const save = async (receipt) => {
        await removeNext();
        const handle = await fs.open(next, 'wx', 0o600);
        try {
            await handle.writeFile(JSON.stringify(receipt));
            await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(next, journal);
        await syncDir(binding.stateRoot);
    };

    async function remove(stage) {
        // Only a recorded directory identity grants cleanup ownership.
        if (stage.id === null) return;
        const { parent } = await scratchParent(stage, binding);
        try {
            const path = join(fdPath(parent), stage.name);
            const info = await stat(path);
            if (!info) { await parent.sync(); return; }
            if (!info.isDirectory() || !same(identity(info), stage.id)) scratchError();
            checkPrivate(info, 0o700);
            const directory = await openChildDirectory(parent, stage.name);
            try {
                const opened = await directory.stat({ bigint: true });
                if (!same(identity(opened), stage.id)) scratchError();
                checkPrivate(opened, 0o700);
                const entries = await fs.readdir(fdPath(directory));
                const files = [];
                for (const name of entries) {
                    if (stage.kind === 'original' ? name !== payload : !/^(?:input-[1-9][0-9]*|merged)\.pdf$/.test(name)) {
                        scratchError();
                    }
                    const file = join(fdPath(directory), name);
                    checkPayload(await stat(file));
                    files.push(file);
                }
                for (const file of files) await fs.unlink(file);
                await directory.sync();
            } finally { await directory.close(); }
            const current = await stat(path);
            if (!current?.isDirectory() || !same(identity(current), stage.id)) scratchError();
            await fs.rmdir(path);
            await parent.sync();
        } finally { await parent.close(); }
    }

    async function recover(allowed = () => true) {
        const receipt = await readJson(journal, { maxBytes: 32_768 });
        if ((!receipt && !await stat(next)) || !await allowed()) return;
        if (receipt) {
            if (receipt.version !== 1 || !same(receipt.binding, binding)
                || !Array.isArray(receipt.stages) || receipt.stages.length < 1 || receipt.stages.length > 2
                || receipt.stages.some((stage, i) => {
                    const kind = i === 0 ? 'original' : 'qpdf';
                    return stage?.kind !== kind || typeof stage.name !== 'string' || !stage.name.startsWith(prefixes[kind])
                        || !uuid.test(stage.name.slice(prefixes[kind].length)) || !validIdentity(stage.parentId)
                        || !(stage.id === null || validIdentity(stage.id));
                })) scratchError();
            for (const stage of receipt.stages) await remove(stage);
            await fs.unlink(journal);
        }
        await removeNext();
        await syncDir(binding.stateRoot);
    }

    async function stage(final, merge, use) {
        // Under the shared timer lock, at most one output and its optional qpdf
        // workspace are live. Keep their receipt independent of queue expiry.
        if (await stat(journal)) scratchError();
        const stages = [{ kind: 'original', parent: dirname(final) }];
        if (merge) stages.push({ kind: 'qpdf', parent: '/tmp' });
        const live = [];
        try {
            for (const stage of stages) {
                const { parent, parentId } = await scratchParent(stage, binding);
                live.push({ parent });
                Object.assign(stage, { name: prefixes[stage.kind] + randomUUID(), parentId, id: null });
            }
            const receipt = { version: 1, binding, stages };
            await save(receipt);
            for (const [i, stage] of stages.entries()) {
                const workspace = live[i];
                const { parent } = workspace;
                await fs.mkdir(join(fdPath(parent), stage.name), { mode: 0o700 });
                const directory = await openChildDirectory(parent, stage.name);
                Object.assign(workspace, { directory, path: join(stage.parent, stage.name) });
                const info = await directory.stat({ bigint: true });
                checkPrivate(info, 0o700);
                stage.id = identity(info);
                await parent.sync();
                // Persist ownership before creating another directory or writing PDF bytes.
                await save(receipt);
            }
            return await use(join(fdPath(live[0].directory), payload), live[1]);
        } finally {
            try {
                for (const { parent, directory } of live) {
                    try { await directory?.close(); } finally { await parent.close(); }
                }
            } finally { await recover(); }
        }
    }
    return { recover, stage };
}

export const readyIdentity = (unit) => createHash('sha256').update(JSON.stringify(unit.chunks
    ? unit.chunks.map((chunk) => [chunk.key, chunk.serviceRecordChunk, chunk.completed, chunk.inputs])
    : [unit.key, unit.completed, unit.sourceRevision ?? null, unit.inputs])).digest('hex');

function recordedContent(unit, before, path, index, mirrorProof) {
    if (!before || before.files[path] === null) return null;
    if (unit.chunks) return before.readyBytes?.[index] ?? mirrorProof?.get(path) ?? null;
    const sha256 = before.fingerprint.split(':')[index];
    return sha256 ? { sha256: sha256.toLowerCase(), size: before.files[path] } : null;
}

export async function originalPairIntact(unit, receipt, location) {
    for (const [index, path] of receipt.paths.entries()) {
        const actual = content(await inspectFile(await location(path), { privateFile: true, allowLoose: true }));
        if (!actual && receipt.prior[index] === null) continue;
        if (!same(actual, recordedContent(unit, receipt.before, path, index))) return false;
    }
    return true;
}

// The allocation and the exact authority precede any raw placement. An in-flight
// inode is separately recorded before rename, so a matching hash alone never
// grants ownership of an unrecorded destination after an interruption.
export async function writeReadyOriginals({
    unit, before, reservations, save, record, mirrorProof, location, withStage, replace, report,
}) {
    const paths = Object.keys(unit.files);
    const previous = reservations[unit.key];
    const identity = readyIdentity(unit);
    if (previous && (!same(previous.before, before) || !same(previous.paths, paths))) fail();
    const observed = [];
    const expected = unit.inputs?.map(inputContent) ?? (previous?.identity === identity ? previous.expected : [null, null]);
    const available = unit.inputs?.map(Boolean) ?? [true, unit.chunks.every((chunk) => chunk.inputs[1])];
    const needs = [];
    for (const [i, path] of paths.entries()) {
        const actual = evidence(await inspectFile(await location(path), { privateFile: true, allowLoose: true }));
        observed.push(actual);
        const recorded = unit.fork ? null : recordedContent(unit, before, path, i, mirrorProof);
        const owned = actual && (same(actual, previous?.placed[i]) || same(actual, previous?.prior[i]));
        if (actual && !owned && !same({ sha256: actual.sha256, size: actual.size }, recorded && {
            sha256: recorded.sha256, size: recorded.size,
        })) fail();
        if (!available[i]) {
            if (actual) fail();
            continue;
        }
        if (unit.chunks && !expected[i] && before?.fingerprint === unit.fingerprint && !unit.fork && actual && recorded) {
            expected[i] = { sha256: recorded.sha256, size: recorded.size };
        }
        if (!actual || !expected[i] || actual.sha256 !== expected[i].sha256 || actual.size !== expected[i].size) needs.push(i);
    }
    if (needs.length || previous) {
        const intent = { before, paths, identity, expected, prior: observed, placed: [null, null] };
        reservations[unit.key] = intent;
        await save();
        for (const i of needs) {
            const path = paths[i];
            await withStage(path, i, async (staged) => {
                const file = await inspectFile(staged.tmp, { privateFile: true });
                if (!file || (expected[i] && !unit.chunks && !same(content(file), expected[i]))) fail();
                expected[i] = content(file);
                intent.placed[i] = evidence(file);
                await save();
                if (!same(evidence(await inspectFile(await location(path), { privateFile: true, allowLoose: true })), observed[i])) fail();
                await replace(staged);
                report.savedFiles++;
            });
        }
    }
    for (const [i, path] of paths.entries()) unit.files[path] = expected[i]?.size ?? null;
    unit.readyBytes = expected;
    if (needs.length || previous || !before) {
        await record(unit, () => { delete reservations[unit.key]; });
    } else {
        report.skippedFiles += available.filter(Boolean).length;
    }
}
