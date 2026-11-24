import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { inspectFile } from './raster-mirror-io.mjs';

const content = (file) => file ? { sha256: file.bytes.sha256, size: file.bytes.size } : null;
const inputContent = (file) => file ? { sha256: file.sha256.toLowerCase(), size: file.byteSize } : null;
const evidence = (file) => file ? { ...content(file), id: file.id } : null;
const fail = () => { throw new Error('ready_original_ownership'); };

export const readyIdentity = (unit) => createHash('sha256').update(JSON.stringify(unit.chunks
    ? unit.chunks.map((chunk) => [chunk.key, chunk.serviceRecordChunk, chunk.completed, chunk.inputs])
    : [unit.key, unit.completed, unit.sourceRevision ?? null, unit.inputs])).digest('hex');

function recordedContent(unit, before, path, index, mirrorProof) {
    if (unit.fork || !before || before.files[path] === null) return null;
    if (unit.chunks) return before.readyBytes?.[index] ?? mirrorProof.get(path) ?? null;
    const sha256 = before.fingerprint.split(':')[index];
    return sha256 ? { sha256: sha256.toLowerCase(), size: before.files[path] } : null;
}

// The allocation and the exact authority precede any raw placement. An in-flight
// inode is separately recorded before rename, so a matching hash alone never
// grants ownership of an unrecorded destination after an interruption.
export async function writeReadyOriginals({
    unit, before, reservations, save, record, mirrorProof, location, stage, replace, cleanup, report,
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
        const recorded = recordedContent(unit, before, path, i, mirrorProof);
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
            const staged = await stage(path, i);
            try {
                const file = await inspectFile(staged.tmp, { privateFile: true });
                if (!file || (expected[i] && !unit.chunks && !same(content(file), expected[i]))) fail();
                expected[i] = content(file);
                intent.placed[i] = evidence(file);
                await save();
                if (!same(evidence(await inspectFile(await location(path), { privateFile: true, allowLoose: true })), observed[i])) fail();
                await replace(staged);
                report.savedFiles++;
            } finally { await cleanup(staged); }
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
