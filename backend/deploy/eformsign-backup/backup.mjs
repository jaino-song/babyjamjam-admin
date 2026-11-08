#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve, relative, dirname, isAbsolute } from 'node:path';

let token = '';
const cleanReason = (error) => String(error.message ?? error).split(token || '\0').join('[redacted]').slice(0, 500);
const log = (value) => console.log(JSON.stringify(value).split(token || '\0').join('[redacted]'));
const execute = (bin, args) => new Promise((done, reject) => {
    execFile(bin, args, (error) => error ? reject(new Error(`프로세스 실패 (${error.code})`)) : done());
});
const sanitize = (value) => String(value).replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
const compare = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0);
const types = ['document', 'audit_trail'];
const tempPath = (path) => `${path}.${randomUUID()}.tmp`;

async function settingsAndArgs() {
    const args = process.argv.slice(2);
    let settingsPath;
    let limit = Infinity;
    for (let i = 0; i < args.length; i += 2) {
        if (args[i] === '--settings' && !settingsPath && args[i + 1]) settingsPath = args[i + 1];
        else if (args[i] === '--limit' && limit === Infinity && /^[1-9]\d*$/.test(args[i + 1])) limit = Number(args[i + 1]);
        else throw new Error('사용법: backup.mjs --settings <path> [--limit N]');
    }
    if (!settingsPath || (limit !== Infinity && !Number.isSafeInteger(limit))) throw new Error('설정 경로 또는 limit 오류');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const required = ['apiBaseUrl', 'tokenFile', 'archiveDir', 'stateDir'];
    const allowed = [...required, 'rcloneRemote', 'rcloneBin', 'qpdfBin'];
    if (!settings || Array.isArray(settings) || typeof settings !== 'object' ||
        Object.keys(settings).some((key) => !allowed.includes(key)) ||
        required.some((key) => !Object.hasOwn(settings, key)) ||
        Object.values(settings).some((value) => typeof value !== 'string' || !value.trim())) throw new Error('설정 키 또는 값 오류');
    const url = new URL(settings.apiBaseUrl);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((!loopback && url.protocol !== 'https:') || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('API URL은 HTTPS 또는 로컬 HTTP여야 합니다');
    token = (await fs.readFile(settings.tokenFile, 'utf8')).trim();
    if (!token) throw new Error('토큰 파일이 비어 있습니다');
    return { rcloneBin: 'rclone', qpdfBin: 'qpdf', ...settings, limit };
}

async function main() {
    const settings = await settingsAndArgs();
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
    const failure = (docId, error) => {
        const reason = cleanReason(error);
        report.failures.push({ docId, reason });
        report.failedFiles += 1;
        log({ docId, reason });
    };
    await fs.mkdir(settings.archiveDir, { recursive: true });
    await fs.mkdir(settings.stateDir, { recursive: true });
    const archive = await fs.realpath(settings.archiveDir);
    const inside = (path) => {
        const rel = relative(archive, path);
        if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('보관 경로 이탈');
        return path;
    };
    const finalPath = (path) => inside(resolve(archive, path));
    const size = async (path) => {
        try {
            const info = await fs.lstat(finalPath(path));
            inside(await fs.realpath(finalPath(path)));
            if (!info.isFile()) throw new Error('일반 파일이 아닌 보관 경로');
            return info.size;
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    const prepare = async (path) => {
        const final = finalPath(path);
        // Check each parent before creating the next one: a preexisting symlink
        // must not cause mkdir or a temporary write outside the archive.
        let parent = archive;
        for (const part of relative(archive, dirname(final)).split('/').filter(Boolean)) {
            parent = resolve(parent, part);
            try {
                if (!(await fs.lstat(parent)).isDirectory()) throw new Error('일반 디렉터리가 아닌 보관 경로');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await fs.mkdir(parent, { recursive: true });
            }
            inside(resolve(await fs.realpath(parent), 'placeholder'));
        }
        return final;
    };
    const statePath = resolve(settings.stateDir, 'state.json');
    let state = { version: 1, units: {} };
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state.version !== 1 || !state.units || typeof state.units !== 'object' || Array.isArray(state.units)) throw new Error('state.json 형식 오류');
    const saveState = async () => {
        const tmp = tempPath(statePath);
        try { await fs.writeFile(tmp, JSON.stringify(state, null, 2)); await fs.rename(tmp, statePath); }
        finally { await fs.rm(tmp, { force: true }); }
    };
    const reserved = new Set();
    for (const unit of Object.values(state.units)) {
        if (!unit || !unit.files || typeof unit.files !== 'object' || Array.isArray(unit.files)) throw new Error('state.json 파일 정보 오류');
        const files = Object.entries(unit.files);
        if (files.length !== 2 || files.some(([path, bytes]) => !finalPath(path) || !Number.isSafeInteger(bytes) || bytes < 0)) throw new Error('state.json 파일 정보 오류');
        for (const [path] of files) reserved.add(path);
    }
    await saveState();

    // Gather pages before naming: API cursor order differs from createdAt order.
    const docs = [];
    let listingComplete = false;
    let listingFailed = false;
    try {
        let cursor = null;
        do {
            const query = new URLSearchParams({ limit: '200' });
            if (cursor !== null) query.set('cursor', String(cursor));
            const response = await request(`/internal/eformsign-backup/documents?${query}`);
            if (response.status !== 200) throw new Error(`목록 HTTP ${response.status}`);
            const page = await response.json();
            docs.push(...page.items.slice(0, settings.limit - docs.length));
            cursor = page.nextCursor;
        } while (cursor !== null && docs.length < settings.limit);
        listingComplete = cursor === null;
    } catch (error) { listingFailed = true; log({ reason: cleanReason(error) }); }
    report.totalDocs = docs.length;
    docs.sort(compare);

    const units = [];
    const groups = new Map();
    for (const doc of docs) {
        const selected = types.map((type) => doc.files.filter((file) => file.fileType === type));
        if (doc.files.length !== 2 || selected.some((files) => files.length !== 1)) { failure(doc.docId, '필수 파일 없음'); continue; }
        const files = selected.map(([file]) => file);
        const chunk = doc.kind === 'service_record' && doc.serviceRecordChunk?.chunkCount > 1 ? doc.serviceRecordChunk : null;
        const folder = doc.kind === 'contract' ? '서비스계약서' : doc.kind === 'service_record' ? '제공기록지' : '기타';
        const base = doc.kind === 'other'
            ? sanitize(doc.title || '문서명미상') || '문서명미상'
            : `${folder}_${sanitize(doc.customerName || '고객미상')}_${sanitize(doc.serviceStartDate || '시작일미상')}`;
        const unit = {
            ...doc,
            key: `doc:${doc.docId}:${files[0].sha256}:${files[1].sha256}`,
            inputs: files,
            folder: chunk ? `${folder}/원본` : folder,
            base: chunk ? `${base}_${chunk.chunkIndex + 1}장` : base,
            baseName: base,
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
            key: `merged:${first.serviceRecordChunk.caseId}:${first.serviceRecordChunk.snapshotVersion}:${chunks.map((unit) => unit.inputs[0].sha256).join(',')}` });
    }
    // Reserve both paths together, including merged units in naming order.
    // Reservations become persistent only after a unit writes a file.
    const allocate = async (unit) => {
        if (Object.hasOwn(state.units, unit.key)) { unit.files = { ...state.units[unit.key].files }; return; }
        for (let n = 1; ; n += 1) {
            const name = `${unit.base}${n === 1 ? '' : ` (${n})`}.pdf`;
            const paths = [`${unit.folder}/${name}`, `${unit.folder}/감사추적/[감사추적]_${name}`];
            if (reserved.has(paths[0]) || reserved.has(paths[1]) || await size(paths[0]) !== null || await size(paths[1]) !== null) continue;
            unit.files = Object.fromEntries(paths.map((path, i) => [path, unit.inputs?.[i].byteSize ?? 0]));
            paths.forEach((path) => reserved.add(path));
            return;
        }
    };
    for (const unit of [...units, ...merges].sort(compare)) {
        try { await allocate(unit); }
        catch (error) { unit.broken = true; failure(unit.docId, error); }
    }
    const check = async (unit) => {
        const entries = Object.entries(unit.files);
        const sizes = await Promise.all(entries.map(([path]) => size(path)));
        for (let i = 0; i < entries.length; i += 1) {
            if (sizes[i] !== null && sizes[i] !== entries[i][1]) throw new Error('기존 파일 크기 불일치');
        }
        return sizes;
    };
    const download = async (file, path, createdAt) => {
        const final = await prepare(path);
        const tmp = tempPath(final);
        try {
            const response = await request(`/internal/eformsign-backup/files/${encodeURIComponent(file.fileId)}`);
            if (response.status !== 200) { await response.body?.cancel(); throw new Error(`파일 HTTP ${response.status}`); }
            const hash = createHash('sha256');
            let bytes = 0;
            const handle = await fs.open(tmp, 'wx');
            try {
                for await (const chunk of response.body) {
                    hash.update(chunk);
                    bytes += chunk.length;
                    await handle.writeFile(chunk);
                }
            } finally { await handle.close(); }
            if (bytes !== file.byteSize || hash.digest('hex') !== file.sha256.toLowerCase()) throw new Error('파일 크기 또는 sha256 불일치');
            await fs.utimes(tmp, new Date(createdAt), new Date(createdAt));
            await fs.rename(tmp, final);
        } finally { await fs.rm(tmp, { force: true }); }
    };
    // Keep expected sizes for both paths even when a download fails mid-pair,
    // so the next run repairs the missing file under its recorded name.
    for (const unit of units) {
        if (unit.broken) continue;
        let changed = false;
        let unitError;
        try {
            const sizes = await check(unit);
            if (sizes.every((bytes) => bytes !== null)) { report.skippedFiles += sizes.length; unit.ready = true; continue; }
            const paths = Object.keys(unit.files);
            for (let i = 0; i < paths.length; i += 1) {
                if (sizes[i] !== null) continue;
                await download(unit.inputs[i], paths[i], unit.createdAt);
                report.savedFiles += 1;
                changed = true;
            }
            unit.ready = true;
        } catch (error) { unitError = error; }
        finally {
            if (changed) {
                state.units[unit.key] = { files: unit.files };
                try { await saveState(); } catch (error) { unit.ready = false; unitError ??= error; }
            }
        }
        if (unitError) failure(unit.docId, unitError);
    }
    // Prepare both merged outputs before publishing either final path.
    for (const unit of merges) {
        if (unit.broken || !unit.chunks.every((chunk) => chunk.ready)) continue;
        const temps = [];
        let changed = false;
        let unitError;
        try {
            const sizes = await check(unit);
            if (sizes.every((bytes) => bytes !== null)) { report.skippedFiles += sizes.length; continue; }
            const paths = Object.keys(unit.files);
            for (let i = 0; i < paths.length; i += 1) {
                if (sizes[i] !== null) continue;
                const final = await prepare(paths[i]);
                const tmp = tempPath(final);
                temps.push({ tmp, final });
                const inputs = unit.chunks.map((chunk) => finalPath(Object.keys(chunk.files)[i]));
                await execute(settings.qpdfBin, ['--empty', '--pages', ...inputs, '--', tmp]);
                unit.files[paths[i]] = (await fs.stat(tmp)).size;
                await fs.utimes(tmp, new Date(unit.createdAt), new Date(unit.createdAt));
            }
            for (const { tmp, final } of temps) {
                await fs.rename(tmp, final);
                report.savedFiles += 1;
                changed = true;
            }
        } catch (error) { unitError = error; }
        finally {
            for (const { tmp } of temps) {
                try { await fs.rm(tmp, { force: true }); } catch (error) { unitError ??= error; }
            }
            if (changed) {
                state.units[unit.key] = { files: unit.files };
                try { await saveState(); } catch (error) { unitError ??= error; }
            }
        }
        if (unitError) failure(unit.docId, unitError);
    }
    if (settings.rcloneRemote) {
        try { await execute(settings.rcloneBin, ['copy', '--immutable', settings.archiveDir, settings.rcloneRemote]); report.driveStatus = 'ok'; }
        catch (error) { report.driveStatus = 'failed'; log({ reason: `Drive: ${cleanReason(error)}` }); }
    }
    report.status = listingFailed ? 'failed' : !listingComplete || report.failures.length || report.driveStatus !== 'ok' ? 'partial' : 'success';
    report.finishedAt = new Date().toISOString();

    // Result submission is the only operation with a retry.
    let posted = false;
    for (let attempt = 0; attempt < 2 && !posted; attempt += 1) {
        try {
            const response = await request('/internal/eformsign-backup/runs', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...report, failures: report.failures.slice(0, 200) }),
            });
            await response.body?.cancel();
            if (response.status !== 201) throw new Error(`결과 POST HTTP ${response.status}`);
            posted = true;
        } catch (error) { log({ reason: cleanReason(error) }); }
    }
    const exitCode = !posted ? 3 : { success: 0, failed: 1, partial: 2 }[report.status];
    log({ status: report.status, totalDocs: report.totalDocs, savedFiles: report.savedFiles,
        skippedFiles: report.skippedFiles, failedFiles: report.failedFiles, driveStatus: report.driveStatus, exitCode });
    process.exitCode = exitCode;
}

main().catch((error) => {
    log({ reason: cleanReason(error) });
    log({ status: 'failed', exitCode: 1 });
    process.exitCode = 1;
});
