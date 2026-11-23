import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { matchesProviderPair, pairedPaths, providerFolder, syncDirectory, writeJson } from './provider-contract-paths.mjs';

const prefix = '.provider-publication-';
const identity = ({ dev, ino, birthtimeNs }) => ({ dev: String(dev), ino: String(ino), birthtimeNs: String(birthtimeNs) });
const validIdentity = (id) => typeof id?.dev === 'string' && /^\d+$/.test(id.dev)
    && typeof id.ino === 'string' && /^\d+$/.test(id.ino)
    && typeof id.birthtimeNs === 'string' && /^\d+$/.test(id.birthtimeNs);
const sameInode = (stat, id) => isDeepStrictEqual(identity(stat), id);
const refuse = (reason) => { throw new Error(`provider_publication_${reason}`); };
const stat = (path) => fs.lstat(path, { bigint: true }).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
});
const privateToWorker = (stat) => stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n;

async function verify(path, file, createdAt) {
    const info = await stat(path);
    if (!info) return false;
    if (!file || !info.isFile() || !sameInode(info, file.inode)) refuse('path_collision');
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        | (constants.O_NOATIME ?? 0));
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !sameInode(opened, file.inode)) refuse('path_collision');
        if (opened.size !== BigInt(file.byteSize)
            || Math.round(Number(opened.mtimeNs) / 1e6) !== Date.parse(createdAt)) refuse('content_mismatch');
        const digest = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
        if (digest.digest('hex') !== file.sha256.toLowerCase()) refuse('content_mismatch');
    } finally { await handle.close(); }
    return true;
}

function validate(intent, archive) {
    if (intent?.version !== 1 || intent.archive !== archive || typeof intent.key !== 'string'
        || !intent.key.startsWith('doc:') || !intent.before || typeof intent.before.fingerprint !== 'string'
        || typeof intent.history !== 'string' || typeof intent.createdAt !== 'string'
        || !Number.isFinite(Date.parse(intent.createdAt))
        || !Array.isArray(intent.files) || intent.files.length !== 2
        || !intent.next?.files || typeof intent.next.providerBase !== 'string' || typeof intent.next.completed !== 'boolean') {
        refuse('invalid_intent');
    }
    const historyBase = `${intent.key}@${intent.before.fingerprint}`;
    if (intent.history !== historyBase && !(intent.history.startsWith(`${historyBase}@`)
        && /^(?:[2-9]|[1-9]\d+)$/.test(intent.history.slice(historyBase.length + 1)))) refuse('invalid_intent');
    const paths = pairedPaths(intent.next.files, providerFolder);
    if (!paths || !matchesProviderPair(intent.next.files, intent.next.providerBase)
        || intent.files.some((file, index) => file === null
            ? index !== 1 || intent.next.completed || intent.next.files[paths[index]] !== null
            : typeof file?.fileId !== 'string' || !file.fileId || typeof file.sha256 !== 'string'
                || !/^[a-f\d]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.byteSize) || file.byteSize < 0
                || intent.next.files[paths[index]] !== file.byteSize || !validIdentity(file.inode)
                || typeof file.stage?.name !== 'string' || !/^\.provider-publication-[a-zA-Z0-9]{6}$/.test(file.stage.name)
                || !validIdentity(file.stage.inode))
        || (intent.files[1] && intent.files[0].stage.name === intent.files[1].stage.name)
        || intent.next.fingerprint !== intent.files.map((file) => file?.sha256 ?? '').join(':')) refuse('invalid_intent');
    return paths;
}

export function providerPublication({ archive, statePath, state, saveState, prepare, fetchInto }) {
    const journalPath = join(dirname(statePath), 'provider-contract-publication.json');
    let pending = false;

    async function newStage() {
        const directory = await fs.mkdtemp(join(archive, prefix));
        await syncDirectory(archive);
        return { name: basename(directory), inode: identity(await stat(directory)) };
    }

    async function checkStage(stage) {
        const path = join(archive, stage.name);
        const info = await stat(path);
        if (!info) return null;
        if (!info.isDirectory() || !privateToWorker(info) || !sameInode(info, stage.inode)) refuse('unsafe_staging_directory');
        return path;
    }

    const stagePath = (directory) => join(directory, 'payload.stage');
    async function removeStage(directory, file, createdAt) {
        const path = stagePath(directory);
        if (await verify(path, file, createdAt)) await fs.unlink(path);
        await syncDirectory(directory);
        await fs.rmdir(directory);
        await syncDirectory(archive);
    }

    async function stageFile(file, createdAt) {
        const stage = await newStage();
        const directory = await checkStage(stage);
        const path = stagePath(directory);
        let inode;
        try {
            const handle = await fs.open(path, 'wx', 0o600);
            try {
                inode = identity(await handle.stat({ bigint: true }));
                await fetchInto(file, handle);
                const time = new Date(createdAt);
                await handle.utimes(time, time);
                await handle.sync();
            } finally { await handle.close(); }
            await syncDirectory(directory);
            return { fileId: file.fileId, sha256: file.sha256, byteSize: file.byteSize, stage, inode };
        } catch (error) {
            // A failed download was created exclusively here and has not been journaled.
            if (await checkStage(stage)) {
                const info = await stat(path);
                if (info && inode && sameInode(info, inode)) await fs.unlink(path);
                await fs.rmdir(directory);
                await syncDirectory(archive);
            }
            throw error;
        }
    }

    async function cleanup(intent) {
        for (const file of intent.files.filter(Boolean)) {
            const directory = await checkStage(file.stage);
            if (directory) await removeStage(directory, file, intent.createdAt);
        }
    }

    async function finish(intent) {
        const paths = validate(intent, archive);
        const active = state.units[intent.key];
        const historical = state.units[intent.history];
        const committed = isDeepStrictEqual(active, intent.next) && isDeepStrictEqual(historical, intent.before);
        if (!committed && (!isDeepStrictEqual(active, intent.before) || historical !== undefined)) refuse('state_changed');
        const destinations = new Set(paths.map((path) => resolve(archive, path)));
        for (const [key, entry] of Object.entries(state.units)) {
            if (committed && key === intent.key) continue;
            if ([...Object.keys(entry.files), ...(entry.reservedPaths ?? [])]
                .some((path) => destinations.has(resolve(archive, path)))) refuse('shared_archive_path');
        }

        const artifacts = [];
        // Inspect both destinations before creating either link. A matching digest alone proves no ownership.
        for (const [index, path] of paths.entries()) {
            const file = intent.files[index];
            const final = await prepare(path, true);
            const published = await verify(final, file, intent.createdAt);
            const directory = file ? await checkStage(file.stage) : null;
            const temp = directory ? stagePath(directory) : null;
            const staged = temp ? await verify(temp, file, intent.createdAt) : false;
            if (file) artifacts.push({ index, file, final, published, staged, temp, directory });
        }

        for (const artifact of artifacts) {
            if (artifact.published || artifact.staged) continue;
            if (artifact.directory) await removeStage(artifact.directory, artifact.file, intent.createdAt);
            // Only the original file ID and digest can restore a missing artifact. The listing
            // may now show a different version or no document at all.
            let file;
            try { file = await stageFile(artifact.file, intent.createdAt); }
            catch { refuse('staged_file_unavailable'); }
            const temp = stagePath(await checkStage(file.stage));
            if (!await verify(temp, file, intent.createdAt)) refuse('staged_file_unavailable');
            intent.files[artifact.index] = file;
            await writeJson(journalPath, intent);
            artifact.file = file;
            artifact.temp = temp;
        }

        // A previous process may have renamed the journal and exited before syncing its directory.
        await syncDirectory(dirname(statePath));
        let saved = 0;
        for (const artifact of artifacts) {
            if (!artifact.published) {
                await fs.link(artifact.temp, artifact.final);
                saved += 1;
            }
            if (!await verify(artifact.final, artifact.file, intent.createdAt)) refuse('missing_destination');
        }
        for (const parent of new Set(artifacts.map(({ final }) => dirname(final)))) await syncDirectory(parent);
        if (!committed) {
            state.units[intent.history] = intent.before;
            state.units[intent.key] = intent.next;
            await saveState();
        }
        await cleanup(intent);
        await syncDirectory(archive);
        await fs.unlink(journalPath);
        await syncDirectory(dirname(statePath));
        pending = false;
        return saved;
    }

    return {
        get pending() { return pending; },
        async resume() {
            const info = await stat(journalPath);
            if (!info) return 0;
            pending = true;
            if (!info.isFile() || !privateToWorker(info)) refuse('unsafe_intent');
            const handle = await fs.open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            let intent;
            try {
                if (!sameInode(await handle.stat({ bigint: true }), identity(info))) refuse('unsafe_intent');
                intent = JSON.parse(await handle.readFile('utf8'));
            } finally { await handle.close(); }
            return finish(intent);
        },
        async publish({ key, before, history, next, inputs, createdAt }) {
            const intent = { version: 1, archive, key, before, history, next, createdAt, files: [] };
            try {
                for (const file of inputs) {
                    intent.files.push(file ? await stageFile(file, createdAt) : null);
                }
                validate(intent, archive);
            } catch (error) {
                await cleanup(intent);
                throw error;
            }
            pending = true;
            await writeJson(journalPath, intent);
            return finish(intent);
        },
    };
}
