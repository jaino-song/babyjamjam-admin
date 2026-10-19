import { constants, promises as fsp } from "node:fs";
import path from "node:path";
import {
    applyLedgerRecord, emptyLedgerState,
    type LedgerBodies, type LedgerRecord, type LedgerState,
} from "domain/eformsign-backup/worker";
import type { LedgerMarkerWriter, LedgerStore } from "infrastructure/eformsign-backup/worker/ledger-store";

/** Synthetic ids only. Everything the ledger specs and the kill helper share lives here. */
export const INSTALL_BODY: LedgerBodies["installed"] = {
    installationId: "inst-ledger-1",
    archiveId: "arch-ledger-1",
    archiveDev: 2049,
    archiveIno: 77,
    destinationIdentity: "local:arch-ledger-1",
    destinationRevision: "local-layout-v1",
};
export const INSTALL_AT = "2026-10-19T00:00:00.000Z";
export const INSTALL_PARAMS = {
    installationId: INSTALL_BODY.installationId,
    archiveId: INSTALL_BODY.archiveId,
    createdAt: INSTALL_AT,
    installedBody: INSTALL_BODY,
} as const;

export function fixedAt(n: number): string {
    return new Date(Date.UTC(2026, 9, 19, 0, 0, n)).toISOString();
}

export function runIdOf(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function runStartedBody(n: number): LedgerBodies["run_started"] {
    return { runId: runIdOf(n), scheduledFor: null, startedAt: fixedAt(n) };
}

/** Test-only marker port: create-exclusive 0600 file plus fsync. Production wires 3.3's no-clobber publisher instead. */
export const testMarkerWriter: LedgerMarkerWriter = async (dir, name, bytes) => {
    const handle = await fsp.open(path.join(dir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
};

/** `installed` is seq 1, then `run_started` for seq 2..total. `store` must be `not_initialized`. */
export async function seedLedger(store: LedgerStore, total: number): Promise<void> {
    await store.initialize(INSTALL_PARAMS);
    for (let seq = 2; seq <= total; seq++) await store.append("run_started", runStartedBody(seq), fixedAt(seq));
}

/** The state the reducer builds for the same sequence, without any file involved. */
export function expectedSeededState(total: number): LedgerState {
    let state = emptyLedgerState();
    const first: LedgerRecord = { v: 1, seq: 1, type: "installed", at: INSTALL_AT, body: INSTALL_BODY };
    state = applyLedgerRecord(state, first);
    for (let seq = 2; seq <= total; seq++) {
        state = applyLedgerRecord(state, { v: 1, seq, type: "run_started", at: fixedAt(seq), body: runStartedBody(seq) });
    }
    return state;
}
