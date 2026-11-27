import { pollReadyEvents, readyJson } from '../../deploy/eformsign-backup/ready-events.mjs';
import { createReadyWorkQueue, followReadyWake } from '../../deploy/eformsign-backup/ready-wake.mjs';

const [origin, stateDir] = process.argv.slice(2);
const send = (message) => process.send(message);
const shutdown = new AbortController();
process.once('disconnect', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());
const request = (path, signal = shutdown.signal) => fetch(new URL(path, origin), {
    headers: { Authorization: 'Bearer synthetic-backup-fixture' }, signal, redirect: 'error',
});
const queue = createReadyWorkQueue({
    now: () => Date.parse('2026-11-24T00:00:00Z'),
    async work(refresh) {
        const report = await pollReadyEvents({
            stateDir, binding: {}, request, resumeOnly: !refresh,
            refreshUntil: refresh ? async () => Date.parse((await readyJson(request, 'ready-events/cutoff')).until) : undefined,
            deliver(docId) {
                send({ delivered: docId });
                return 'delivered';
            },
        });
        send({ drained: true });
        return report;
    },
});
try {
    await followReadyWake({
        async connect(signal) {
            const response = await request('/internal/eformsign-backup/ready-wake', signal);
            send({ connected: response.status });
            return response;
        },
        onWake(frame) {
            send({ frame });
            queue.wake();
        },
        signal: shutdown.signal,
    });
} finally {
    await queue.stop();
    if (process.connected) process.disconnect();
}
