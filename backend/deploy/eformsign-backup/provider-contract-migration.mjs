import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
    matchesProviderPair, pairedPaths, pairPaths, providerBase, providerFolder, syncDirectory, writeAtomic, writeJson,
} from './provider-contract-paths.mjs';

const digestPattern = /^[a-f\d]{64}$/i;
const journalDir = (stateDir) => resolve(stateDir, 'provider-contract-migration');
const journalPath = (stateDir) => resolve(journalDir(stateDir), 'journal.json');
const stages = ['applying', 'applied', 'rollingBack', 'rolledBack'];

function refuse(migrationReason) {
    throw Object.assign(new Error(migrationReason), { migrationReason });
}

export async function withTimerLock(run) {
    // The child locks our open file description. The lock survives the child's exit
    // and remains held by this process until the migration completes.
    const path = resolve(homedir(), '.local/state/eformsign-backup/run.lock');
    const lock = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
        refuse(error.code === 'ENOENT' ? 'timer_lock_missing' : 'timer_lock_unavailable');
    });
    try {
        if (!(await lock.stat()).isFile()) refuse('timer_lock_unavailable');
        const child = spawn('/usr/bin/flock', ['-n', '-E', '75', '3'], { stdio: ['ignore', 'ignore', 'ignore', lock.fd] });
        const code = await exitCode(child);
        if (code !== 0) refuse(code === 75 ? 'timer_lock_held' : 'timer_lock_unavailable');
        return await run(lock.fd);
    } finally { await lock.close(); }
}

function exitCode(child) {
    return new Promise((done, reject) => {
        child.once('error', reject);
        child.once('close', done);
    });
}

async function probe(path) {
    try { return await fs.lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readMigration(stateDir) {
    const dir = await probe(journalDir(stateDir));
    if (!dir) return null;
    if (!dir.isDirectory() || (dir.mode & 0o077) !== 0) refuse('unsafe_journal_directory');
    const info = await probe(journalPath(stateDir));
    if (!info) return null;
    if (!info.isFile() || (info.mode & 0o077) !== 0) refuse('unsafe_journal_file');
    const journal = JSON.parse(await fs.readFile(journalPath(stateDir), 'utf8'));
    if (journal?.version !== 1 || !stages.includes(journal.phase)
        || !/^[a-f\d-]{36}$/.test(journal.id) || !Array.isArray(journal.moves)) refuse('invalid_journal');
    return journal;
}

function localFiles(archive, finalPath) {
    async function inspect(path, createParents = false) {
        const final = finalPath(path);
        let parent = archive;
        for (const segment of relative(archive, dirname(final)).split('/').filter(Boolean)) {
            parent = resolve(parent, segment);
            const info = await probe(parent);
            if (info && !info.isDirectory()) refuse('unsafe_archive_path');
            if (!info) {
                if (!createParents) return null;
                await fs.mkdir(parent, { mode: 0o700 });
                await syncDirectory(dirname(parent));
            }
        }
        const info = await probe(final);
        if (info && !info.isFile()) refuse('unsafe_archive_path');
        return info;
    }

    async function verify(path, file) {
        const info = await inspect(path);
        if (!info) return null;
        const handle = await fs.open(finalPath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const actual = await handle.stat();
            if (actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== file.bytes) refuse('local_checksum_mismatch');
            const hash = createHash('sha256');
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            if (hash.digest('hex') !== file.hash) refuse('local_checksum_mismatch');
            return actual;
        } finally { await handle.close(); }
    }

    return { inspect, verify };
}

function driveFiles(settings, timeout, lockFd) {
    const parts = /^([^/:]+:)(.*)$/.exec(settings.rcloneRemote ?? '');
    if (!parts) refuse('drive_remote_required');
    const [, root, configuredPath] = parts;
    const prefix = configuredPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (prefix.some((part) => part === '.' || part === '..' || part.includes('\\'))) refuse('invalid_drive_root');
    const exact = (path) => root + [...prefix, path].join('/');
    // Inherit the lock while subprocesses are active, including if Node is interrupted.
    const start = (args) => spawn(settings.rcloneBin, args, {
        stdio: ['ignore', 'pipe', 'ignore', lockFd], timeout,
    });
    const stream = async (args, receive) => {
        const child = start(args);
        try {
            await Promise.all([
                exitCode(child).then((code) => { if (code !== 0) refuse('drive_command_failed'); }),
                (async () => { for await (const chunk of child.stdout) receive(chunk); })(),
            ]);
        } catch { refuse('drive_command_failed'); }
    };
    const rclone = async (args) => {
        const chunks = [];
        let bytes = 0;
        await stream(args, (chunk) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024) refuse('drive_listing_too_large');
            chunks.push(chunk);
        });
        return Buffer.concat(chunks).toString('utf8');
    };

    async function lookup(path) {
        const segments = [...prefix, ...path.split('/')];
        let parent = root;
        for (const [index, segment] of segments.entries()) {
            const rows = JSON.parse(await rclone(['lsjson', '--', parent]));
            if (!Array.isArray(rows)) refuse('invalid_drive_listing');
            const matches = rows.filter((row) => row.Name === segment);
            if (matches.length > 1) refuse('duplicate_drive_path');
            if (matches.length === 0) return null;
            const directory = index < segments.length - 1;
            if (matches[0].IsDir !== directory) refuse('drive_path_type_conflict');
            if (!directory) return matches[0];
            parent += (index === 0 ? '' : '/') + segment;
        }
    }

    async function verify(path, file, known) {
        const info = await lookup(path);
        if (!info) return null;
        if (known && (info.ID ?? null) !== known.id) refuse('drive_identity_changed');
        const hash = createHash('sha256');
        let bytes = 0;
        await stream(['cat', '--', exact(path)], (chunk) => {
            hash.update(chunk);
            bytes += chunk.length;
        });
        if (bytes !== file.bytes || hash.digest('hex') !== file.hash) refuse('drive_checksum_mismatch');
        const checked = await lookup(path);
        if (!checked || checked.ID !== info.ID) refuse('drive_identity_changed');
        return { id: info.ID ?? null };
    }

    return {
        lookup, verify,
        copy: (from, to) => rclone(['copyto', '--immutable', '--ignore-existing', '--', from, exact(to)]),
        remove: (path) => rclone(['deletefile', '--', exact(path)]),
    };
}

function verifyUnshared(state, key, paths) {
    for (const [other, entry] of Object.entries(state.units)) {
        if (other !== key && paths.some((path) => Object.hasOwn(entry.files, path)
            || entry.reservedPaths?.includes(path))) refuse('shared_archive_path');
    }
}

function listingFingerprint(doc) {
    if (doc.completed !== true || !Array.isArray(doc.files) || doc.files.length !== 2) return null;
    const files = ['document', 'audit_trail'].map((type) => doc.files.find((file) => file.fileType === type));
    if (files.some((file) => !file || !digestPattern.test(file.sha256)
        || !Number.isSafeInteger(file.byteSize) || file.byteSize < 0)) return null;
    return { files, fingerprint: files.map((file) => file.sha256).join(':') };
}

function validateMove(move) {
    const from = pairedPaths(move.before.files, '기타');
    const to = pairedPaths(move.after.files, providerFolder);
    if (!move.key.startsWith('doc:') || !from || !to || !matchesProviderPair(move.after.files, move.after.providerBase)
        || move.after.fingerprint !== move.before.fingerprint || move.before.completed !== true || move.after.completed !== true
        || move.files.length !== 2) refuse('invalid_journal_move');
    const hashes = move.before.fingerprint.toLowerCase().split(':');
    for (const [index, file] of move.files.entries()) {
        if (file.old !== from[index] || file.new !== to[index] || !digestPattern.test(file.hash)
            || file.hash !== hashes[index] || !Number.isSafeInteger(file.bytes) || file.bytes < 0
            || file.bytes !== move.before.files[file.old] || file.bytes !== move.after.files[file.new]) refuse('invalid_journal_move');
    }
}

export async function migrateProviderContracts(context) {
    const { settings, archive, statePath, state, reserved, saveState, docs, listingComplete, finalPath, timeout, lockFd, log } = context;
    const dryRun = settings.action === 'dry-run';
    const reverse = settings.action === 'rollback';
    let journal = context.migration;
    const pending = ['applying', 'rollingBack'].includes(journal?.phase);
    const local = localFiles(archive, finalPath);
    const stateDir = await fs.realpath(settings.stateDir).catch((error) => {
        if (error.code === 'ENOENT') return resolve(settings.stateDir);
        throw error;
    });
    const stateRelative = relative(archive, stateDir);
    if (stateRelative !== '..' && !stateRelative.startsWith('../') && !isAbsolute(stateRelative)) refuse('journal_inside_archive');
    if (!reverse && !listingComplete) refuse('incomplete_listing');
    if (journal && (journal.archive !== archive || journal.remote !== (settings.rcloneRemote ?? null))) refuse('migration_settings_changed');
    if ((reverse && journal?.phase === 'applying') || (!reverse && journal?.phase === 'rollingBack')) refuse('resume_previous_action');
    const saveJournal = () => writeJson(journalPath(stateDir), journal);
    const listed = new Map();
    for (const doc of docs) {
        const key = `doc:${doc.docId}`;
        if (listed.has(key)) refuse('duplicate_document');
        listed.set(key, doc);
    }

    const moves = reverse || pending ? (journal?.phase === 'rolledBack' ? [] : journal?.moves ?? []) : [];
    let skipped = 0;
    if (!reverse && !pending) {
        for (const [key, doc] of listed) {
            const before = state.units[key];
            const base = providerBase(doc);
            if (!before?.completed || !base) continue;
            const old = pairedPaths(before.files, '기타');
            if (!old) { skipped += 1; continue; }
            const current = listingFingerprint(doc);
            if (!current || before.fingerprint !== current.fingerprint
                || old.some((path, i) => before.files[path] !== current.files[i].byteSize)) { skipped += 1; continue; }

            let destinations;
            for (let n = 1; ; n += 1) {
                destinations = pairPaths(providerFolder, base, n);
                if (destinations.every((path) => !reserved.has(path))) break;
            }
            const files = old.map((path, index) => ({
                old: path, new: destinations[index], hash: current.files[index].sha256.toLowerCase(),
                bytes: before.files[path], forward: {}, reverse: {},
            }));
            const after = { ...before, providerBase: base, files: Object.fromEntries(files.map((file) => [file.new, file.bytes])),
                reservedPaths: [...new Set([...(before.reservedPaths ?? []), ...old])] };
            moves.push({ key, before, after, files });
            destinations.forEach((path) => reserved.add(path));
        }
    }
    if (moves.length === 0) { log({ migration: settings.action, pairs: 0, skipped }); return; }

    const drive = driveFiles(settings, timeout, lockFd);
    const sides = (file) => reverse ? [file.new, file.old, file.reverse] : [file.old, file.new, file.forward];
    for (const move of moves) {
        validateMove(move);
        const entry = state.units[move.key];
        const [from, to] = reverse ? [move.after, move.before] : [move.before, move.after];
        const published = pending && isDeepStrictEqual(entry, to);
        if (!published && !isDeepStrictEqual(entry, from)) refuse('allocation_changed');
        verifyUnshared(state, move.key, [...Object.keys(from.files), ...Object.keys(to.files)]);
        if (!reverse) {
            const doc = listed.get(move.key);
            const current = doc && listingFingerprint(doc);
            if (current?.fingerprint !== move.before.fingerprint || providerBase(doc) !== move.after.providerBase
                || current.files.some((file, index) => file.byteSize !== move.files[index].bytes)) refuse('listing_changed');
        }

        for (const file of move.files) {
            const [source, target, progress] = sides(file);
            if (!await local.verify(source, file) && !(published && progress.removeLocal)) refuse('missing_local_source');
            if (await local.inspect(target)) {
                if (!pending) {
                    // Rollback of an applied batch expects its legacy paths to be absent.
                    refuse('local_target_exists');
                }
                await verifyOwnedTarget(archive, local, journal, file, target, progress, reverse);
            } else if (published || progress.localReady) refuse('missing_local_target');

            const sourceIdentity = await drive.verify(source, file, progress.source);
            if (!sourceIdentity && !(published && progress.removeDrive)) refuse('missing_drive_source');
            if (sourceIdentity) progress.source = sourceIdentity;
            if (await drive.lookup(target)) {
                if (!progress.upload) refuse('drive_target_exists');
                await drive.verify(target, file, progress.destination);
            } else if (published || progress.destination) refuse('missing_drive_target');
        }
    }
    if (dryRun) { log({ migration: settings.action, pairs: moves.length, skipped }); return; }
    if (!pending) {
        if (reverse) {
            journal.phase = 'rollingBack';
        } else {
            const dir = journalDir(stateDir);
            await fs.mkdir(dir, { recursive: true, mode: 0o700 });
            await syncDirectory(stateDir);
            if (journal) await writeJson(resolve(dir, `journal-${journal.id}-${journal.phase}.json`), journal);
            journal = { version: 1, id: randomUUID(), archive, remote: settings.rcloneRemote, phase: 'applying', moves };
            const backupPath = resolve(dir, `pre-state-${journal.id}.json`);
            await writeAtomic(backupPath, await fs.readFile(statePath));
        }
        await saveJournal();
    }

    for (const move of moves) {
        for (const file of move.files) {
            const [source, target, progress] = sides(file);
            await stageLocal({ archive, file, target, source, progress, local, finalPath, journal, reverse, saveJournal });
            let destination = await drive.verify(target, file, progress.destination);
            if (destination && !progress.upload) refuse('drive_target_exists');
            if (!destination) {
                if (progress.destination) refuse('missing_drive_target');
                if (!progress.upload) {
                    progress.upload = true;
                    await saveJournal();
                }
                await drive.copy(finalPath(target), target);
                destination = await drive.verify(target, file);
                if (!destination) refuse('missing_drive_target');
            }
            progress.destination = destination;
            await saveJournal();
        }

        // State points to the new pair only after both local and Drive copies verify.
        const next = reverse ? move.before : move.after;
        if (!isDeepStrictEqual(state.units[move.key], next)) {
            state.units[move.key] = next;
            await saveState();
        }

        for (const file of move.files) {
            const [source, target, progress] = sides(file);
            verifyUnshared(state, move.key, [source]);
            if (Object.hasOwn(state.units[move.key].files, source)) refuse('active_archive_path');
            if (!await local.verify(target, file) || !await drive.verify(target, file, progress.destination)) refuse('missing_verified_target');
            const remoteSource = await drive.verify(source, file, progress.source);
            if (remoteSource) {
                if (!progress.removeDrive) {
                    progress.source = remoteSource;
                    progress.removeDrive = true;
                    await saveJournal();
                }
                // Recheck the exact source after recording intent and before deleting it.
                if (await drive.verify(source, file, progress.source)) await drive.remove(source);
                if (await drive.lookup(source)) refuse('drive_delete_incomplete');
            } else if (!progress.removeDrive) refuse('missing_drive_source');
            if (await local.verify(source, file)) {
                if (!progress.removeLocal) {
                    progress.removeLocal = true;
                    await saveJournal();
                }
                if (await local.verify(source, file)) await fs.unlink(finalPath(source));
                await syncDirectory(dirname(finalPath(source)));
            } else if (!progress.removeLocal) refuse('missing_local_source');
        }
    }
    const stage = stageDir(archive, journal, reverse);
    if (await stageDirectoryExists(stage)) {
        for (const move of moves) {
            for (const file of move.files) {
                const temp = stagePath(archive, journal, reverse, file);
                if (await local.inspect(relative(archive, temp))) await fs.unlink(temp);
            }
        }
        await fs.rmdir(stage);
        await syncDirectory(archive);
    }
    journal.phase = reverse ? 'rolledBack' : 'applied';
    await saveJournal();
    log({ migration: settings.action, pairs: moves.length, skipped });
}

function stageDir(archive, journal, reverse) {
    return resolve(archive, `.provider-contract-${journal.id}-${reverse ? 'rollback' : 'apply'}`);
}

function stagePath(archive, journal, reverse, file) {
    const name = createHash('sha256').update(file.new).digest('hex');
    return resolve(stageDir(archive, journal, reverse), name);
}

async function stageDirectoryExists(path) {
    const info = await probe(path);
    if (info && (!info.isDirectory() || (info.mode & 0o077) !== 0)) refuse('unsafe_staging_directory');
    return Boolean(info);
}

async function verifyOwnedTarget(archive, local, journal, file, target, progress, reverse) {
    const info = await local.verify(target, file);
    if (!info) refuse('missing_local_target');
    if (progress.localReady) {
        if (info.dev !== progress.localReady.dev || info.ino !== progress.localReady.ino) refuse('local_target_collision');
        return;
    }
    const stage = await local.inspect(relative(archive, stagePath(archive, journal, reverse, file)));
    if (!stage || info.dev !== stage.dev || info.ino !== stage.ino) refuse('local_target_collision');
}

async function stageLocal({ archive, file, target, source, progress, local, finalPath, journal, reverse, saveJournal }) {
    if (await local.inspect(target)) {
        await verifyOwnedTarget(archive, local, journal, file, target, progress, reverse);
        if (progress.localReady) return;
    } else {
        const dir = stageDir(archive, journal, reverse);
        const temp = stagePath(archive, journal, reverse, file);
        if (!await stageDirectoryExists(dir)) {
            await fs.mkdir(dir, { mode: 0o700 });
            await syncDirectory(archive);
        }
        // The private, journal-specific stage can contain a partial copy after interruption.
        if (await local.inspect(relative(archive, temp))) await fs.unlink(temp);
        if (!await local.verify(source, file)) refuse('missing_local_source');
        await fs.copyFile(finalPath(source), temp, constants.COPYFILE_EXCL);
        await fs.chmod(temp, 0o600);
        const handle = await fs.open(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await handle.sync(); }
        finally { await handle.close(); }
        if (!await local.verify(relative(archive, temp), file)) refuse('missing_staged_file');
        await syncDirectory(dir);
        await local.inspect(target, true);
        await fs.link(temp, finalPath(target));
        await syncDirectory(dirname(finalPath(target)));
    }
    const verified = await local.verify(target, file);
    if (!verified) refuse('missing_local_target');
    progress.localReady = { dev: verified.dev, ino: verified.ino };
    await saveJournal();
}
