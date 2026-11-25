import { fork } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

import { dailyHandoffEnd, readyBatchBudget } from './ready-events.mjs';

const minRetry = 1_000;
const maxRetry = 30_000;
const streamTimeout = 45_000;
const maxFrame = 16;
const backlogDelay = 100;
export const readyBatchLimit = 110_000;
export const readyBatchStartMargin = 5_000;
export const readyStopGrace = 750;
export const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);

export function signalReadyGroup(pid, signal) {
    if (!pid) return;
    try { process.kill(-pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export async function runReadyWork(worker, config, refresh, signal) {
    signal.throwIfAborted();
    const budget = Math.min(readyBatchLimit, readyBatchBudget(Date.now()));
    if (budget <= readyBatchStartMargin) throw new Error('ready_work_deferred');
    const deadline = monotonicMs() + budget;
    // Only the short-lived holder and its tools belong to this group. The
    // subscriber and the daily job never inherit the holder's lock or group.
    const child = fork(worker, ['--ready-batch'], {
        detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let result;
    let alarm;
    let force;
    let stopping = false;
    child.on('message', (message) => { result = message; });
    child.on('error', () => stop());
    const exited = new Promise((resolve) => child.once('close', resolve));

    const remaining = () => Math.min(deadline - monotonicMs(), readyBatchBudget(Date.now()));
    function stop() {
        if (stopping) return;
        stopping = true;
        clearTimeout(alarm);
        signalReadyGroup(child.pid, 'SIGTERM');
        force = setTimeout(() => signalReadyGroup(child.pid, 'SIGKILL'), Math.max(0, Math.min(readyStopGrace, remaining())));
    }
    function checkDeadline() {
        const left = remaining();
        if (left <= readyStopGrace) stop();
        else alarm = setTimeout(checkDeadline, Math.min(1_000, left - readyStopGrace));
    }
    const abort = () => stop();
    signal.addEventListener('abort', abort, { once: true });
    child.send({ config, refresh, deadline }, (error) => { if (error) stop(); });
    checkDeadline();
    try {
        const code = await exited;
        if (code !== 0 || stopping || !result) throw new Error('ready_work_deferred');
        return result;
    } finally {
        clearTimeout(alarm);
        clearTimeout(force);
        signal.removeEventListener('abort', abort);
        // A tool wrapper may have exited before its own children. Revoke the
        // entire group before allowing another batch to start.
        signalReadyGroup(child.pid, 'SIGKILL');
    }
}

async function readWakeStream(connect, onWake, signal) {
    const connection = new AbortController();
    let reader;
    const cancelReader = () => {
        // Abort the HTTP request and also release a pending read on Node 20.
        const cancelled = reader?.cancel();
        connection.abort();
        return cancelled?.catch(() => undefined);
    };
    const stop = () => { void cancelReader(); };
    let timeout;
    const keepAlive = () => {
        clearTimeout(timeout);
        timeout = setTimeout(stop, streamTimeout);
    };
    signal.addEventListener('abort', stop, { once: true });
    keepAlive();
    try {
        signal.throwIfAborted();
        const response = await connect(connection.signal);
        reader = response.body?.getReader();
        if (!response.ok || !reader || !/^text\/plain(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
            throw new Error('ready_wake_unavailable');
        }
        let ready = false;
        let partial = '';
        while (!connection.signal.aborted) {
            const { value, done } = await reader.read();
            if (done || connection.signal.aborted) break;
            const frames = (partial + Buffer.from(value).toString('utf8')).split('\n');
            partial = frames.pop();
            if (partial.length > maxFrame) throw new Error('ready_wake_frame');
            for (const frame of frames) {
                if (frame === 'ready') ready = true;
                else if (frame === 'heartbeat') {
                    keepAlive();
                    continue;
                } else if (frame !== 'wake' || !ready) throw new Error('ready_wake_frame');
                keepAlive();
                onWake(frame);
            }
        }
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
        await cancelReader();
        reader?.releaseLock();
    }
}

export async function followReadyWake({ connect, onWake, signal }) {
    let retry = minRetry;
    while (!signal.aborted) {
        let readyAt;
        try {
            await readWakeStream(connect, (frame) => {
                if (frame === 'ready') readyAt ??= performance.now();
                onWake(frame);
            }, signal);
        } catch {
            // Fetch errors can contain deployment details. The retry carries no data.
        }
        if (signal.aborted) break;
        // A peer that sends ready and immediately closes still backs off.
        if (readyAt !== undefined && performance.now() - readyAt >= streamTimeout) retry = minRetry;
        await wait(retry, undefined, { signal }).catch(() => undefined);
        retry = Math.min(maxRetry, retry * 2);
    }
}

export function createReadyWorkQueue({
    work, onFailure, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
    let refresh = false;
    let continueIntake = false;
    let pendingAt = null;
    let retryAt = 0;
    let retry = minRetry;
    let timer;
    let scheduledAt;
    let active;
    let closed = false;

    const schedule = () => {
        if (closed || active || (!refresh && !continueIntake && pendingAt === null)) return;
        const time = now();
        const due = refresh || continueIntake ? time : pendingAt;
        const at = Math.max(due, retryAt, dailyHandoffEnd(time) ?? time);
        if (timer !== undefined && scheduledAt <= at) return;
        clearTimer(timer);
        scheduledAt = at;
        timer = setTimer(() => {
            timer = undefined;
            if (!closed && dailyHandoffEnd(now()) === null) {
                active = drain().finally(() => {
                    active = undefined;
                    schedule();
                });
                return active;
            }
            schedule();
        }, Math.min(at - time, 2_147_483_647));
    };

    function backoff() {
        retryAt = now() + retry;
        retry = Math.min(maxRetry, retry * 2);
    }

    async function drain() {
        const requested = refresh;
        refresh = false;
        try {
            const result = await work(requested);
            refresh ||= requested && !result.startedWindow;
            continueIntake = result.continueIntake;
            pendingAt = result.pendingAt;
            if (result.intakeFailed) backoff();
            else {
                retry = minRetry;
                // Yield the shared lock between bounded batches. New work can
                // still preempt a future per-document retry.
                retryAt = now() + backlogDelay;
            }
        } catch {
            refresh ||= requested;
            backoff();
            onFailure?.();
        }
    }

    return {
        wake() {
            refresh = true;
            schedule();
        },
        async stop() {
            closed = true;
            clearTimer(timer);
            await active;
        },
    };
}
