import { setTimeout as wait } from 'node:timers/promises';

import { dailyHandoffEnd } from './ready-events.mjs';

const minRetry = 1_000;
const maxRetry = 30_000;
const streamTimeout = 45_000;
const maxFrame = 16;
const backlogDelay = 100;

async function readWakeStream(connect, onWake, signal) {
    const connection = new AbortController();
    const connectionSignal = AbortSignal.any([signal, connection.signal]);
    let timeout;
    const keepAlive = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => connection.abort(), streamTimeout);
    };
    keepAlive();
    try {
        const response = await connect(connectionSignal);
        if (!response.ok || !/^text\/plain(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
            await response.body?.cancel();
            throw new Error('ready_wake_unavailable');
        }
        let ready = false;
        let partial = '';
        for await (const chunk of response.body) {
            const frames = (partial + Buffer.from(chunk).toString('utf8')).split('\n');
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
        connection.abort();
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
