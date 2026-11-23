import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { matchesProviderPair, pairedPaths, providerFolder, syncDirectory, writeJson } from './provider-contract-paths.mjs';

const prefix = '.provider-publication-';
const validStageName = (name) => typeof name === 'string' && /^\.provider-publication-[a-zA-Z0-9]{6}$/.test(name);
const identity = ({ dev, ino, birthtimeNs }) => ({ dev: String(dev), ino: String(ino), birthtimeNs: String(birthtimeNs) });
const validIdentity = (id) => typeof id?.dev === 'string' && /^\d+$/.test(id.dev)
    && typeof id.ino === 'string' && /^\d+$/.test(id.ino)
    && typeof id.birthtimeNs === 'string' && /^\d+$/.test(id.birthtimeNs);
const validPreparedIdentity = (id) => validIdentity(id) && /[1-9]/.test(id.birthtimeNs);
const sameInode = (stat, id) => isDeepStrictEqual(identity(stat), id);
const refuse = (reason) => { throw new Error(`provider_publication_${reason}`); };
const stat = (path) => fs.lstat(path, { bigint: true }).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
});
const privateToWorker = (stat) => stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n;
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
// Linux directory handles keep child operations anchored to the verified directory.
const directoryFdPath = (handle) => `/proc/self/fd/${handle.fd}`;
const stagePath = (directory) => join(directory, 'payload.stage');

async function readPrivateJson(path, reason) {
    const info = await stat(path);
    if (!info) return null;
    if (!info.isFile() || !privateToWorker(info)) refuse(reason);
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || !privateToWorker(opened) || !sameInode(opened, identity(info))) refuse(reason);
        return { value: JSON.parse(await handle.readFile('utf8')), inode: identity(opened) };
    } finally { await handle.close(); }
}

function validatePrepared(receipt, archive, archiveInfo) {
    if (receipt?.version !== 1 || receipt.archive !== archive || !validPreparedIdentity(receipt.archiveInode)
        || !sameInode(archiveInfo, receipt.archiveInode)
        || !Array.isArray(receipt.stages) || receipt.stages.length < 1 || receipt.stages.length > 2
        || receipt.stages.some((file) => !validStageName(file?.stage?.name)
            || !validPreparedIdentity(file.stage.inode) || !validPreparedIdentity(file.inode))
        || new Set(receipt.stages.map((file) => file.stage.name)).size !== receipt.stages.length) {
        refuse('invalid_prepared_stages');
    }
}

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
                || !validStageName(file.stage?.name)
                || !validIdentity(file.stage.inode))
        || (intent.files[1] && intent.files[0].stage.name === intent.files[1].stage.name)
        || intent.next.fingerprint !== intent.files.map((file) => file?.sha256 ?? '').join(':')) refuse('invalid_intent');
    return paths;
}

export function providerPublication({ archive, statePath, state, saveState, prepare, fetchInto }) {
    const stateDir = dirname(statePath);
    const journalPath = join(stateDir, 'provider-contract-publication.json');
    const preparedPath = join(stateDir, 'provider-contract-prepared-stages.json');
    let pending = false;

    async function checkStage(stage) {
        const path = join(archive, stage.name);
        const info = await stat(path);
        if (!info) return null;
        if (!info.isDirectory() || !privateToWorker(info) || !sameInode(info, stage.inode)) refuse('unsafe_staging_directory');
        return path;
    }

    async function removePreparedStage(archiveHandle, { stage, inode }) {
        const location = join(directoryFdPath(archiveHandle), stage.name);
        const info = await stat(location);
        if (!info) return;
        if (!info.isDirectory() || !privateToWorker(info) || !sameInode(info, stage.inode)) refuse('unsafe_staging_directory');
        const directory = await fs.open(location, directoryFlags);
        try {
            const opened = await directory.stat({ bigint: true });
            if (!privateToWorker(opened) || !sameInode(opened, stage.inode)) refuse('unsafe_staging_directory');
            const path = stagePath(directoryFdPath(directory));
            const payload = await stat(path);
            if (payload) {
                if (!payload.isFile() || !privateToWorker(payload) || payload.nlink !== 1n || !sameInode(payload, inode)) {
                    refuse('prepared_payload_collision');
                }
                await fs.unlink(path);
            }
            await directory.sync();
            const current = await stat(location);
            if (!current?.isDirectory() || !privateToWorker(current) || !sameInode(current, stage.inode)) {
                refuse('unsafe_staging_directory');
            }
            try { await fs.rmdir(location); }
            catch (error) {
                if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') refuse('prepared_directory_not_empty');
                throw error;
            }
        } finally { await directory.close(); }
    }

    async function reconcilePrepared(intent) {
        const receipt = await readPrivateJson(preparedPath, 'unsafe_prepared_stages');
        if (!receipt) return;
        const archiveHandle = await fs.open(archive, directoryFlags);
        try {
            validatePrepared(receipt.value, archive, await archiveHandle.stat({ bigint: true }));
            const abandoned = receipt.value.stages.filter(({ stage, inode }) => {
                const referenced = intent?.files.find((file) => file?.stage.name === stage.name);
                if (!referenced) return true;
                if (!isDeepStrictEqual(referenced.stage.inode, stage.inode)
                    || !isDeepStrictEqual(referenced.inode, inode)) refuse('prepared_journal_collision');
                return false;
            });
            for (const file of abandoned) await removePreparedStage(archiveHandle, file);
            // An earlier worker may have exited after rmdir or after renaming the journal.
            await archiveHandle.sync();
            if (intent) await syncDirectory(stateDir);
            const current = await stat(preparedPath);
            if (!current?.isFile() || !privateToWorker(current) || !sameInode(current, receipt.inode)) {
                refuse('unsafe_prepared_stages');
            }
            await fs.unlink(preparedPath);
            await syncDirectory(stateDir);
        } finally { await archiveHandle.close(); }
    }

    async function removeStage(directory, file, createdAt) {
        const path = stagePath(directory);
        if (await verify(path, file, createdAt)) await fs.unlink(path);
        await syncDirectory(directory);
        await fs.rmdir(directory);
        await syncDirectory(archive);
    }

    async function stageFile(file, createdAt) {
        const wasPending = pending;
        pending = true;
        const archiveHandle = await fs.open(archive, directoryFlags);
        try {
            const archiveInfo = await archiveHandle.stat({ bigint: true });
            const receipt = await readPrivateJson(preparedPath, 'unsafe_prepared_stages');
            if (receipt) validatePrepared(receipt.value, archive, archiveInfo);
            const stages = receipt?.value.stages ?? [];
            const path = await fs.mkdtemp(join(directoryFdPath(archiveHandle), prefix));
            const directory = await fs.open(path, directoryFlags);
            try {
                const info = await directory.stat({ bigint: true });
                if (!privateToWorker(info)) refuse('unsafe_staging_directory');
                const stage = { name: basename(path), inode: identity(info) };
                const handle = await fs.open(stagePath(directoryFdPath(directory)), 'wx', 0o600);
                try {
                    const payload = await handle.stat({ bigint: true });
                    if (!payload.isFile() || !privateToWorker(payload) || payload.nlink !== 1n || payload.size !== 0n) {
                        refuse('prepared_payload_collision');
                    }
                    const inode = identity(payload);
                    // Make the empty allocation and its ownership durable before writing any PDF bytes.
                    await handle.sync();
                    await directory.sync();
                    await archiveHandle.sync();
                    const prepared = { version: 1, archive, archiveInode: identity(archiveInfo), stages: [...stages, { stage, inode }] };
                    validatePrepared(prepared, archive, archiveInfo);
                    await writeJson(preparedPath, prepared);
                    // Ordinary download failures can use the durable receipt to clean up and continue.
                    pending = wasPending;
                    await fetchInto(file, handle);
                    const time = new Date(createdAt);
                    await handle.utimes(time, time);
                    await handle.sync();
                    return { fileId: file.fileId, sha256: file.sha256, byteSize: file.byteSize, stage, inode };
                } finally { await handle.close(); }
            } finally { await directory.close(); }
        } finally { await archiveHandle.close(); }
    }

    async function cleanup(intent) {
        for (const file of intent.files.filter(Boolean)) {
            const directory = await checkStage(file.stage);
            if (directory) await removeStage(directory, file, intent.createdAt);
        }
    }

    async function finish(intent) {
        const paths = validate(intent, archive);
        await reconcilePrepared(intent);
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
            catch {
                await reconcilePrepared(intent);
                refuse('staged_file_unavailable');
            }
            const temp = stagePath(await checkStage(file.stage));
            if (!await verify(temp, file, intent.createdAt)) refuse('staged_file_unavailable');
            intent.files[artifact.index] = file;
            await writeJson(journalPath, intent);
            await reconcilePrepared(intent);
            artifact.file = file;
            artifact.temp = temp;
        }

        // A previous process may have renamed the journal and exited before syncing its directory.
        await syncDirectory(stateDir);
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
        await syncDirectory(stateDir);
        pending = false;
        return saved;
    }

    return {
        get pending() { return pending; },
        async resume() {
            const journal = await readPrivateJson(journalPath, 'unsafe_intent');
            if (journal) {
                pending = true;
                return finish(journal.value);
            }
            await reconcilePrepared(null);
            return 0;
        },
        async publish({ key, before, history, next, inputs, createdAt }) {
            const intent = { version: 1, archive, key, before, history, next, createdAt, files: [] };
            try {
                for (const file of inputs) {
                    intent.files.push(file ? await stageFile(file, createdAt) : null);
                }
            } catch (error) {
                if (!pending) {
                    pending = true;
                    await reconcilePrepared(null);
                    pending = false;
                }
                throw error;
            }
            pending = true;
            validate(intent, archive);
            await writeJson(journalPath, intent);
            return finish(intent);
        },
    };
}
