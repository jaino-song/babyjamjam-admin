import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export const providerFolder = '제공인력 계약서';
export const sanitize = (value) => String(value).replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');

export function providerBase(doc) {
    if (doc.kind !== 'other' || typeof doc.providerContract?.signerName !== 'string') return null;
    const name = doc.providerContract.signerName.trim();
    if (!name.replace(/[/\\:*?"<>|\u0000-\u001f\u007f .]/g, '').trim()) return null;
    const date = doc.providerContract.signedDate;
    if (typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
    const base = `제공인력_계약서_${sanitize(name)}_${date}`;
    // Leave room for the audit prefix, the allocation suffix and the temporary write suffix.
    return Buffer.byteLength(base) <= 175 ? base : null;
}

export function pairPaths(folder, base, number) {
    const name = `${base}${number === 1 ? '' : ` (${number})`}.pdf`;
    return [`${folder}/${name}`, `${folder}/감사추적/[감사추적]_${name}`];
}

export function pairedPaths(files, folder) {
    const prefix = `${folder}/`;
    const paths = Object.keys(files);
    const document = paths.find((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    const name = document?.slice(prefix.length);
    if (!name?.endsWith('.pdf') || sanitize(name) !== name) return null;
    const audit = `${folder}/감사추적/[감사추적]_${name}`;
    return paths.length === 2 && paths.includes(audit) ? [document, audit] : null;
}

export function matchesProviderPair(files, base) {
    const paths = pairedPaths(files, providerFolder);
    if (!paths) return false;
    const name = paths[0].slice(providerFolder.length + 1, -4);
    if (name === base) return true;
    return name.startsWith(`${base} (`) && /^(?:[2-9]|[1-9]\d+)\)$/.test(name.slice(base.length + 2));
}

export async function syncDirectory(path) {
    const handle = await fs.open(path, 'r');
    try { await handle.sync(); }
    finally { await handle.close(); }
}

export const writeJson = (path, value) => writeAtomic(path, JSON.stringify(value, null, 2));

export async function writeAtomic(path, contents) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    const handle = await fs.open(tmp, 'wx', 0o600);
    try {
        try {
            await handle.writeFile(contents);
            await handle.sync();
        } finally { await handle.close(); }
        await fs.rename(tmp, path);
        try { await syncDirectory(dirname(path)); }
        catch (error) {
            error.statePublished = true;
            throw error;
        }
    } finally { await fs.rm(tmp, { force: true }); }
}
