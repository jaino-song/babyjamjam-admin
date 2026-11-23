#!/usr/bin/env node
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';

import { timerLockDirectory } from './provider-contract-migration.mjs';

const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK, O_NOATIME } = fs.constants;
const directoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW;
const fileFlags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_NOATIME;
const statOptions = { bigint: true };
const temporaryParents = ['/tmp', '/var/tmp'];
const uid = BigInt(process.getuid?.() ?? 0);
const application = dirname(fileURLToPath(import.meta.url));
const mode = (info) => Number(info.mode & 0o7777n);
const sameInode = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

class Refusal extends Error {}
const refuse = (reason) => { throw new Refusal(reason); };

function absolute(path) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path !== path.trim()
        || /[\\\u0000-\u001f\u007f]/.test(path)) refuse('ambiguous_path');
    return path;
}

const within = (parent, path) => {
    const rel = relative(parent, path);
    return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
const overlaps = (a, b) => within(a, b) || within(b, a);

function lstat(path) {
    try { return fs.lstatSync(path, statOptions); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function args() {
    const [option, settings, apply, ...rest] = process.argv.slice(2);
    if (option !== '--settings' || !settings || (apply !== undefined && apply !== '--apply') || rest.length) {
        refuse('invalid_arguments');
    }
    return { settings: absolute(settings), apply: apply === '--apply' };
}

function settingsPaths(fd) {
    let settings;
    try { settings = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch { refuse('invalid_settings'); }
    if (!object(settings)) refuse('invalid_settings');
    const archive = absolute(settings.archiveDir);
    return {
        archive,
        originals: absolute(settings.originalArchiveDir ?? archive + '.originals'),
        state: absolute(settings.stateDir),
        token: absolute(settings.tokenFile),
    };
}

function attributableState(fd) {
    let state;
    try { state = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch { refuse('invalid_backup_state'); }
    if (!object(state) || ![1, 2].includes(state.version) || !object(state.units)) refuse('invalid_backup_state');
    const validPath = (path) => path.endsWith('.pdf')
        && path.split('/').every((part) => part && !part.startsWith('.') && !/[\\\u0000-\u001f\u007f]/.test(part));
    for (const [key, unit] of Object.entries(state.units)) {
        if (!object(unit) || !object(unit.files)) refuse('invalid_backup_state');
        const files = Object.entries(unit.files);
        if (files.length !== 2 || files.some(([path, bytes]) => !validPath(path)
            || !(Number.isSafeInteger(bytes) && bytes >= 0 || state.version === 2 && bytes === null))) {
            refuse('invalid_backup_state');
        }
        if (state.version === 1) {
            if (!/^(?:doc:.+:[\da-f]+:[\da-f]+|merged:.+:\d+:[\da-f,]+)$/i.test(key)) refuse('invalid_backup_state');
        } else if (!/^(?:doc|merged):.+$/.test(key) || typeof unit.fingerprint !== 'string' || typeof unit.completed !== 'boolean'
            || (unit.reservedPaths !== undefined && (!Array.isArray(unit.reservedPaths)
                || unit.reservedPaths.some((path) => typeof path !== 'string' || !validPath(path))))) {
            refuse('invalid_backup_state');
        }
    }
}

function projectRoot(from) {
    for (let current = from; current !== '/'; current = dirname(current)) {
        if (lstat(resolve(current, '.git'))) return current;
    }
    return null;
}

function checkScope(target, home, protectedPaths) {
    const actualHome = userInfo().homedir;
    const projects = [projectRoot(application), projectRoot(process.cwd())].filter(Boolean);
    const userWide = ['.config', '.local', '.local/share', '.local/state', '.cache', '.ssh', '.gnupg',
        'Desktop', 'Documents', 'Downloads', 'Development', 'Pictures', 'Music', 'Videos', 'Public', 'Templates'];
    const systemTrees = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr'];
    const systemRoots = ['/var/tmp', '/var/lib', '/var/log', '/var/cache', '/var/spool'];
    if (dirname(target) === '/' || target === '/' || systemRoots.includes(target)
        || [home, actualHome, process.cwd()].some((path) => within(target, path))
        || [home, actualHome].some((path) => userWide.some((entry) => target === resolve(path, entry)))
        || systemTrees.some((path) => overlaps(path, target))
        || [application, resolve(home, 'eformsign-backup'), ...projects, ...protectedPaths]
            .some((path) => overlaps(path, target))) {
        refuse('out_of_scope_path');
    }
}

// Each path component below / is reached from a retained no-follow directory FD.
const ref = (entry) => `/proc/self/fd/${entry.fd}`;

function unchanged(before, after) {
    return after && sameInode(before, after) && before.uid === after.uid && before.gid === after.gid && before.mode === after.mode
        && (!before.isFile() || (before.nlink === after.nlink && before.size === after.size
            && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs));
}

function main(report) {
    if (process.platform !== 'linux' || uid === 0n || uid !== BigInt(process.geteuid()) || !O_NOATIME) {
        refuse('unsupported_operator');
    }
    const options = args();
    const home = absolute(homedir());
    const operator = userInfo();
    const knownHome = home === operator.homedir || temporaryParents.includes(dirname(home));
    const primaryGid = BigInt(operator.gid);
    const lock = absolute(timerLockDirectory());
    const entries = new Map();
    const fds = [];
    const safeDirectory = (path, info, ancestor) => {
        if (!info?.isDirectory() || (info.uid !== uid && info.uid !== 0n)) refuse('unsafe_directory');
        const permissions = mode(info);
        // Standard sticky temporary parents protect their named children from other users.
        if (temporaryParents.includes(path) && info.uid === 0n && permissions === 0o1777) return;
        if (!(permissions & 0o7022)) return;
        // HOME must already have passed the strict walk and be owned by the operator.
        if (ancestor && permissions === 0o775 && info.uid === uid && info.gid === primaryGid
            && knownHome && path !== home && within(home, path) && entries.get(home)?.info?.uid === uid) return;
        refuse('unsafe_directory');
    };
    const inspect = (path, name, validate, flags, optional = false) => {
        const info = lstat(name);
        if (!info && !optional) refuse('missing_required_entry');
        if (info) validate(info);
        const entry = { path, name, info, fd: null };
        if (info && flags !== null) {
            entry.fd = fs.openSync(name, flags);
            fds.push(entry.fd);
            if (!unchanged(info, fs.fstatSync(entry.fd, statOptions))) refuse('entry_changed');
        }
        entries.set(path, entry);
        return entry;
    };
    const directory = (path, optional = false, ancestor = false) => {
        if (entries.has(path)) {
            const entry = entries.get(path);
            if (entry.info) safeDirectory(path, entry.info, ancestor);
            else if (!optional) refuse('missing_required_entry');
            return entry;
        }
        const parent = path === '/' ? null : directory(dirname(path), optional, true);
        if (parent && !parent.info) return parent;
        return inspect(path, parent ? ref(parent) + '/' + path.split('/').at(-1) : '/',
            (info) => safeDirectory(path, info, ancestor), directoryFlags, optional);
    };
    const child = (parent, name, flags, validate, optional = false) => inspect(
        resolve(parent.path, name), ref(parent) + '/' + name, validate, flags, optional);
    const ownedFile = (info, modes) => {
        if (!info.isFile() || info.uid !== uid || info.nlink !== 1n || !modes.includes(mode(info))) refuse('unsafe_metadata_file');
    };
    const recheck = () => {
        for (const { name, info, fd } of entries.values()) {
            const current = lstat(name);
            if (info ? !unchanged(info, current) || (fd !== null && !unchanged(info, fs.fstatSync(fd, statOptions))) : current) {
                refuse('entry_changed');
            }
        }
    };
    try {
        const settingsDir = directory(dirname(options.settings));
        const settings = child(settingsDir, options.settings.split('/').at(-1), fileFlags,
            (info) => ownedFile(info, [0o600, 0o640, 0o644]));
        const { archive, originals, state, token } = settingsPaths(settings.fd);
        if (overlaps(archive, originals) || [archive, originals].some((root) => overlaps(application, root))
            || (state !== lock && overlaps(state, lock))) refuse('overlapping_roots');
        const targets = [...new Set([lock, state])];
        for (const target of targets) checkScope(target, home, [archive, originals, token, options.settings]);

        const publicRoot = directory(archive, true);
        const privateRoot = directory(originals, true);
        const tokenParent = directory(dirname(token), true);
        const tokenEntry = tokenParent.info ? child(tokenParent, token.split('/').at(-1), null, (info) => {
            if (!info.isFile()) refuse('unsafe_token_alias');
        }, true) : null;
        // Keep settings and paths that are inspected only from aliasing a mutable inode.
        if (tokenEntry?.info && sameInode(tokenEntry.info, settings.info)) refuse('unsafe_token_alias');
        if (privateRoot.info && (privateRoot.info.uid !== uid || (mode(privateRoot.info) & 0o077))) refuse('unsafe_private_root');
        const roots = targets.map((path) => {
            const entry = directory(path);
            if (entry.info.uid !== uid || ![0o700, 0o755].includes(mode(entry.info))) refuse('unsafe_target_directory');
            return entry;
        });
        const chainHas = (inode, path) => {
            for (let current = path; ; current = dirname(current)) {
                const info = entries.get(current)?.info;
                if (info && sameInode(info, inode)) return true;
                if (current === '/') return false;
            }
        };
        if ((publicRoot.info && chainHas(publicRoot.info, privateRoot.path))
            || (privateRoot.info && chainHas(privateRoot.info, publicRoot.path))) refuse('overlapping_roots');
        const protectedRoots = [publicRoot, privateRoot, settingsDir, tokenParent];
        // Reject inode aliases as well as lexical overlap (for example, a bind-mounted root).
        for (const root of roots) {
            if ([...protectedRoots, ...roots.filter((entry) => entry !== root)].some((other) => chainHas(root.info, other.path))
                || [publicRoot, privateRoot].some((other) => other.info && chainHas(other.info, root.path))) {
                refuse('overlapping_roots');
            }
        }
        const [lockRoot] = roots;
        const stateRoot = roots.at(-1);
        const runLock = child(lockRoot, 'run.lock', fileFlags, (info) => ownedFile(info, [0o600, 0o644]));
        const stateFile = child(stateRoot, 'state.json', fileFlags, (info) => ownedFile(info, [0o600, 0o644, 0o664]), true);
        const files = [runLock];
        const checkEmptyState = () => {
            if (!stateFile.info && (state !== lock || fs.readdirSync(ref(stateRoot)).some((name) => name !== 'run.lock'))) {
                refuse('missing_backup_state');
            }
        };
        if (stateFile.info) {
            attributableState(stateFile.fd);
            files.push(stateFile);
        } else checkEmptyState();
        for (const entry of files) {
            if (tokenEntry?.info && sameInode(tokenEntry.info, entry.info)) refuse('unsafe_token_alias');
        }
        const changes = [...roots.map((entry) => [entry, 0o700]), ...files.map((entry) => [entry, 0o600])]
            .filter(([entry, desired]) => mode(entry.info) !== desired);
        Object.assign(report, { directories: roots.length, files: files.length, needsChanges: changes.length });
        recheck();
        if (!options.apply) return;

        // Like the scheduled worker, lock the open file description and keep it
        // until the last descriptor is closed. An operator stops the timer first.
        const flock = spawnSync('/usr/bin/flock', ['-n', '-E', '75', '3'], { stdio: ['ignore', 'ignore', 'ignore', runLock.fd] });
        if (flock.status !== 0) refuse(flock.status === 75 ? 'timer_lock_held' : 'timer_lock_unavailable');
        checkEmptyState();
        recheck();
        for (const [entry, desired] of changes) {
            recheck();
            fs.fchmodSync(entry.fd, desired);
            report.changed += 1;
            fs.fsyncSync(entry.fd);
            entry.info = fs.fstatSync(entry.fd, statOptions);
        }
        recheck();
    } finally {
        for (const fd of fds.reverse()) fs.closeSync(fd);
    }
}

const report = { directories: 0, files: 0, needsChanges: 0, changed: 0 };
try {
    main(report);
    process.stdout.write(JSON.stringify({ status: 'ready', ...report }) + '\n');
} catch (error) {
    process.stdout.write(JSON.stringify({ status: 'refused',
        reason: error instanceof Refusal ? error.message : 'permission_preflight_failed', ...report }) + '\n');
    process.exitCode = 1;
}
