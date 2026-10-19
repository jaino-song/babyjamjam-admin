import { promises as fsp, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    WorkerError, decodeLedgerLine, emptyLedgerState, ledgerChecksum, ledgerStateToJson,
} from "domain/eformsign-backup/worker";
import {
    LedgerStore, type LedgerFileHandle, type LedgerFs, type LedgerFaultPoint, type LedgerMarkerWriter,
} from "infrastructure/eformsign-backup/worker/ledger-store";
import {
    INSTALL_AT, INSTALL_PARAMS, expectedSeededState, fixedAt, runIdOf, runStartedBody, seedLedger, testMarkerWriter,
} from "./helpers/ledger-fixtures";

let root: string;
let counter = 0;

beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.homedir(), "bjj455-ledger-"));
});
afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
});

async function newControl(): Promise<string> {
    const dir = path.join(root, `control-${++counter}`);
    await fsp.mkdir(dir, { mode: 0o700 });
    return dir;
}
const journalPath = (control: string, base = 1) => path.join(control, "ledger", `journal-${String(base).padStart(12, "0")}.jsonl`);
const openWritable = (control: string, extra: Parameters<typeof LedgerStore.open>[1] = {}) =>
    LedgerStore.open(control, { writeMarker: testMarkerWriter, ...extra });
const json = (store: LedgerStore) => ledgerStateToJson(store.state);

/** A control dir with `installed` + run_started up to `total`, store closed. */
async function seeded(total: number): Promise<string> {
    const control = await newControl();
    const store = await openWritable(control);
    await seedLedger(store, total);
    await store.close();
    return control;
}
async function statusOf(control: string): Promise<{ status: string; reasons: string[] }> {
    const store = await LedgerStore.open(control, { readOnly: true });
    await store.close();
    return { status: store.status, reasons: [...store.reasons] };
}
async function listLedger(control: string): Promise<string[]> {
    return (await fsp.readdir(path.join(control, "ledger"))).sort();
}

describe("LedgerStore.open / initialize / append", () => {
    it("reports not_initialized for an empty control directory and creates nothing", async () => {
        const control = await newControl();
        const store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("not_initialized");
        expect(store.lastSeq).toBe(0);
        expect(ledgerStateToJson(store.state)).toEqual(ledgerStateToJson(emptyLedgerState()));
        expect(await fsp.readdir(control)).toEqual([]);
        const writable = await openWritable(control);
        expect(writable.status).toBe("not_initialized");
        expect(await fsp.readdir(control)).toEqual([]);
    });

    it("round trip: initialize, 5 appends, reopen gives the identical state and lastSeq", async () => {
        const control = await newControl();
        const calls: Array<{ dir: string; name: string; text: string }> = [];
        const writeMarker: LedgerMarkerWriter = async (dir, name, bytes) => {
            calls.push({ dir, name, text: Buffer.from(bytes).toString("utf8") });
            await testMarkerWriter(dir, name, bytes);
        };
        const store = await LedgerStore.open(control, { writeMarker });
        await seedLedger(store, 6);
        expect(store.status).toBe("ok");
        expect(store.lastSeq).toBe(6);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ dir: control, name: "installation.json" });
        expect(JSON.parse(calls[0]!.text)).toEqual({
            schemaVersion: 1, installationId: INSTALL_PARAMS.installationId, archiveId: INSTALL_PARAMS.archiveId, createdAt: INSTALL_AT,
        });
        await store.close();

        const reopened = await LedgerStore.open(control);
        expect(reopened.status).toBe("ok");
        expect(reopened.reasons).toEqual([]);
        expect(reopened.lastSeq).toBe(6);
        expect(json(reopened)).toEqual(json(store));
        expect(json(reopened)).toEqual(ledgerStateToJson(expectedSeededState(6)));
        await reopened.close();

        const ledgerDir = path.join(control, "ledger");
        expect((await fsp.stat(ledgerDir)).mode & 0o777).toBe(0o700);
        expect(await fsp.readdir(ledgerDir)).toEqual(["journal-000000000001.jsonl"]);
        expect((await fsp.stat(journalPath(control))).mode & 0o777).toBe(0o600);
        const lines = (await fsp.readFile(journalPath(control), "utf8")).split("\n");
        expect(lines.pop()).toBe("");
        expect(lines).toHaveLength(6);
        lines.forEach((line, index) => {
            const decoded = decodeLedgerLine(line);
            expect(decoded.ok && decoded.record.seq).toBe(index + 1);
        });
    });

    it("refuses to initialize twice and refuses append before initialize", async () => {
        const control = await newControl();
        const fresh = await openWritable(control);
        await expect(fresh.append("run_started", runStartedBody(2), fixedAt(2))).rejects.toMatchObject({ reasonCode: "not-initialized" });
        await fresh.initialize(INSTALL_PARAMS);
        await expect(fresh.initialize(INSTALL_PARAMS)).rejects.toBeInstanceOf(WorkerError);
        await fresh.close();
        const again = await openWritable(control);
        expect(again.status).toBe("ok");
        await expect(again.initialize(INSTALL_PARAMS)).rejects.toBeInstanceOf(WorkerError);
        await again.close();
    });

    it("initialize needs the marker port and writes nothing when the body disagrees with the marker", async () => {
        const control = await newControl();
        const noPort = await LedgerStore.open(control);
        await expect(noPort.initialize(INSTALL_PARAMS)).rejects.toBeInstanceOf(WorkerError);
        const store = await openWritable(control);
        await expect(store.initialize({ ...INSTALL_PARAMS, installationId: "someone-else" })).rejects.toBeInstanceOf(WorkerError);
        expect(await fsp.readdir(control)).toEqual([]);
        expect(store.status).toBe("not_initialized");
    });

    it("rejects an invalid record before touching the disk and stays usable", async () => {
        const control = await seeded(3);
        const store = await openWritable(control);
        const size = (await fsp.stat(journalPath(control))).size;
        await expect(store.append("run_finished", {
            runId: runIdOf(99), finishedAt: fixedAt(9), snapshotStatus: "partial", historicalCoverage: "unverified",
            reasonCodes: [], counts: { candidates: 0, included: 0, verified: 0, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 },
        }, fixedAt(9))).rejects.toMatchObject({ reasonCode: "ledger-inconsistent" });
        await expect(store.append("run_started", runStartedBody(2), "not-a-time")).rejects.toMatchObject({ reasonCode: "ledger-schema" });
        expect((await fsp.stat(journalPath(control))).size).toBe(size);
        expect(store.lastSeq).toBe(3);
        await store.append("run_started", runStartedBody(4), fixedAt(4));
        expect(store.lastSeq).toBe(4);
        await store.close();
    });

    it("serialises overlapping appends so seq stays gapless", async () => {
        const control = await seeded(1);
        const store = await openWritable(control);
        await Promise.all([2, 3, 4, 5].map((n) => store.append("run_started", runStartedBody(n), fixedAt(n))));
        expect(store.lastSeq).toBe(5);
        await store.close();
        const reopened = await LedgerStore.open(control, { readOnly: true });
        expect(reopened.status).toBe("ok");
        expect(json(reopened)).toEqual(ledgerStateToJson(expectedSeededState(5)));
    });

    it("rejects a control path that is relative, a symlink, a file, missing or group/other writable", async () => {
        const real = await newControl();
        const link = path.join(root, `link-${++counter}`);
        await fsp.symlink(real, link);
        const file = path.join(root, `file-${++counter}`);
        await fsp.writeFile(file, "x");
        const loose = await newControl();
        await fsp.chmod(loose, 0o770);
        const other = await newControl();
        await fsp.chmod(other, 0o702);
        for (const bad of ["relative/dir", link, file, path.join(root, "missing"), loose, other, `${real}/`, `${real}/../${path.basename(real)}`]) {
            await expect(LedgerStore.open(bad, { readOnly: true })).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        }
        await fsp.chmod(loose, 0o700);
        await fsp.chmod(other, 0o700);
    });
});

describe("torn tail", () => {
    it("repairs a half line: quarantine holds exactly the torn bytes, tail_discarded is recorded, earlier records intact", async () => {
        const control = await seeded(4);
        const torn = Buffer.from('{"at":"2026-10-19T00:00:05.000Z","body":{"runId":"00000000-0000');
        await fsp.appendFile(journalPath(control), torn);
        const before = await fsp.readFile(journalPath(control));

        const store = await openWritable(control);
        expect(store.status).toBe("ok");
        expect(store.reasons).toEqual(["torn-tail-repaired"]);
        expect(store.lastSeq).toBe(5);
        expect(store.state.tailDiscards).toHaveLength(1);
        expect(store.state.tailDiscards[0]).toMatchObject({ byteLength: torn.length, quarantineName: "tail-5.quarantine" });
        expect(await fsp.readFile(path.join(control, "ledger", "tail-5.quarantine"))).toEqual(torn);
        await store.close();

        const after = await fsp.readFile(journalPath(control));
        expect(after.subarray(0, before.length - torn.length)).toEqual(before.subarray(0, before.length - torn.length));
        expect(after.at(-1)).toBe(0x0a);
        const lines = after.toString("utf8").split("\n").filter(Boolean).map((line) => decodeLedgerLine(line));
        expect(lines).toHaveLength(5);
        expect(lines.every((line) => line.ok)).toBe(true);
        const last = lines.at(-1);
        expect(last && last.ok && last.record.type).toBe("tail_discarded");
        const earlier = ledgerStateToJson(expectedSeededState(4));
        expect(json(store).runs).toEqual(earlier.runs);

        const reopened = await LedgerStore.open(control);
        expect(reopened.status).toBe("ok");
        expect(reopened.reasons).toEqual([]);
        expect(reopened.lastSeq).toBe(5);
    });

    it("a complete JSON line that only lacks its newline is still a torn tail", async () => {
        const control = await seeded(3);
        const bytes = await fsp.readFile(journalPath(control));
        await fsp.truncate(journalPath(control), bytes.length - 1);
        const store = await openWritable(control);
        expect(store.status).toBe("ok");
        expect(store.state.runs.size).toBe(1);
        expect(store.state.tailDiscards).toHaveLength(1);
        expect(store.lastSeq).toBe(3);
        const quarantined = await fsp.readFile(path.join(control, "ledger", "tail-3.quarantine"));
        expect(quarantined).toEqual(bytes.subarray(bytes.lastIndexOf(0x0a, bytes.length - 2) + 1, bytes.length - 1));
        await store.close();
    });

    it("read-only open ignores the tail, reports it and writes nothing", async () => {
        const control = await seeded(4);
        await fsp.appendFile(journalPath(control), "{\"half\":");
        const size = (await fsp.stat(journalPath(control))).size;
        const names = await listLedger(control);
        const store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(store.reasons).toEqual(["torn-tail-ignored"]);
        expect(store.lastSeq).toBe(4);
        expect((await fsp.stat(journalPath(control))).size).toBe(size);
        expect(await listLedger(control)).toEqual(names);
        await expect(store.append("run_started", runStartedBody(9), fixedAt(9))).rejects.toBeInstanceOf(WorkerError);
        expect((await fsp.stat(journalPath(control))).size).toBe(size);
    });

    it("accepts a quarantine file that already holds identical bytes (crash between quarantine and truncate)", async () => {
        const control = await seeded(3);
        const torn = Buffer.from("{\"half\":1");
        await fsp.appendFile(journalPath(control), torn);
        await fsp.writeFile(path.join(control, "ledger", "tail-4.quarantine"), torn, { mode: 0o600 });
        const store = await openWritable(control);
        expect(store.status).toBe("ok");
        expect(store.state.tailDiscards[0]?.quarantineName).toBe("tail-4.quarantine");
        expect((await listLedger(control)).filter((name) => name.startsWith("tail-"))).toEqual(["tail-4.quarantine"]);
        expect(await fsp.readFile(path.join(control, "ledger", "tail-4.quarantine"))).toEqual(torn);
        await store.close();
    });

    it("keeps an earlier quarantine file whose bytes differ and uses another name", async () => {
        const control = await seeded(3);
        await fsp.writeFile(path.join(control, "ledger", "tail-4.quarantine"), "older torn bytes", { mode: 0o600 });
        await fsp.appendFile(journalPath(control), "{\"other\":");
        const store = await openWritable(control);
        expect(store.status).toBe("ok");
        expect(store.state.tailDiscards[0]?.quarantineName).toBe("tail-4-1.quarantine");
        expect(await fsp.readFile(path.join(control, "ledger", "tail-4.quarantine"), "utf8")).toBe("older torn bytes");
        expect(await fsp.readFile(path.join(control, "ledger", "tail-4-1.quarantine"), "utf8")).toBe("{\"other\":");
        await store.close();
    });

    it("a torn first record leaves nothing to replay: recovery_required, and nothing is repaired", async () => {
        const control = await seeded(1);
        await fsp.truncate(journalPath(control), 20);
        const store = await openWritable(control);
        expect(store.status).toBe("recovery_required");
        expect((await fsp.stat(journalPath(control))).size).toBe(20);
        expect((await listLedger(control)).filter((name) => name.startsWith("tail-"))).toEqual([]);
        await store.close();
    });

    it("repairs a torn tail after a checkpoint when the new journal holds only the torn bytes", async () => {
        const control = await seeded(4);
        const store = await openWritable(control);
        expect(await store.compactIfNeeded(3)).toBe(true);
        await store.close();
        await fsp.writeFile(journalPath(control, 5), "{\"half\"", { mode: 0o600 });
        const reopened = await openWritable(control);
        expect(reopened.status).toBe("ok");
        expect(reopened.lastSeq).toBe(5);
        expect(reopened.state.tailDiscards).toHaveLength(1);
        await reopened.close();
    });
});

describe("recovery_required", () => {
    async function rewriteLines(control: string, edit: (lines: string[]) => string[]): Promise<void> {
        const lines = (await fsp.readFile(journalPath(control), "utf8")).split("\n").slice(0, -1);
        await fsp.writeFile(journalPath(control), `${edit(lines).join("\n")}\n`);
    }
    function signed(envelope: { v: number; seq: number; type: string; at: string; body: unknown }): string {
        return JSON.stringify({ ...envelope, sum: ledgerChecksum(envelope) });
    }

    const cases: Array<[string, (control: string) => Promise<void>]> = [
        ["a middle line has a flipped byte", async (control) => {
            const bytes = await fsp.readFile(journalPath(control));
            const offset = bytes.indexOf("run_started") + 3;
            bytes[offset] = bytes[offset]! ^ 0x01;
            await fsp.writeFile(journalPath(control), bytes);
        }],
        ["a sum is edited", (control) => rewriteLines(control, (lines) => {
            lines[2] = lines[2]!.replace(/"sum":"[0-9a-f]{64}"/, `"sum":"${"0".repeat(64)}"`);
            return lines;
        })],
        ["a seq gap", (control) => rewriteLines(control, (lines) => lines.filter((_, index) => index !== 2))],
        ["an unknown record type with a valid sum", (control) => rewriteLines(control, (lines) => {
            lines[2] = signed({ v: 1, seq: 3, type: "mystery", at: fixedAt(3), body: {} });
            return lines;
        })],
        ["a record version from the future", (control) => rewriteLines(control, (lines) => {
            lines[2] = signed({ v: 2, seq: 3, type: "run_started", at: fixedAt(3), body: runStartedBody(3) });
            return lines;
        })],
        ["a blank line in the middle", (control) => rewriteLines(control, (lines) => [...lines.slice(0, 2), "", ...lines.slice(2)])],
        ["the first record is not installed", (control) => rewriteLines(control, (lines) => {
            lines[0] = signed({ v: 1, seq: 1, type: "run_started", at: fixedAt(1), body: runStartedBody(1) });
            return lines;
        })],
        ["a journal file with a wrong base", async (control) => {
            await fsp.writeFile(journalPath(control, 9), "", { mode: 0o600 });
        }],
        ["a journal file with an unparsable name", async (control) => {
            await fsp.writeFile(path.join(control, "ledger", "journal-1.jsonl"), "", { mode: 0o600 });
        }],
        ["the ledger directory is deleted while the marker exists", async (control) => {
            await fsp.rm(path.join(control, "ledger"), { recursive: true });
        }],
        ["the ledger directory is a symlink", async (control) => {
            await fsp.rename(path.join(control, "ledger"), path.join(control, "ledger-real"));
            await fsp.symlink(path.join(control, "ledger-real"), path.join(control, "ledger"));
        }],
        ["the journal is emptied while the marker exists", async (control) => {
            await fsp.truncate(journalPath(control), 0);
        }],
        ["the journal is deleted while the marker exists", async (control) => {
            await fsp.rm(journalPath(control));
        }],
        ["the marker is missing while a ledger exists", async (control) => {
            await fsp.rm(path.join(control, "installation.json"));
        }],
        ["the marker belongs to another installation", async (control) => {
            await fsp.writeFile(path.join(control, "installation.json"), JSON.stringify({
                schemaVersion: 1, installationId: "inst-other", archiveId: INSTALL_PARAMS.archiveId, createdAt: INSTALL_AT,
            }));
        }],
        ["the marker is not valid JSON", async (control) => {
            await fsp.writeFile(path.join(control, "installation.json"), "{nope");
        }],
        ["the journal is a symlink", async (control) => {
            const real = path.join(control, "elsewhere.jsonl");
            await fsp.rename(journalPath(control), real);
            await fsp.symlink(real, journalPath(control));
        }],
    ];

    it.each(cases)("%s", async (_label, corrupt) => {
        const control = await seeded(4);
        await corrupt(control);
        const before = await fsp.readdir(control);
        const result = await statusOf(control);
        expect(result.status).toBe("recovery_required");
        expect(result.reasons.length).toBeGreaterThan(0);
        const writable = await openWritable(control);
        expect(writable.status).toBe("recovery_required");
        await expect(writable.append("run_started", runStartedBody(9), fixedAt(9))).rejects.toMatchObject({ reasonCode: "recovery-required" });
        await expect(writable.compactIfNeeded(1)).rejects.toBeInstanceOf(WorkerError);
        await writable.close();
        expect(await fsp.readdir(control)).toEqual(before);
    });

    describe("with a checkpoint", () => {
        async function compacted(): Promise<string> {
            const control = await seeded(5);
            const store = await openWritable(control);
            expect(await store.compactIfNeeded(3)).toBe(true);
            await store.append("run_started", runStartedBody(7), fixedAt(7));
            await store.close();
            return control;
        }
        const checkpointPath = (control: string) => path.join(control, "ledger", "checkpoint.json");

        it("a checkpoint with an edited sum", async () => {
            const control = await compacted();
            const text = await fsp.readFile(checkpointPath(control), "utf8");
            await fsp.writeFile(checkpointPath(control), text.replace(/"sum":"[0-9a-f]{64}"/, `"sum":"${"1".repeat(64)}"`));
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("a checkpoint whose state was edited", async () => {
            const control = await compacted();
            const text = await fsp.readFile(checkpointPath(control), "utf8");
            await fsp.writeFile(checkpointPath(control), text.replace("inst-ledger-1", "inst-ledger-2"));
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("a checkpoint that is not JSON", async () => {
            const control = await compacted();
            await fsp.writeFile(checkpointPath(control), "garbage");
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("the highest history journal not ending at checkpoint.lastSeq", async () => {
            const control = await compacted();
            await fsp.writeFile(journalPath(control, 1), (await fsp.readFile(journalPath(control, 1), "utf8")).split("\n").slice(0, 3).join("\n") + "\n");
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("every history journal missing", async () => {
            const control = await compacted();
            await fsp.rm(journalPath(control, 1));
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("a journal whose base is above the expected base", async () => {
            const control = await compacted();
            await fsp.writeFile(journalPath(control, 20), "", { mode: 0o600 });
            expect((await statusOf(control)).status).toBe("recovery_required");
        });

        it("a checkpoint with no journal at all after it is normal, and so is an empty one", async () => {
            const control = await compacted();
            const live = journalPath(control, 6);
            const bytes = await fsp.readFile(live);
            await fsp.rename(live, path.join(control, "stashed-live-journal"));
            const missing = await LedgerStore.open(control, { readOnly: true });
            expect(missing.status).toBe("ok");
            expect(missing.lastSeq).toBe(5);
            await fsp.writeFile(live, "", { mode: 0o600 });
            const empty = await LedgerStore.open(control, { readOnly: true });
            expect(empty.status).toBe("ok");
            expect(empty.lastSeq).toBe(5);
            await fsp.writeFile(live, bytes, { mode: 0o600 });
            const full = await LedgerStore.open(control, { readOnly: true });
            expect(full.lastSeq).toBe(6);
        });
    });
});

describe("compaction", () => {
    it("threshold 3: writes checkpoint and a new journal, keeps the old journal, reopen gives the same state", async () => {
        const control = await seeded(5);
        const oldBytes = await fsp.readFile(journalPath(control));
        const store = await openWritable(control);
        expect(await store.compactIfNeeded(5)).toBe(false);
        expect(await listLedger(control)).toEqual(["journal-000000000001.jsonl"]);
        expect(await store.compactIfNeeded(3)).toBe(true);
        expect(await listLedger(control)).toEqual(["checkpoint.json", "journal-000000000001.jsonl", "journal-000000000006.jsonl"]);
        expect(await fsp.readFile(journalPath(control))).toEqual(oldBytes);
        expect((await fsp.stat(journalPath(control, 6))).size).toBe(0);
        expect((await fsp.stat(path.join(control, "ledger", "checkpoint.json"))).mode & 0o777).toBe(0o600);
        expect(await store.compactIfNeeded(3)).toBe(false);

        await store.append("run_started", runStartedBody(6), fixedAt(6));
        await store.append("run_started", runStartedBody(7), fixedAt(7));
        const afterAppends = json(store);
        await store.close();
        expect((await fsp.readFile(journalPath(control, 6), "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
        expect(await fsp.readFile(journalPath(control))).toEqual(oldBytes);

        const reopened = await LedgerStore.open(control);
        expect(reopened.status).toBe("ok");
        expect(reopened.lastSeq).toBe(7);
        expect(json(reopened)).toEqual(afterAppends);
        expect(afterAppends).toEqual(ledgerStateToJson(expectedSeededState(7)));
        await reopened.close();
    });

    it("the checkpoint is the replay base: a damaged middle of a history journal is never read", async () => {
        const control = await seeded(5);
        const store = await openWritable(control);
        await store.compactIfNeeded(3);
        await store.close();
        const bytes = await fsp.readFile(journalPath(control));
        const offset = bytes.indexOf("run_started") + 3;
        bytes[offset] = bytes[offset]! ^ 0x01;
        await fsp.writeFile(journalPath(control), bytes);
        const reopened = await LedgerStore.open(control, { readOnly: true });
        expect(reopened.status).toBe("ok");
        expect(json(reopened)).toEqual(ledgerStateToJson(expectedSeededState(5)));
    });

    it("compacts repeatedly and keeps every history journal", async () => {
        const control = await seeded(4);
        const store = await openWritable(control);
        expect(await store.compactIfNeeded(2)).toBe(true);
        for (const n of [5, 6, 7]) await store.append("run_started", runStartedBody(n), fixedAt(n));
        expect(await store.compactIfNeeded(2)).toBe(true);
        await store.append("run_started", runStartedBody(8), fixedAt(8));
        await store.close();
        expect(await listLedger(control)).toEqual([
            "checkpoint.json", "journal-000000000001.jsonl", "journal-000000000005.jsonl", "journal-000000000008.jsonl",
        ]);
        const reopened = await LedgerStore.open(control, { readOnly: true });
        expect(reopened.status).toBe("ok");
        expect(json(reopened)).toEqual(ledgerStateToJson(expectedSeededState(8)));
    });

    it("a leftover temp file from an earlier crash does not stop the next compaction", async () => {
        const control = await seeded(5);
        await fsp.writeFile(path.join(control, "ledger", "checkpoint-5.tmp"), "half a checkpoint", { mode: 0o600 });
        const store = await openWritable(control);
        expect(await store.compactIfNeeded(3)).toBe(true);
        await store.close();
        const reopened = await LedgerStore.open(control, { readOnly: true });
        expect(reopened.status).toBe("ok");
        expect(reopened.lastSeq).toBe(5);
    });

    it.each(["checkpoint-before-rename", "checkpoint-after-rename"] as const)("a failure at %s poisons the store but the disk reopens ok with the same state", async (point) => {
        const control = await seeded(5);
        const store = await openWritable(control, { fault: (reached) => { if (reached === point) throw new Error("injected"); } });
        await expect(store.compactIfNeeded(3)).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        await expect(store.append("run_started", runStartedBody(6), fixedAt(6))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        await store.close();
        const reopened = await openWritable(control);
        expect(reopened.status).toBe("ok");
        expect(json(reopened)).toEqual(ledgerStateToJson(expectedSeededState(5)));
        await reopened.append("run_started", runStartedBody(6), fixedAt(6));
        expect(await listLedger(control)).toContain(point === "checkpoint-after-rename" ? "journal-000000000006.jsonl" : "journal-000000000001.jsonl");
        await reopened.close();
    });
});

describe("I/O failure", () => {
    interface Spy { calls: string[]; failWrite: boolean; fs: LedgerFs }
    function spyFs(): Spy {
        const spy: Spy = { calls: [], failWrite: false, fs: undefined as unknown as LedgerFs };
        const real = async (target: string, flags: number, mode?: number): Promise<LedgerFileHandle> => {
            spy.calls.push("open");
            const handle = await fsp.open(target, flags, mode);
            const wrapped: LedgerFileHandle = {
                read: (buffer, offset, length, position) => { spy.calls.push("read"); return handle.read(buffer, offset, length, position); },
                write: async (buffer, offset, length) => {
                    spy.calls.push("write");
                    if (spy.failWrite) throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
                    return handle.write(buffer, offset, length);
                },
                stat: () => { spy.calls.push("stat"); return handle.stat(); },
                truncate: (length) => { spy.calls.push("truncate"); return handle.truncate(length); },
                sync: () => { spy.calls.push("sync"); return handle.sync(); },
                close: () => { spy.calls.push("close"); return handle.close(); },
            };
            return wrapped;
        };
        spy.fs = {
            open: real,
            lstat: (target) => { spy.calls.push("lstat"); return fsp.lstat(target); },
            readdir: (target) => { spy.calls.push("readdir"); return fsp.readdir(target); },
            mkdir: async (target, mode) => { spy.calls.push("mkdir"); await fsp.mkdir(target, { mode }); },
            rename: (from, to) => { spy.calls.push("rename"); return fsp.rename(from, to); },
        };
        return spy;
    }

    it("EIO on write poisons the store: the next append throws control-unavailable with zero seam calls", async () => {
        const control = await seeded(3);
        const spy = spyFs();
        const store = await openWritable(control, { fs: spy.fs });
        await store.append("run_started", runStartedBody(4), fixedAt(4));
        spy.failWrite = true;
        await expect(store.append("run_started", runStartedBody(5), fixedAt(5))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        expect(store.lastSeq).toBe(4);
        const used = spy.calls.length;
        spy.failWrite = false;
        await expect(store.append("run_started", runStartedBody(5), fixedAt(5))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        await expect(store.compactIfNeeded(1)).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        expect(spy.calls).toHaveLength(used);
        const reopened = await LedgerStore.open(control, { readOnly: true });
        expect(reopened.status).toBe("ok");
        expect(reopened.lastSeq).toBe(4);
    });

    it("fsync follows every write and happens before the append resolves", async () => {
        const control = await seeded(2);
        const spy = spyFs();
        const store = await openWritable(control, { fs: spy.fs });
        spy.calls.length = 0;
        for (const n of [3, 4, 5]) await store.append("run_started", runStartedBody(n), fixedAt(n));
        const io = spy.calls.filter((call) => call === "write" || call === "sync");
        expect(io).toEqual(["write", "sync", "write", "sync", "write", "sync"]);
        await store.close();
    });

    it.each<LedgerFaultPoint>(["before-write", "mid-write", "before-fsync", "after-fsync"])("a hook that throws at %s is an I/O failure", async (point) => {
        const control = await seeded(2);
        const store = await openWritable(control, { fault: (reached) => { if (reached === point) throw new Error("injected"); } });
        await expect(store.append("run_started", runStartedBody(3), fixedAt(3))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        await expect(store.append("run_started", runStartedBody(3), fixedAt(3))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        expect(store.lastSeq).toBe(2);
        await store.close();
    });

    it("fires the fault points in order around one append, with the first half of the line already written at mid-write", async () => {
        const control = await seeded(2);
        const seen: Array<{ point: string; size: number }> = [];
        const store = await openWritable(control, {
            fault: (point) => { seen.push({ point, size: statSync(journalPath(control)).size }); },
        });
        const base = (await fsp.stat(journalPath(control))).size;
        await store.append("run_started", runStartedBody(3), fixedAt(3));
        const total = (await fsp.stat(journalPath(control))).size;
        expect(seen.map((entry) => entry.point)).toEqual(["before-write", "mid-write", "before-fsync", "after-fsync"]);
        expect(seen[0]!.size).toBe(base);
        expect(seen[1]!.size).toBeGreaterThan(base);
        expect(seen[1]!.size).toBeLessThan(total);
        expect(seen[2]!.size).toBe(total);
        await store.close();
    });
});

describe("quarantineAndReset", () => {
    it("only runs from recovery_required", async () => {
        const control = await seeded(3);
        const store = await openWritable(control);
        await expect(store.quarantineAndReset(runIdOf(1))).rejects.toBeInstanceOf(WorkerError);
        await store.close();
    });

    it("moves the damaged ledger aside and opens a fresh one that takes recovery_started first", async () => {
        const control = await seeded(4);
        const damaged = await fsp.readFile(journalPath(control), "utf8");
        await fsp.writeFile(journalPath(control), damaged.replace("run_started", "run_startex"));
        const store = await openWritable(control);
        expect(store.status).toBe("recovery_required");
        await store.quarantineAndReset(runIdOf(77));
        expect(store.status).toBe("ok");
        expect(store.lastSeq).toBe(0);
        expect(await fsp.readdir(control)).toEqual(["installation.json", "ledger", `ledger.quarantine-${runIdOf(77)}`].sort());
        expect(await fsp.readFile(path.join(control, `ledger.quarantine-${runIdOf(77)}`, "journal-000000000001.jsonl"), "utf8"))
            .toBe(damaged.replace("run_started", "run_startex"));
        expect(await listLedger(control)).toEqual(["journal-000000000001.jsonl"]);
        expect((await fsp.stat(path.join(control, "ledger"))).mode & 0o777).toBe(0o700);

        await store.append("recovery_started", {
            ...INSTALL_PARAMS.installedBody, priorLedgerName: `ledger.quarantine-${runIdOf(77)}`, sequenceFloor: 4, knownGaps: [],
        }, fixedAt(10));
        await store.append("run_started", runStartedBody(11), fixedAt(11));
        await store.close();
        const reopened = await LedgerStore.open(control);
        expect(reopened.status).toBe("ok");
        expect(reopened.lastSeq).toBe(2);
        expect(reopened.state.installation?.origin).toBe("recovery_started");
        await reopened.close();
    });

    it("works when the ledger directory is gone, and a repeat after a crash reuses the fresh ledger", async () => {
        const control = await seeded(3);
        await fsp.rm(path.join(control, "ledger"), { recursive: true });
        const first = await openWritable(control);
        expect(first.status).toBe("recovery_required");
        await first.quarantineAndReset(runIdOf(5));
        expect(await listLedger(control)).toEqual(["journal-000000000001.jsonl"]);
        await first.close();

        const second = await openWritable(control);
        expect(second.status).toBe("recovery_required");
        await second.quarantineAndReset(runIdOf(5));
        expect(second.status).toBe("ok");
        expect(await fsp.readdir(control)).toEqual(["installation.json", "ledger"]);
        await second.close();
    });

    it("refuses to overwrite an earlier quarantine of the same run id", async () => {
        const control = await seeded(3);
        await fsp.mkdir(path.join(control, `ledger.quarantine-${runIdOf(6)}`));
        await fsp.writeFile(journalPath(control), "garbage\n");
        const store = await openWritable(control);
        expect(store.status).toBe("recovery_required");
        await expect(store.quarantineAndReset(runIdOf(6))).rejects.toMatchObject({ reasonCode: "control-unavailable" });
        expect(await listLedger(control)).toEqual(["journal-000000000001.jsonl"]);
        await expect(store.append("recovery_started", { ...INSTALL_PARAMS.installedBody, priorLedgerName: "x", sequenceFloor: 0, knownGaps: [] }, fixedAt(1)))
            .rejects.toBeInstanceOf(WorkerError);
        await store.close();
    });

    it("rejects a run id that is not a uuid", async () => {
        const control = await seeded(3);
        await fsp.truncate(journalPath(control), 0);
        const store = await openWritable(control);
        await expect(store.quarantineAndReset("../escape")).rejects.toBeInstanceOf(WorkerError);
        expect(await listLedger(control)).toEqual(["journal-000000000001.jsonl"]);
        await store.close();
    });
});

describe("worker runtime file rules", () => {
    const dir = path.resolve(__dirname, "../../../../infrastructure/eformsign-backup/worker");
    it("ledger files import only what contract W1 allows and avoid the forbidden constructs", async () => {
        const files = (await fsp.readdir(dir)).filter((name) => /^ledger-.*\.ts$/.test(name));
        expect(files).toEqual(expect.arrayContaining(["ledger-store.ts"]));
        for (const name of files) {
            const source = await fsp.readFile(path.join(dir, name), "utf8");
            for (const match of source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)) {
                const specifier = match[1]!;
                expect(
                    specifier.startsWith("node:") || specifier.startsWith("./") || specifier === "zod"
                    || specifier === "domain/eformsign-backup/source-evidence"
                    || specifier === "domain/eformsign-backup/worker" || specifier.startsWith("domain/eformsign-backup/worker/"),
                ).toBe(true);
            }
            expect(source).not.toMatch(/\b(unlink|unlinkSync|rmdir|rmSync|rm)\b/);
            expect(source).not.toMatch(/process\.env/);
            expect(source).not.toMatch(/(BadRequest|NotFound|Conflict|Forbidden|Unauthorized|InternalServerError|ServiceUnavailable|BadGateway|Http)Exception/);
        }
    });
});
