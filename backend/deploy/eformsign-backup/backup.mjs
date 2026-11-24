#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve, relative, basename, dirname, isAbsolute, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
    assertRasterMigration, hasRasterMigrationHistory, migrateProviderContracts, migrationInProgress, preserveMigration, readMigration,
    readPreRasterMigration, replayRasterMigration, restorePreRasterMigration, timerLockDirectory, withTimerLock,
} from './provider-contract-migration.mjs';
import { providerPublication } from './provider-contract-publication.mjs';
import { pairPaths, providerBase, providerFolder, matchesProviderPair, pairedPaths, sanitize, syncDirectory, writeJson } from './provider-contract-paths.mjs';

let token = '';
const cleanReason = (error) => error instanceof SyntaxError ? 'JSON 형식 오류'
    : error?.path ? '보관 파일 작업 실패'
        : String(error?.message ?? error).split(token || '\0').join('[redacted]').slice(0, 500);
const log = (value) => console.log(JSON.stringify(value).split(token || '\0').join('[redacted]'));
const execute = (bin, args) => new Promise((done, reject) => {
    execFile(bin, args, (error) => error ? reject(new Error(`프로세스 실패 (${error.code})`)) : done());
});
const compare = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0);
const types = ['document', 'audit_trail'];
const failureDetailLimit = 200;
const tempPath = (path) => `${path}.${randomUUID()}.tmp`;
const rasterError = (rasterReason) => Object.assign(new Error(rasterReason), { rasterReason });
const documentsFailed = 'raster_archive_documents_failed';
const rasterDocumentReasons = new Set(['RASTER_INVALID_SOURCE', 'RASTER_LIMIT', 'RASTER_RENDER_FAILED', 'RASTER_INVALID_OUTPUT']);
const sha256Pattern = /^[a-f0-9]{64}$/i;
const normalizePath = (path) => path.normalize('NFC');
const relativePdf = (path) => typeof path === 'string' && /\.pdf$/i.test(path) && Buffer.byteLength(path) <= 4095
    && path.split('/').every((part) => part && part !== '.' && part !== '..'
        && !/[\\:\x00-\x1f\x7f]|\p{Cs}/u.test(part) && Buffer.byteLength(part) <= 255);
const rasterReason = (error) => error?.rasterReason ?? error?.migrationReason ?? 'raster_backup_failed';
const within = (parent, path) => {
    const rel = relative(parent, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const privateToWorker = (info) => info.uid === process.getuid() && (info.mode & 0o077) === 0;

async function stat(path) {
    try { return await fs.lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function settingsAndArgs() {
    const args = process.argv.slice(2);
    let settingsPath;
    let limit = Infinity;
    let migration = false;
    let raster = false;
    let rasterArchive = false;
    let action = 'dry-run';
    const seen = new Set();
    for (let i = 0; i < args.length; i += 1) {
        const flag = args[i];
        if (seen.has(flag)) throw new Error('중복 실행 옵션');
        seen.add(flag);
        if (flag === '--settings' && args[i + 1] && !args[i + 1].startsWith('--')) settingsPath = args[++i];
        else if (flag === '--limit' && /^[1-9]\d*$/.test(args[i + 1])) limit = Number(args[++i]);
        else if (flag === '--migrate-provider-contracts') migration = true;
        else if (flag === '--raster') raster = true;
        else if (flag === '--raster-archive') rasterArchive = true;
        else if (['--apply', '--rollback'].includes(flag) && action === 'dry-run') action = flag.slice(2);
        else throw new Error('설정 경로 또는 실행 모드 오류');
    }
    if (!settingsPath || (seen.has('--limit') && (!Number.isSafeInteger(limit) || migration || rasterArchive))
        || (rasterArchive && (migration || raster)) || (!migration && !rasterArchive && action !== 'dry-run')) {
        throw new Error('설정 경로 또는 실행 모드 오류');
    }
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const required = ['apiBaseUrl', 'tokenFile', 'archiveDir', 'stateDir'];
    const allowed = [...required, 'originalArchiveDir', 'rcloneRemote', 'rcloneBin', 'gsBin', 'qpdfBin'];
    if (!settings || Array.isArray(settings) || typeof settings !== 'object' ||
        Object.keys(settings).some((key) => !allowed.includes(key)) ||
        required.some((key) => !Object.hasOwn(settings, key)) ||
        Object.values(settings).some((value) => typeof value !== 'string' || !value.trim())) throw new Error('설정 키 또는 값 오류');
    const url = new URL(settings.apiBaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API URL은 HTTPS 또는 로컬 HTTP여야 합니다');
    return { rcloneBin: 'rclone', gsBin: 'gs', qpdfBin: 'qpdf', ...settings, limit, migration, rasterArchive,
        raster: raster || rasterArchive || Boolean(settings.originalArchiveDir), action };
}

// Validate existing ancestors as well as roots, including roots not created yet.
async function canonicalDirectory(path, privateRoot = false) {
    if (path.includes('\0') || path.split(sep).includes('..')) throw rasterError('unsafe_raster_directory');
    const root = resolve(path);
    let current = sep;
    for (const part of root.split(sep).filter(Boolean)) {
        current = resolve(current, part);
        const info = await stat(current);
        if (!info) break;
        if (!info.isDirectory() || (privateRoot && current === root && !privateToWorker(info))) {
            throw rasterError('unsafe_raster_directory');
        }
    }
    if (root === sep) throw rasterError('unsafe_raster_directory');
    return root;
}

const guardPath = () => resolve(timerLockDirectory(), 'raster-cutover.json');
const cutoverBinding = (settings) => ({ publicRoot: settings.archiveDir, originalRoot: settings.originalArchiveDir,
    stateRoot: settings.stateDir, remote: settings.rcloneRemote ?? null });

async function rasterSettings(settings) {
    const archiveDir = await canonicalDirectory(settings.archiveDir);
    const originalArchiveDir = await canonicalDirectory(settings.originalArchiveDir ?? `${archiveDir}.originals`, true);
    const stateDir = await canonicalDirectory(settings.stateDir, true);
    const lockDir = timerLockDirectory();
    const roots = [archiveDir, originalArchiveDir, stateDir];
    if (roots.some((root, i) => roots.some((other, j) => i !== j && within(root, other)))
        || [archiveDir, originalArchiveDir].some((root) => within(root, lockDir) || within(lockDir, root))) {
        throw rasterError('overlapping_raster_directories');
    }
    const remote = settings.rcloneRemote;
    if (remote && (!/^[^/:\\\u0000-\u001f]+:[^\\\u0000-\u001f]*$/.test(remote)
        || remote.slice(remote.indexOf(':') + 1).split('/').some((part) => part === '.' || part === '..'))) {
        throw rasterError('invalid_raster_remote');
    }
    return { ...settings, archiveDir, originalArchiveDir, stateDir };
}

async function readCutover(settings) {
    // Legacy may reach the shared anchor through a symlink. lstat still sees
    // any marker at that location, including a dangling symlink.
    if (settings.raster) await canonicalDirectory(timerLockDirectory(), true);
    const path = guardPath();
    const info = await stat(path);
    if (!info) return null;
    if (!settings.raster) throw rasterError('raster_cutover_blocks_legacy');
    if (!info.isFile() || !privateToWorker(info) || info.nlink !== 1) throw rasterError('unsafe_raster_cutover');
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let guard;
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || !privateToWorker(opened) || opened.nlink !== 1
            || !sameInode(opened, info)) throw rasterError('unsafe_raster_cutover');
        guard = JSON.parse(await handle.readFile('utf8'));
    } catch { throw rasterError('invalid_raster_cutover'); }
    finally { await handle.close(); }
    const predecessor = guard?.predecessor;
    const oldGuard = guard?.version === 1 && Object.keys(guard).length === 4
        && ['preparing', 'active', 'rollingBack'].includes(guard.phase);
    const initialGuard = guard?.origin === 'fresh' && guard.phase === 'preparing' && guard.publication === 'initial';
    const boundInitialGuard = guard?.version === 3 && initialGuard && Object.keys(guard).length === 8
        && (await import('./raster-mirror-io.mjs')).validBootstrapProof(guard.bootstrap);
    const originGuard = ((guard?.version === 2 && Object.keys(guard).length === 6)
        || (guard?.version === 3 && ((Object.keys(guard).length === 7 && !Object.hasOwn(guard, 'bootstrap'))
                || boundInitialGuard)
            && (guard.publication === 'possible'
                || (guard.origin === 'fresh' && guard.phase === 'preparing'
                    && ['initial', 'capturing'].includes(guard.publication)))))
        && ['preparing', 'partial', 'active', 'rollingBack'].includes(guard.phase)
        && ['fresh', 'existing', 'pausedLegacy'].includes(guard.origin)
        && (guard.origin === 'pausedLegacy'
            ? typeof guard.proofDigest === 'string' && /^[a-f0-9]{64}$/.test(guard.proofDigest)
            : guard.proofDigest === null);
    if ((!oldGuard && !originGuard) || !(predecessor === null || (typeof predecessor?.id === 'string' && /^[a-f\d-]{36}$/.test(predecessor.id)
            && ['applied', 'rolledBack'].includes(predecessor.phase) && Object.keys(predecessor).length === 2))) {
        throw rasterError('invalid_raster_cutover');
    }
    if (!isDeepStrictEqual(guard.binding, cutoverBinding(settings))) throw rasterError('raster_cutover_settings_changed');
    return guard;
}

const sameInode = (info, expected) => info?.dev === expected.dev && info.ino === expected.ino;
const privateMergeFile = (info) => info?.isFile() && privateToWorker(info) && info.nlink === 1;
const mergeGuard = () => rasterError('unsafe_raster_merge_file');
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

async function openMergeFile(path, expected) {
    const info = await stat(path);
    if (!privateMergeFile(info) || (expected && !sameInode(info, expected))) throw mergeGuard();
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat().catch(async (error) => { await handle.close(); throw error; });
    if (privateMergeFile(opened) && sameInode(opened, info)) return { handle, info: opened };
    await handle.close();
    throw mergeGuard();
}

async function createMergeFile(artifact, write) {
    const handle = await fs.open(artifact.tmp, 'wx', 0o600);
    try {
        artifact.info = await handle.stat();
        if (!privateMergeFile(artifact.info)) throw mergeGuard();
        await write(handle);
    } finally { await handle.close(); }
}

async function removeMergeFile({ tmp, info }) {
    if (!info) return;
    const current = await stat(tmp);
    if (!current) return;
    if (!privateMergeFile(current) || !sameInode(current, info)) throw mergeGuard();
    await fs.unlink(tmp);
}

async function copyMergeBytes(source, destination, hash) {
    let bytes = 0;
    for await (const chunk of source.createReadStream({ autoClose: false })) {
        await destination.writeFile(chunk);
        hash?.update(chunk);
        bytes += chunk.length;
    }
    return bytes;
}

async function rasterMerge(bin, stageInputs, target, createdAt) {
    // The system qpdf profile permits ordinary PDFs under /tmp. mkdtemp makes
    // the directory private before any input or output is placed in it.
    const tmpInfo = await fs.lstat('/tmp');
    if (!tmpInfo.isDirectory() || tmpInfo.uid !== 0 || !(tmpInfo.mode & 0o1000)) throw mergeGuard();
    const scratch = await fs.mkdtemp('/tmp/eformsign-backup-qpdf-');
    const created = await fs.lstat(scratch);
    const directory = await fs.open(scratch, directoryFlags);
    const artifacts = [];
    try {
        const root = await directory.stat();
        if (!sameInode(root, created) || root.uid !== process.getuid() || (root.mode & 0o7777) !== 0o700) throw mergeGuard();
        const create = async (name, write) => {
            const artifact = { tmp: `/proc/self/fd/${directory.fd}/${name}`, path: resolve(scratch, name) };
            artifacts.push(artifact);
            await createMergeFile(artifact, write);
            return artifact;
        };
        const inputs = await stageInputs(create);
        const output = await create('merged.pdf', async () => {});
        if (!sameInode(await stat(scratch), root)) throw mergeGuard();
        for (const { path, info } of artifacts) {
            const current = await stat(path);
            if (!privateMergeFile(current) || !sameInode(current, info)) throw mergeGuard();
        }
        await execute(bin, ['--empty', '--pages', ...inputs, '--', output.path]);
        const { handle, info } = await openMergeFile(output.tmp, output.info);
        try {
            if (!info.size) throw rasterError('empty_raster_merge');
            await createMergeFile(target, async (destination) => {
                target.bytes = await copyMergeBytes(handle, destination);
                if (target.bytes !== info.size) throw mergeGuard();
                await destination.chmod(0o600);
                await destination.utimes(new Date(createdAt), new Date(createdAt));
                await destination.sync();
            });
        } finally { await handle.close(); }
    } finally {
        try {
            for (const artifact of artifacts) await removeMergeFile(artifact);
            if (created.isDirectory() && created.uid === process.getuid() && sameInode(await stat(scratch), created)) {
                await fs.rmdir(scratch);
            }
        } finally { await directory.close(); }
    }
}

async function rasterMirror(settings, lockFd) {
    let mirror;
    try { mirror = await import('./raster-mirror.mjs'); }
    catch { throw rasterError('raster_publisher_unavailable'); }
    const { archiveDir, originalArchiveDir, stateDir, rcloneRemote, rcloneBin, gsBin, qpdfBin } = settings;
    const archiveSettings = { archiveDir, originalArchiveDir, stateDir, rcloneRemote, rcloneBin, gsBin, qpdfBin };
    const call = (operation, name) => async (options = {}) => {
        try { return await operation(archiveSettings, { ...options, lockFd }); }
        catch (error) {
            throw describeMirrorFailure(mirror, error, name, options);
        }
    };
    return {
        prepare: call(mirror.prepareRasterArchive, 'prepare'),
        publish: call(mirror.publishRasterArchive, 'publish'),
        rollback: call(mirror.rollbackRasterArchive, 'rollback'),
        async inspect(options) {
            try {
                const observation = await mirror.inspectRasterArchive(archiveSettings, { ...options, lockFd });
                const { manifestPresent, unpublished, retiredPaths, phase } = observation;
                if (Object.keys(observation).length !== 4 || typeof manifestPresent !== 'boolean'
                    || typeof unpublished !== 'boolean' || !Array.isArray(retiredPaths)
                    || !Array.from(retiredPaths).every(relativePdf)
                    || new Set(retiredPaths.map(normalizePath)).size !== retiredPaths.length
                    || (manifestPresent ? unpublished || !['active', 'paused', 'rolling-back'].includes(phase)
                        : phase !== null || retiredPaths.length !== 0)) throw rasterError('raster_inspect_failed');
                return { manifestPresent, unpublished, retiredPaths, phase };
            } catch { throw rasterError('raster_inspect_failed'); }
        },
    };
}

function describeMirrorFailure(mirror, error, name, options) {
    const fallback = rasterError(`raster_${name}_failed`);
    try {
        const description = mirror.describeRasterArchiveError(error);
        if (typeof description?.code !== 'string' || !/^raster_archive_[a-z0-9_]+$/.test(description.code)) return fallback;
        const { code } = description;
        if (code !== documentsFailed) return rasterError(code);
        const { report } = description;
        if (name !== 'publish' || options.dryRun || !Number.isSafeInteger(report?.failedCount) || report.failedCount <= 0
            || !Array.isArray(report.failures) || report.failures.length !== Math.min(report.failedCount, 10)) return fallback;
        const failures = [];
        for (const item of report.failures) {
            const { id, reason } = item;
            if (typeof id !== 'string' || !/^[a-f0-9]{16}$/.test(id) || !rasterDocumentReasons.has(reason)) return fallback;
            failures.push({ docId: `raster:${id}`, reason });
        }
        if (new Set(failures.map(({ docId }) => docId)).size !== failures.length) return fallback;
        return Object.assign(rasterError(code), { rasterReport: { failedFiles: report.failedCount, failures } });
    } catch { return fallback; }
}

function recordRasterFailure(report, error) {
    const result = error.rasterReport;
    if (result) {
        report.failedFiles += result.failedFiles;
        // Reserve space for the bounded raster details in the existing DTO limit.
        report.failures = [...report.failures.slice(0, failureDetailLimit - result.failures.length), ...result.failures];
    }
    log({ reason: rasterReason(error), ...result });
}

async function refusePublicationReceipts(stateDir) {
    for (const name of ['provider-contract-publication.json', 'provider-contract-prepared-stages.json']) {
        if (await stat(resolve(stateDir, name))) throw rasterError('finish_provider_publication_first');
    }
}

async function checkPublicScratch(root) {
    if (!await stat(root)) return;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.endsWith('.tmp')
            || /^\.(?:provider-(?:publication|contract)|raster-mirror)-/.test(entry.name)) {
            throw rasterError('unsafe_public_archive_scratch');
        }
        if (entry.isDirectory()) await checkPublicScratch(resolve(root, entry.name));
    }
}

function validatePredecessor(journal, settings, predecessor = journal) {
    if (!journal || journal.raster !== undefined || journal.archive !== settings.archiveDir
        || journal.remote !== (settings.rcloneRemote ?? null)
        || journal.id !== predecessor?.id || journal.phase !== predecessor?.phase) {
        throw rasterError('foreign_pre_raster_migration');
    }
    if (migrationInProgress(journal)) throw rasterError('finish_legacy_provider_migration_first');
}

async function clearCutover(guard) {
    await fs.unlink(guardPath());
    try { await syncDirectory(timerLockDirectory()); }
    catch (error) {
        await writeJson(guardPath(), guard);
        throw error;
    }
}

async function standaloneRaster(settings, guard, lockFd) {
    const dryRun = settings.action === 'dry-run';
    const rollback = settings.action === 'rollback';
    if (rollback && !guard) throw rasterError('raster_cutover_required');
    if (!rollback && guard?.phase === 'rollingBack') throw rasterError('resume_raster_rollback');
    await refusePublicationReceipts(settings.stateDir);
    const journal = await readMigration(settings.stateDir);
    let predecessor = guard?.predecessor ?? null;
    const legacyJournal = journal && journal.raster === undefined ? journal : null;
    if (legacyJournal) {
        if (!guard) {
            validatePredecessor(legacyJournal, settings);
            predecessor = { id: journal.id, phase: journal.phase };
        } else {
            if (guard.phase !== 'preparing' && !(guard.phase === 'rollingBack' && rollback)) {
                throw rasterError('foreign_pre_raster_migration');
            }
            validatePredecessor(legacyJournal, settings, predecessor);
        }
    } else if (journal) {
        if (!guard) throw rasterError('foreign_pre_raster_migration');
        assertRasterMigration(journal, settings);
        if (journal.raster.pending) throw rasterError('finish_raster_provider_migration_first');
    }
    const preserved = guard?.predecessor && await readPreRasterMigration(settings.stateDir, predecessor);
    if (guard?.predecessor) {
        validatePredecessor(preserved, settings, predecessor);
        if (legacyJournal) await restorePreRasterMigration(settings.stateDir, preserved, { checkOnly: true });
    }
    const beforePublication = guard?.publication === 'initial' || guard?.publication === 'capturing';
    const initial = guard?.publication === 'initial';
    if (!guard || beforePublication) await checkPublicScratch(settings.archiveDir);
    const mirror = await rasterMirror(settings, lockFd);
    const absence = rollback ? undefined : guard ? 'retry' : 'bootstrap';
    const storedBootstrap = guard?.bootstrap ? { bootstrap: guard.bootstrap } : {};
    const inspection = await mirror.inspect({ beforePublication, absence, ...storedBootstrap });
    if (!inspection.manifestPresent && ((guard && (!initial || !inspection.unpublished || journal?.raster))
        || await hasRasterMigrationHistory(settings))) {
        throw rasterError('raster_cutover_manifest_required');
    }
    if (rollback) {
        if (!inspection.manifestPresent) {
            if (preserved) await restorePreRasterMigration(settings.stateDir, preserved);
            await clearCutover(guard);
        } else {
            if (beforePublication) await mirror.rollback({ dryRun: true });
            const rollbackGuard = { ...guard, phase: 'rollingBack', ...(guard.version === 3 && { publication: 'possible' }) };
            delete rollbackGuard.bootstrap;
            await writeJson(guardPath(), rollbackGuard);
            await mirror.rollback();
            if (journal?.raster) await preserveMigration(settings.stateDir, journal, 'post-raster');
            await clearCutover(rollbackGuard);
        }
        log({ rasterArchive: settings.action, exitCode: 0 });
        return;
    }

    const retry = guard?.phase === 'preparing' || guard?.phase === 'partial';
    let origin;
    if (!guard) {
        if (inspection.manifestPresent && inspection.phase === 'paused') origin = 'pausedLegacy';
        else if (inspection.unpublished) origin = 'fresh';
        else throw rasterError('raster_cutover_manifest_conflict');
    } else {
        origin = retry && guard.version >= 2 ? guard.origin : 'existing';
        const pausedRetry = retry && (guard.phase === 'partial' || origin === 'pausedLegacy');
        if (inspection.phase !== 'active' && !(pausedRetry && inspection.phase === 'paused')
            && !(initial && !inspection.manifestPresent)) throw rasterError('raster_cutover_manifest_required');
    }
    const options = { explicitRepublish: true };
    let proofDigest = retry && guard.version >= 2 ? guard.proofDigest : null;
    if (origin === 'pausedLegacy' && guard?.phase !== 'partial') {
        const legacyProofs = await readLegacyProofs(settings.stateDir);
        proofDigest = createHash('sha256').update(JSON.stringify(legacyProofs)).digest('hex');
        if (retry && guard.proofDigest !== proofDigest) throw rasterError('raster_cutover_legacy_proofs_changed');
        options.legacyProofs = legacyProofs;
    }
    const dryOptions = { ...options, dryRun: true };
    const bootstrapId = !dryRun && !guard && origin === 'fresh' && !inspection.manifestPresent ? randomUUID() : null;
    const prepared = await mirror.prepare({ ...dryOptions, ...storedBootstrap, ...(bootstrapId && { bootstrapId }) });
    let bootstrapOptions = storedBootstrap;
    if (bootstrapId) {
        const { validBootstrapProof } = await import('./raster-mirror-io.mjs');
        const bootstrap = prepared?.bootstrap;
        if (!validBootstrapProof(bootstrap) || bootstrap.id !== bootstrapId) throw rasterError('raster_prepare_failed');
        bootstrapOptions = { bootstrap };
    }
    await mirror.publish({ ...dryOptions, ...bootstrapOptions });
    if (dryRun) {
        log({ rasterArchive: settings.action, exitCode: 0 });
        return;
    }

    if (guard?.phase !== 'partial') {
        if (legacyJournal) await preserveMigration(settings.stateDir, legacyJournal, 'pre-raster', false);
        const publication = guard?.publication ?? (!guard && origin === 'fresh' ? 'initial' : 'possible');
        // Install the read-only inventory proof and allocation name in the first durable guard.
        guard = { version: 3, phase: 'preparing', binding: cutoverBinding(settings), predecessor, origin, proofDigest, publication,
            ...bootstrapOptions };
        await writeJson(guardPath(), guard);
    }
    const markPublication = async (publication) => {
        const next = { ...guard, publication };
        delete next.bootstrap;
        await writeJson(guardPath(), next);
        guard = next;
    };
    await fs.mkdir(settings.stateDir, { recursive: true, mode: 0o700 });
    if (legacyJournal) await preserveMigration(settings.stateDir, legacyJournal, 'pre-raster');
    await mirror.prepare(guard.publication === 'initial'
        ? { ...options, ...bootstrapOptions, beforeCapture: () => markPublication('capturing') }
        : options);
    await canonicalDirectory(settings.originalArchiveDir, true);
    // Record the possibility of publication before the mirror can place any
    // derivative. This authority survives loss of both mirror and raw roots.
    if (guard.version === 3 && guard.publication !== 'possible') await markPublication('possible');
    try { await mirror.publish(options); }
    catch (error) {
        if (!error.rasterReport) throw error;
        if (guard.phase !== 'partial') await writeJson(guardPath(), { ...guard, phase: 'partial' });
        log({ rasterArchive: settings.action, status: 'partial', reason: rasterReason(error), ...error.rasterReport, exitCode: 2 });
        process.exitCode = 2;
        return;
    }
    await writeJson(guardPath(), { ...guard, phase: 'active' });
    log({ rasterArchive: settings.action, exitCode: 0 });
}

async function main() {
    let settings = await settingsAndArgs();
    const locked = async (lockFd) => {
        if (settings.raster) settings = await rasterSettings(settings);
        const guard = await readCutover(settings);
        if (settings.rasterArchive) return standaloneRaster(settings, guard, lockFd);
        if (settings.migration) await refusePublicationReceipts(settings.stateDir);
        if (settings.raster && settings.migration && guard?.phase !== 'active') throw rasterError('raster_cutover_required');
        return run(settings, lockFd, guard);
    };
    if (!settings.raster && !settings.migration) return locked();
    try {
        if (settings.raster) await canonicalDirectory(timerLockDirectory(), true);
        await withTimerLock(locked, { privateLock: settings.raster });
    } catch (error) {
        log({ ...(settings.migration ? { migration: settings.action } : settings.rasterArchive
            ? { rasterArchive: settings.action } : { status: 'failed' }),
        reason: settings.raster ? rasterReason(error) : error.rasterReason ?? error.migrationReason ?? 'migration_failed',
        ...(settings.raster && error.rasterReport), exitCode: 1 });
        process.exitCode = 1;
    }
}

async function run(settings, lockFd, guard) {
    const raster = settings.raster;
    const auth = async () => {
        token = (await fs.readFile(settings.tokenFile, 'utf8')).trim();
        if (!token) throw new Error('토큰 파일이 비어 있습니다');
    };
    if (!raster || !settings.migration) await auth();
    const report = {
        startedAt: new Date().toISOString(),
        finishedAt: '',
        status: 'failed',
        limited: settings.limit !== Infinity,
        totalDocs: 0,
        savedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        driveStatus: 'skipped',
        failures: [],
    };
    const timeout = Number(process.env.EFORMSIGN_BACKUP_TIMEOUT_MS ?? 60000);
    const request = (path, init = {}) => fetch(new URL(path, settings.apiBaseUrl), {
        ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
    const reason = raster ? rasterReason : cleanReason;
    const failure = (docId, error) => {
        const explanation = typeof error === 'string' ? error : reason(error);
        report.failures.push({ docId, reason: explanation });
        report.failedFiles += 1;
        log(raster ? { reason: explanation } : { docId, reason: explanation });
    };
    try {
        let mirror;
        let migration;
        if (raster) {
            if (!['active', 'partial'].includes(guard?.phase)) throw rasterError('raster_cutover_required');
            migration = await readMigration(settings.stateDir);
            assertRasterMigration(migration, settings);
            if (settings.migration) {
                if (migration?.raster.pending && settings.action !== (migration.raster.direction === 'forward' ? 'apply' : 'rollback')) {
                    throw rasterError('resume_previous_action');
                }
                if (!migration?.raster.pending && settings.action !== 'rollback') await auth();
            } else if (migrationInProgress(migration)) throw rasterError('resume_previous_action');
            if (!settings.migration || settings.action !== 'dry-run') await syncDirectory(timerLockDirectory());
            mirror = await rasterMirror(settings, lockFd);
        }
        await backup({ settings, lockFd, report, request, reason, failure, timeout, mirror, migration, guard });
    } catch (error) {
        if (!raster || settings.migration) throw error;
        report.status = 'failed';
        report.driveStatus = 'failed';
        recordRasterFailure(report, error);
    }
    if (!settings.migration) await postResult(report, request, reason);
}

function validateStateFiles(files, nullable, validPath) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('state.json 파일 정보 오류');
    const entries = Object.entries(files);
    if (entries.length !== 2 || entries.some(([path, bytes]) => !validPath(path)
        || !(Number.isSafeInteger(bytes) && bytes >= 0 || nullable && bytes === null))) throw new Error('state.json 파일 정보 오류');
    return files;
}

async function readState(statePath, privateState, validateFiles) {
    let loaded = { version: 2, units: {} };
    if (privateState) {
        const info = await stat(statePath);
        if (info) {
            if (!info.isFile() || !privateToWorker(info) || info.nlink !== 1) throw rasterError('unsafe_original_state');
            const handle = await fs.open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
                const opened = await handle.stat();
                if (!opened.isFile() || !privateToWorker(opened) || opened.nlink !== 1
                    || !sameInode(opened, info)) throw rasterError('unsafe_original_state');
                loaded = JSON.parse(await handle.readFile('utf8'));
            } finally { await handle.close(); }
        }
    } else {
        try { loaded = JSON.parse(await fs.readFile(statePath, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!loaded || ![1, 2].includes(loaded.version) || !loaded.units || typeof loaded.units !== 'object' || Array.isArray(loaded.units)) throw new Error('state.json 형식 오류');
    // Version 1 keyed a unit by its content hashes; version 2 keys it by the document.
    const migrate = (units) => {
        const migrated = {};
        for (const [oldKey, unit] of Object.entries(units)) {
            if (!unit) throw new Error('state.json 파일 정보 오류');
            const files = validateFiles(unit.files, false);
            const doc = /^doc:(.+):([0-9a-fA-F]+):([0-9a-fA-F]+)$/.exec(oldKey);
            const merged = /^merged:(.+:\d+):([0-9a-fA-F,]+)$/.exec(oldKey);
            const [newKey, fingerprint] = doc ? [`doc:${doc[1]}`, `${doc[2]}:${doc[3]}`]
                : merged ? [`merged:${merged[1]}`, `v1:${merged[2]}`] : [null, null];
            if (newKey === null || Object.hasOwn(migrated, newKey)) throw new Error('state.json 형식 오류');
            migrated[newKey] = { files, fingerprint, completed: true }; // version 1 only ever saved completed documents
        }
        return migrated;
    };
    return { version: 2, units: loaded.version === 1 ? migrate(loaded.units) : loaded.units };
}

async function readLegacyProofs(stateDir) {
    const { units } = await readState(resolve(stateDir, 'state.json'), true,
        (files, nullable) => validateStateFiles(files, nullable, relativePdf));
    const claims = new Map();
    for (const entry of Object.values(units)) {
        if (!entry || typeof entry.completed !== 'boolean' || typeof entry.fingerprint !== 'string') {
            throw rasterError('invalid_original_state');
        }
        validateStateFiles(entry.files, true, relativePdf);
        const reservations = entry.reservedPaths === undefined ? [] : entry.reservedPaths;
        if (!Array.isArray(reservations) || !reservations.every(relativePdf)) throw rasterError('invalid_original_state');
        const paths = new Set([...Object.keys(entry.files), ...reservations].map(normalizePath));
        for (const path of paths) claims.set(path, (claims.get(path) ?? 0) + 1);
    }
    const proofs = [];
    const folders = [providerFolder, '기타', '서비스계약서', '제공기록지', '제공기록지/원본'];
    for (const [key, entry] of Object.entries(units)) {
        if (!/^doc:[^@]+$/.test(key)) continue;
        const paths = folders.map((folder) => pairedPaths(entry.files, folder)).find(Boolean);
        const hashes = entry.fingerprint.split(':');
        if (!paths || hashes.length !== 2 || !sha256Pattern.test(hashes[0])
            || (entry.completed || hashes[1] !== '' ? !sha256Pattern.test(hashes[1]) : entry.files[paths[1]] !== null)
            || paths.some((path) => claims.get(normalizePath(path)) !== 1)) continue;
        for (const [i, path] of paths.entries()) {
            if (hashes[i] && Number.isSafeInteger(entry.files[path])) {
                proofs.push({ path, sha256: hashes[i].toLowerCase(), size: entry.files[path] });
            }
        }
    }
    return proofs.sort((a, b) => a.path < b.path ? -1 : Number(a.path > b.path));
}

async function backup({ settings, lockFd, report, request, reason, failure, timeout, mirror, migration, guard }) {
    const rawRoot = mirror ? settings.originalArchiveDir : settings.archiveDir;
    if (!settings.migration && !mirror) {
        await fs.mkdir(settings.archiveDir, { recursive: true });
        await fs.mkdir(settings.stateDir, { recursive: true });
    }
    const archive = await fs.realpath(rawRoot).catch((error) => {
        if (settings.migration && error.code === 'ENOENT') return resolve(rawRoot);
        throw error;
    });
    if (mirror) {
        if (archive !== rawRoot) throw rasterError('unsafe_raster_directory');
        await canonicalDirectory(archive, true);
    }
    const inside = (path) => {
        const rel = relative(archive, path);
        if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('보관 경로 이탈');
        return path;
    };
    const finalPath = (path) => inside(resolve(archive, path));
    const validStatePath = (path) => typeof path === 'string' && finalPath(path) && (!mirror
        || (path.endsWith('.pdf') && path.split('/').every((part) => part && !part.startsWith('.') && !part.includes('\\'))));
    const checkParents = async (final, create = false, durable = false) => {
        let parent = archive;
        for (const part of relative(archive, dirname(final)).split('/').filter(Boolean)) {
            parent = resolve(parent, part);
            const info = await stat(parent);
            if (info) {
                if (!info.isDirectory() || (mirror && info.uid !== process.getuid())) throw new Error('일반 디렉터리가 아닌 보관 경로');
            } else {
                if (!create) return false;
                await fs.mkdir(parent, mirror ? { mode: 0o700 } : { recursive: true });
            }
            inside(resolve(await fs.realpath(parent), 'placeholder'));
            if (durable || (mirror && !info)) await syncDirectory(dirname(parent));
        }
        return true;
    };
    const size = async (path) => {
        const final = finalPath(path);
        try {
            if (mirror && !await checkParents(final)) return null;
            const info = await fs.lstat(final);
            inside(await fs.realpath(final));
            if (!info.isFile() || (mirror && (info.uid !== process.getuid() || info.nlink !== 1))) throw new Error('일반 파일이 아닌 보관 경로');
            return info.size;
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    const prepare = async (path, durable = false, create = true) => {
        const final = finalPath(path);
        // Check each parent before creating the next one: a preexisting symlink
        // must not cause mkdir or a temporary write outside the archive.
        await checkParents(final, create, durable);
        return final;
    };
    const statePath = resolve(settings.stateDir, 'state.json');
    const validFiles = (files, nullable) => validateStateFiles(files, nullable, validStatePath);
    const state = await readState(statePath, Boolean(mirror), validFiles);
    const saveState = () => writeJson(statePath, state);
    const reserved = new Set();
    const reserve = mirror ? normalizePath : (path) => path;
    for (const unit of Object.values(state.units)) {
        if (!unit || typeof unit.fingerprint !== 'string' || typeof unit.completed !== 'boolean') throw new Error('state.json 파일 정보 오류');
        for (const path of Object.keys(validFiles(unit.files, true))) reserved.add(reserve(path));
        if (unit.reservedPaths !== undefined) {
            if (!Array.isArray(unit.reservedPaths) || unit.reservedPaths.some((path) => !validStatePath(path))) {
                throw new Error('state.json 예약 경로 오류');
            }
            for (const path of unit.reservedPaths) reserved.add(reserve(path));
        }
    }
    if (!mirror) migration = await readMigration(settings.stateDir);
    const publication = providerPublication({ archive, statePath, state, saveState, prepare, fetchInto, raster: Boolean(mirror) });
    if (!settings.migration) {
        if (migrationInProgress(migration)) throw new Error('제공인력 계약서 이동 재시도 필요');
        // Finish owned final links before the mirror can inspect private originals.
        report.savedFiles += await publication.resume();
    }
    const partial = guard?.phase === 'partial';
    const ordinaryOptions = partial ? { explicitRepublish: true } : undefined;
    const inspection = mirror && await mirror.inspect();
    if (inspection && (!inspection.manifestPresent
        || (inspection.phase !== 'active' && !(partial && inspection.phase === 'paused')))) {
        throw rasterError('raster_cutover_manifest_required');
    }
    const retired = new Set(inspection ? inspection.retiredPaths.map(normalizePath) : []);
    const migrationContext = { settings, archive, statePath, state, reserved, retired, saveState, migration, finalPath,
        timeout, lockFd, log, mirror, predecessor: guard?.predecessor };
    const resumingRasterMigration = mirror && migration?.raster.pending;
    if (resumingRasterMigration && !migrationInProgress(migration)) {
        await replayRasterMigration(migrationContext);
        if (settings.migration) {
            log({ migration: settings.action, pairs: migration.moves.length, skipped: 0 });
            return;
        }
    }
    if (!settings.migration) {
        if (mirror) await mirror.prepare(ordinaryOptions);
        await saveState();
    }

    // Gather pages before naming: API cursor order differs from createdAt order.
    const docs = [];
    let listingComplete = false;
    let listingFailed = false;
    const gather = async () => {
        let cursor = null;
        const seen = new Set();
        do {
            const query = new URLSearchParams({ limit: '200' });
            if (cursor !== null) query.set('cursor', String(cursor));
            const response = await request(`/internal/eformsign-backup/documents?${query}`);
            if (response.status !== 200) throw new Error(`목록 HTTP ${response.status}`);
            const page = await response.json();
            const remaining = settings.limit - docs.length;
            docs.push(...page.items.slice(0, remaining));
            if (mirror && page.items.length > remaining) return;
            cursor = page.nextCursor;
            if (cursor !== null && seen.has(cursor)) throw new Error('목록 커서 반복');
            seen.add(cursor);
        } while (cursor !== null && docs.length < settings.limit);
        listingComplete = cursor === null;
    };
    if (settings.action !== 'rollback' && !(settings.migration && resumingRasterMigration)) {
        try { await gather(); }
        catch (error) {
            listingFailed = true;
            if (!settings.migration) log({ reason: mirror ? 'raster_listing_failed' : reason(error) });
        }
    }
    report.totalDocs = docs.length;
    docs.sort(compare);
    if (settings.migration) {
        return migrateProviderContracts({ ...migrationContext, docs, listingComplete });
    }
    if (mirror && listingFailed) {
        report.status = 'failed';
        report.driveStatus = 'failed';
        return;
    }

    const units = [];
    const groups = new Map();
    for (const doc of docs) {
        const [documents, audits] = types.map((type) => doc.files.filter((file) => file.fileType === type));
        // A document still in review has no audit trail yet: eformsign produces it on completion.
        const review = doc.completed === false;
        if (doc.files.length !== documents.length + audits.length || documents.length !== 1 ||
            (review ? audits.length > 1 : audits.length !== 1)) { failure(doc.docId, '필수 파일 없음'); continue; }
        const inputs = [documents[0], audits[0] ?? null];
        const chunk = doc.kind === 'service_record' && doc.serviceRecordChunk?.chunkCount > 1 ? doc.serviceRecordChunk : null;
        const desiredProviderBase = providerBase(doc);
        const entry = state.units[`doc:${doc.docId}`];
        const previousProviderBase = typeof entry?.providerBase === 'string' && matchesProviderPair(entry.files, entry.providerBase)
            ? entry.providerBase : null;
        const contractBase = desiredProviderBase ?? (doc.kind === 'other' ? previousProviderBase : null);
        const folder = contractBase ? providerFolder
            : doc.kind === 'contract' ? '서비스계약서' : doc.kind === 'service_record' ? '제공기록지' : '기타';
        const base = contractBase ?? (doc.kind === 'other'
            ? sanitize(doc.title || '문서명미상') || '문서명미상'
            : `${folder}_${sanitize(doc.customerName || '고객미상')}_${sanitize(doc.serviceStartDate || '시작일미상')}`);
        const unit = {
            ...doc,
            key: `doc:${doc.docId}`,
            fingerprint: `${inputs[0].sha256}:${inputs[1]?.sha256 ?? ''}`,
            completed: !review,
            inputs,
            folder: chunk ? `${folder}/원본` : folder,
            base: chunk ? `${base}_${chunk.chunkIndex + 1}장` : base,
            baseName: base,
            providerBase: contractBase,
            desiredProviderBase,
        };
        units.push(unit);
        if (chunk) {
            const groupKey = JSON.stringify([chunk.caseId, chunk.snapshotVersion]);
            if (!groups.has(groupKey)) groups.set(groupKey, []);
            groups.get(groupKey).push(unit);
        }
    }
    // Incomplete groups retain originals and wait for a later listing.
    const merges = [];
    for (const chunks of groups.values()) {
        const count = chunks[0].serviceRecordChunk.chunkCount;
        const indices = new Set(chunks.map((unit) => unit.serviceRecordChunk.chunkIndex));
        if (chunks.length !== count || indices.size !== count || chunks.some((unit) => unit.serviceRecordChunk.chunkCount !== count) ||
            [...indices].some((i) => !Number.isInteger(i) || i < 0 || i >= count)) continue;
        chunks.sort((a, b) => a.serviceRecordChunk.firstSessionIndex - b.serviceRecordChunk.firstSessionIndex);
        const first = chunks[0];
        merges.push({ docId: first.docId, createdAt: first.createdAt, folder: '제공기록지', base: first.baseName, chunks,
            key: `merged:${first.serviceRecordChunk.caseId}:${first.serviceRecordChunk.snapshotVersion}`,
            fingerprint: chunks.map((unit) => unit.fingerprint).join(',') });
    }
    // Reserve both paths together, including merged units in naming order.
    // Reservations become persistent only after a unit writes a file.
    const allocate = async (unit) => {
        const entry = Object.hasOwn(state.units, unit.key) ? state.units[unit.key] : null;
        // Completed content is never overwritten: changed content takes a fresh pair of paths (the old
        // entry is archived under another key when the new files are recorded). Review-stage content
        // is rewritten in place.
        const reallocate = entry !== null && !entry.completed && unit.desiredProviderBase
            && !matchesProviderPair(entry.files, unit.desiredProviderBase);
        unit.fork = entry !== null && (reallocate || entry.completed && entry.fingerprint !== unit.fingerprint);
        if (entry !== null && !unit.fork) { unit.files = { ...entry.files }; return; }
        for (let n = 1; ; n += 1) {
            const paths = pairPaths(unit.folder, unit.base, n);
            if (paths.some((path) => reserved.has(reserve(path)) || retired.has(normalizePath(path)))
                || await size(paths[0]) !== null || await size(paths[1]) !== null) continue;
            // Expected sizes for a new document unit; null = nothing to write there yet (the audit trail of a
            // document still in review, a merged output not built yet). The audit path stays reserved either way.
            unit.files = Object.fromEntries(paths.map((path, i) => [path, unit.inputs?.[i]?.byteSize ?? null]));
            paths.forEach((path) => reserved.add(reserve(path)));
            return;
        }
    };
    for (const unit of [...units, ...merges].sort(compare)) {
        try { await allocate(unit); }
        catch (error) { unit.broken = true; failure(unit.docId, error); }
    }
    async function fetchInto(file, handle) {
        const response = await request(`/internal/eformsign-backup/files/${encodeURIComponent(file.fileId)}`);
        if (response.status !== 200) {
            await response.body?.cancel();
            throw mirror ? rasterError(`file_http_${response.status}`) : new Error(`파일 HTTP ${response.status}`);
        }
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of response.body) {
            hash.update(chunk);
            bytes += chunk.length;
            await handle.writeFile(chunk);
        }
        if (bytes !== file.byteSize || hash.digest('hex') !== file.sha256.toLowerCase()) {
            throw mirror ? rasterError('original_sha256_or_size_mismatch') : new Error('파일 크기 또는 sha256 불일치');
        }
    }
    // A file is written beside its final path first, so a failed download never touches an existing file.
    const fetchTemp = async (file, path, createdAt) => {
        const final = await prepare(path);
        const tmp = tempPath(final);
        try {
            const handle = await fs.open(tmp, 'wx', 0o600);
            try {
                await fetchInto(file, handle);
                if (mirror) await handle.utimes(new Date(createdAt), new Date(createdAt));
                if (mirror || path.startsWith(`${providerFolder}/`)) await handle.sync();
            } finally { await handle.close(); }
            if (!mirror) await fs.utimes(tmp, new Date(createdAt), new Date(createdAt));
            return { tmp, final };
        } catch (error) { await fs.rm(tmp, { force: true }); throw error; }
    };
    const verifyOriginal = async (path, input) => {
        const handle = await fs.open(finalPath(path), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const hash = createHash('sha256');
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            if (hash.digest('hex') !== input.sha256.toLowerCase()) throw rasterError('original_sha256_mismatch');
        } finally { await handle.close(); }
    };
    // Shared by documents and merges. `replace` = the recorded fingerprint differs, so every available
    // output is rewritten over its recorded path; otherwise only missing files are (re)created.
    const plan = async (unit, available) => {
        const paths = Object.keys(unit.files);
        const entry = unit.fork ? undefined : state.units[unit.key];
        const replace = Boolean(entry) && entry.fingerprint !== unit.fingerprint;
        const sizes = await Promise.all(paths.map(size));
        if (!replace) {
            for (let i = 0; i < paths.length; i += 1) {
                if (sizes[i] !== null && sizes[i] !== unit.files[paths[i]]) {
                    throw mirror ? rasterError('original_state_size_mismatch') : new Error('기존 파일 크기 불일치');
                }
                if (mirror && sizes[i] !== null && unit.inputs?.[i]) await verifyOriginal(paths[i], unit.inputs[i]);
            }
        }
        const need = paths.map((_, i) => Boolean(available[i]) && (replace || sizes[i] === null));
        return { paths, replace, sizes, need };
    };
    // Merged output counts as completed only when every chunk is and the merged audit trail exists.
    const isCompleted = (unit) => unit.chunks
        ? unit.chunks.every((chunk) => chunk.completed) && unit.files[Object.keys(unit.files)[1]] !== null
        : unit.completed;
    const recordedUnit = (unit, old) => {
        // Recording to the same paths can only tighten the flag; a fork is a new entry with its own flag.
        const completed = isCompleted(unit) || (!unit.fork && old?.completed === true);
        const provider = unit.providerBase && matchesProviderPair(unit.files, unit.providerBase)
            ? { providerBase: unit.providerBase } : {};
        return { ...old, files: unit.files, fingerprint: unit.fingerprint, completed, ...provider };
    };
    const historicalKey = (unit, old) => {
        const prefix = `${unit.key}@${old.fingerprint}`;
        let key = prefix;
        for (let n = 2; Object.hasOwn(state.units, key); n += 1) key = `${prefix}@${n}`;
        return key;
    };
    const record = async (unit) => {
        const old = state.units[unit.key];
        const archived = unit.fork ? historicalKey(unit, old) : null;
        if (archived) state.units[archived] = old;
        state.units[unit.key] = recordedUnit(unit, old);
        try { await saveState(); }
        catch (error) {
            if (!error.statePublished) {
                if (archived) delete state.units[archived];
                if (old) state.units[unit.key] = old;
                else delete state.units[unit.key];
            }
            throw error;
        }
        unit.fork = false;
    };
    // Same content, now reported as completed: tighten the stored flag (never loosen it).
    const tighten = async (unit) => {
        const entry = state.units[unit.key];
        if (unit.fork || !entry || entry.completed || entry.fingerprint !== unit.fingerprint || !isCompleted(unit)) return;
        entry.completed = true;
        await saveState();
    };
    // Keep expected sizes for both paths even when a download fails mid-pair,
    // so the next run repairs the missing file under its recorded name.
    for (const unit of units) {
        if (unit.broken) continue;
        let changed = false;
        let unitError;
        try {
            const { paths, replace, sizes, need } = await plan(unit, unit.inputs);
            if (!need.some(Boolean)) {
                report.skippedFiles += sizes.filter((bytes) => bytes !== null).length;
                unit.ready = true;
                await tighten(unit);
                continue;
            }
            if (unit.fork && (unit.providerBase || mirror)) {
                const before = state.units[unit.key];
                report.savedFiles += await publication.publish({
                    key: unit.key, before, history: historicalKey(unit, before), next: recordedUnit(unit, before),
                    inputs: unit.inputs, createdAt: unit.createdAt, generic: !unit.providerBase,
                });
                unit.fork = false;
            } else if (replace || unit.fork) {
                const temps = [];
                const renamed = [];
                try {
                    for (let i = 0; i < paths.length; i += 1) {
                        if (need[i]) temps.push({ i, ...await fetchTemp(unit.inputs[i], paths[i], unit.createdAt) });
                    }
                    for (const { i, tmp, final } of temps) {
                        if (unit.fork) await fs.link(tmp, final);
                        else await fs.rename(tmp, final);
                        renamed.push(final);
                        if (mirror) await syncDirectory(dirname(final));
                        unit.files[paths[i]] = unit.inputs[i].byteSize;
                        report.savedFiles += 1;
                    }
                    changed = true;
                } catch (error) {
                    // A fork writes only fresh, never-recorded paths: undo them so the next run retries cleanly.
                    if (unit.fork && !error.statePublished) {
                        await Promise.all(renamed.map((final) => fs.rm(final, { force: true })));
                        report.savedFiles -= renamed.length;
                    }
                    throw error;
                } finally { await Promise.all(temps.map(({ tmp }) => fs.rm(tmp, { force: true }))); }
            } else {
                for (let i = 0; i < paths.length; i += 1) {
                    if (!need[i]) continue;
                    const { tmp, final } = await fetchTemp(unit.inputs[i], paths[i], unit.createdAt);
                    try { await fs.rename(tmp, final); } finally { await fs.rm(tmp, { force: true }); }
                    if (mirror) await syncDirectory(dirname(final));
                    unit.files[paths[i]] = unit.inputs[i].byteSize;
                    report.savedFiles += 1;
                    changed = true;
                }
            }
            unit.ready = true;
        } catch (error) { unitError = error; }
        finally {
            if (changed) {
                try { await record(unit); } catch (error) { unit.ready = false; unitError ??= error; }
            }
        }
        if (unitError) {
            if (publication.pending) throw unitError;
            failure(unit.docId, unitError);
            if (['original_state_size_mismatch', 'original_sha256_mismatch'].includes(unitError.rasterReason)) throw unitError;
        }
    }
    // Prepare both merged outputs before publishing either final path. The merged audit trail exists
    // only once every chunk has one.
    for (const unit of merges) {
        if (unit.broken || !unit.chunks.every((chunk) => chunk.ready)) continue;
        const temps = [];
        const renamed = [];
        let changed = false;
        let unitError;
        try {
            const { paths, replace, sizes, need } = await plan(unit, [true, unit.chunks.every((chunk) => chunk.inputs[1])]);
            if (!need.some(Boolean)) {
                report.skippedFiles += sizes.filter((bytes) => bytes !== null).length;
                await tighten(unit);
                continue;
            }
            for (let i = 0; i < paths.length; i += 1) {
                if (!need[i]) continue;
                const final = await prepare(paths[i]);
                const tmp = tempPath(final);
                const target = { tmp, final, path: paths[i] };
                temps.push(target);
                if (mirror) {
                    target.parent = await fs.open(dirname(final), directoryFlags);
                    target.parentInfo = await target.parent.stat();
                    if (target.parentInfo.uid !== process.getuid()
                        || !sameInode(await stat(dirname(final)), target.parentInfo) || !await checkParents(final)) {
                        throw mergeGuard();
                    }
                    const parentRef = `/proc/self/fd/${target.parent.fd}`;
                    target.tmp = resolve(parentRef, basename(tmp));
                    target.finalRef = resolve(parentRef, basename(final));
                    await rasterMerge(settings.qpdfBin, async (create) => {
                        const inputs = [];
                        for (const [index, chunk] of unit.chunks.entries()) {
                            const source = finalPath(Object.keys(chunk.files)[i]);
                            if (!await checkParents(source)) throw mergeGuard();
                            const { handle, info } = await openMergeFile(source);
                            try {
                                if (!await checkParents(source) || !sameInode(await stat(source), info)) throw mergeGuard();
                                const input = chunk.inputs[i];
                                const hash = createHash('sha256');
                                const staged = await create(`input-${index + 1}.pdf`, async (destination) => {
                                    const bytes = await copyMergeBytes(handle, destination, hash);
                                    if (bytes !== input.byteSize || hash.digest('hex') !== input.sha256.toLowerCase()) {
                                        throw rasterError('original_sha256_mismatch');
                                    }
                                });
                                inputs.push(staged.path);
                            } finally { await handle.close(); }
                        }
                        return inputs;
                    }, target, unit.createdAt);
                } else {
                    const inputs = unit.chunks.map((chunk) => finalPath(Object.keys(chunk.files)[i]));
                    await execute(settings.qpdfBin, ['--empty', '--pages', ...inputs, '--', tmp]);
                    target.bytes = (await fs.stat(tmp)).size;
                    await fs.utimes(tmp, new Date(unit.createdAt), new Date(unit.createdAt));
                }
            }
            try {
                for (const item of temps) {
                    const { tmp, final, path, bytes, info, finalRef, parentInfo } = item;
                    if (mirror) {
                        if (!await checkParents(final) || !sameInode(await stat(dirname(final)), parentInfo)) throw mergeGuard();
                        const current = await stat(tmp);
                        if (!privateMergeFile(current) || !sameInode(current, info) || current.size !== bytes) throw mergeGuard();
                    }
                    await fs.rename(tmp, finalRef ?? final);
                    renamed.push(item);
                    if (mirror) await item.parent.sync();
                    unit.files[path] = bytes;
                    report.savedFiles += 1;
                    // A partial rewrite must not mark the new fingerprint as done; a fork is all or nothing.
                    if (!replace && !unit.fork) changed = true;
                }
            } catch (error) {
                if (unit.fork) {
                    await Promise.all(renamed.map((item) => mirror
                        ? removeMergeFile({ ...item, tmp: item.finalRef })
                        : fs.rm(item.final, { force: true })));
                    report.savedFiles -= renamed.length;
                }
                throw error;
            }
            changed = true;
        } catch (error) { unitError = error; }
        finally {
            for (const item of temps) {
                try {
                    if (mirror) await removeMergeFile(item);
                    else await fs.rm(item.tmp, { force: true });
                } catch (error) { unitError ??= error; }
                try { await item.parent?.close(); } catch (error) { unitError ??= error; }
            }
            if (changed) {
                try { await record(unit); } catch (error) { unitError ??= error; }
            }
        }
        if (unitError) {
            failure(unit.docId, unitError);
            if (unitError.rasterReason === 'original_state_size_mismatch') throw unitError;
        }
    }
    let published = false;
    if (mirror) {
        try {
            await mirror.publish(ordinaryOptions);
            published = true;
            if (settings.rcloneRemote) report.driveStatus = 'ok';
        } catch (error) {
            if (settings.rcloneRemote) report.driveStatus = 'failed';
            recordRasterFailure(report, error);
        }
        if (partial && !resumingRasterMigration && listingComplete && report.failedFiles === 0 && published) {
            await writeJson(guardPath(), { ...guard, phase: 'active' });
        }
    } else if (settings.rcloneRemote) {
        try { await execute(settings.rcloneBin, ['copy', '--checksum', settings.archiveDir, settings.rcloneRemote, '--include', '*.pdf']); report.driveStatus = 'ok'; }
        catch (error) { report.driveStatus = 'failed'; log({ reason: `Drive: ${cleanReason(error)}` }); }
    }
    report.status = listingFailed ? 'failed' : !listingComplete || report.failedFiles || report.driveStatus !== 'ok' ? 'partial' : 'success';
}

async function postResult(report, request, reason) {
    report.finishedAt = new Date().toISOString();

    // Result submission is the only operation with a retry.
    let posted = false;
    for (let attempt = 0; attempt < 2 && !posted; attempt += 1) {
        try {
            const response = await request('/internal/eformsign-backup/runs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...report, failures: report.failures.slice(0, failureDetailLimit) }),
            });
            await response.body?.cancel();
            if (response.status !== 201) throw new Error(`결과 POST HTTP ${response.status}`);
            posted = true;
        } catch (error) { log({ reason: reason(error) }); }
    }
    const exitCode = !posted ? 3 : { success: 0, failed: 1, partial: 2 }[report.status];
    log({ status: report.status, totalDocs: report.totalDocs, savedFiles: report.savedFiles,
        skippedFiles: report.skippedFiles, failedFiles: report.failedFiles, driveStatus: report.driveStatus, exitCode });
    process.exitCode = exitCode;
}

main().catch((error) => {
    log({ reason: error.rasterReason ?? cleanReason(error) });
    log({ status: 'failed', exitCode: 1 });
    process.exitCode = 1;
});
