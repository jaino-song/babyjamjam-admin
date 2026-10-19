import { writeSync } from "node:fs";
import { LedgerStore, type LedgerFaultPoint } from "infrastructure/eformsign-backup/worker/ledger-store";
import { INSTALL_PARAMS, fixedAt, runStartedBody, testMarkerWriter } from "./ledger-fixtures";

/**
 * Child process for the SIGKILL specs. Inputs come from argv only.
 *   argv: <controlPath> <fault point> <total records> [pause]
 * Writes `installed` (seq 1) and `run_started` up to seq <total>. The fault is armed for the last append, or for the
 * compaction when the point is a `checkpoint-*` one. With `pause` the process prints "paused" and blocks at the point
 * instead of killing itself, so the parent can look at the files while a write is half done.
 */
const POINTS: readonly LedgerFaultPoint[] = [
    "before-write", "mid-write", "before-fsync", "after-fsync", "checkpoint-before-rename", "checkpoint-after-rename",
];

function parsePoint(value: string | undefined): LedgerFaultPoint {
    const point = POINTS.find((candidate) => candidate === value);
    if (!point) throw new Error("unknown fault point");
    return point;
}

function blockForever(): never {
    const cell = new Int32Array(new SharedArrayBuffer(4));
    for (;;) Atomics.wait(cell, 0, 0);
}

async function main(): Promise<void> {
    const [controlPath, pointArg, totalArg, mode] = process.argv.slice(2);
    const point = parsePoint(pointArg);
    const total = Number(totalArg);
    if (!controlPath || !Number.isInteger(total) || total < 2) throw new Error("bad arguments");
    const pause = mode === "pause";
    let armed = false;
    const fault = (reached: LedgerFaultPoint): void => {
        if (!armed || reached !== point) return;
        if (pause) {
            writeSync(1, "paused\n");
            blockForever();
        }
        process.kill(process.pid, "SIGKILL");
        blockForever();
    };
    const store = await LedgerStore.open(controlPath, { fault, writeMarker: testMarkerWriter });
    if (store.status === "not_initialized") await store.initialize(INSTALL_PARAMS);
    const compacting = point.startsWith("checkpoint-");
    for (let seq = store.lastSeq + 1; seq <= total; seq++) {
        armed = !compacting && seq === total;
        await store.append("run_started", runStartedBody(seq), fixedAt(seq));
    }
    if (compacting) {
        armed = true;
        await store.compactIfNeeded(1);
    }
    await store.close();
}

main().then(() => process.exit(0), () => process.exit(3));
