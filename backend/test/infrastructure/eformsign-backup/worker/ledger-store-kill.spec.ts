import { spawn, type ChildProcess } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeLedgerLine, ledgerStateToJson } from "domain/eformsign-backup/worker";
import { LedgerStore, type LedgerFaultPoint } from "infrastructure/eformsign-backup/worker/ledger-store";
import { expectedSeededState, fixedAt, runStartedBody, testMarkerWriter } from "./helpers/ledger-fixtures";

const BACKEND_DIR = path.resolve(__dirname, "../../../..");
const HELPER = path.join(__dirname, "helpers", "ledger-kill-helper.ts");
const TOTAL = 6;
const POINTS: LedgerFaultPoint[] = [
    "before-write", "mid-write", "before-fsync", "after-fsync", "checkpoint-before-rename", "checkpoint-after-rename",
];

let root: string;
let counter = 0;
const children = new Set<ChildProcess>();

beforeAll(async () => {
    root = await fsp.mkdtemp(path.join(os.homedir(), "bjj455-ledger-kill-"));
});
afterEach(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    children.clear();
});
afterAll(async () => {
    await fsp.rm(root, { recursive: true, force: true });
});

async function newControl(): Promise<string> {
    const dir = path.join(root, `control-${++counter}`);
    await fsp.mkdir(dir, { mode: 0o700 });
    return dir;
}

function spawnHelper(control: string, point: LedgerFaultPoint, mode?: "pause"): ChildProcess {
    const child = spawn(process.execPath, [
        "-r", "ts-node/register/transpile-only", HELPER, control, point, String(TOTAL), ...(mode ? [mode] : []),
    ], { cwd: BACKEND_DIR, env: { ...process.env, NODE_PATH: "." }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    return child;
}

function exited(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve());
    });
}

async function runToKill(control: string, point: LedgerFaultPoint): Promise<ChildProcess> {
    const child = spawnHelper(control, point);
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    await exited(child);
    if (child.signalCode !== "SIGKILL") throw new Error(`helper was not killed at ${point}: code=${child.exitCode} stderr=${stderr}`);
    return child;
}

describe("T-WRK-06 SIGKILL at every ledger fault point", () => {
    it.each(POINTS)("after a kill at %s, open() is ok and lastSeq is N-1 or N, never a half record", async (point) => {
        const control = await newControl();
        const child = await runToKill(control, point);
        expect(child.signalCode).toBe("SIGKILL");

        const store = await LedgerStore.open(control, { writeMarker: testMarkerWriter });
        expect(store.status).toBe("ok");
        expect([TOTAL - 1, TOTAL]).toContain(store.lastSeq);

        // Every line on disk is a whole, valid record; the journal ends on a newline.
        const ledgerDir = path.join(control, "ledger");
        for (const name of (await fsp.readdir(ledgerDir)).filter((entry) => entry.startsWith("journal-"))) {
            const bytes = await fsp.readFile(path.join(ledgerDir, name));
            if (bytes.length === 0) continue;
            expect(bytes.at(-1)).toBe(0x0a);
            for (const line of bytes.toString("utf8").split("\n").slice(0, -1)) expect(decodeLedgerLine(line).ok).toBe(true);
        }

        if (point === "before-write") {
            expect(store.lastSeq).toBe(TOTAL - 1);
            expect(store.state.runs.size).toBe(TOTAL - 2);
            expect(store.reasons).toEqual([]);
        } else if (point === "mid-write") {
            // The half line is a torn tail: quarantined, and tail_discarded takes its place in the sequence.
            expect(store.reasons).toEqual(["torn-tail-repaired"]);
            expect(store.state.tailDiscards).toHaveLength(1);
            expect(store.state.runs.size).toBe(TOTAL - 2);
            const quarantine = await fsp.readFile(path.join(ledgerDir, store.state.tailDiscards[0]!.quarantineName));
            expect(quarantine.length).toBe(store.state.tailDiscards[0]!.byteLength);
            expect(quarantine.length).toBeGreaterThan(0);
            expect(quarantine.at(-1)).not.toBe(0x0a);
        } else {
            expect(store.lastSeq).toBe(TOTAL);
            expect(store.state.runs.size).toBe(TOTAL - 1);
            expect(store.reasons).toEqual([]);
            expect(ledgerStateToJson(store.state)).toEqual(ledgerStateToJson(expectedSeededState(TOTAL)));
        }

        // The ledger keeps working after the crash, and a second open agrees with the first.
        const next = store.lastSeq + 1;
        await store.append("run_started", runStartedBody(next + 100), fixedAt(next));
        await store.close();
        const again = await LedgerStore.open(control, { readOnly: true });
        expect(again.status).toBe("ok");
        expect(again.lastSeq).toBe(next);
    }, 120_000);

    it("a kill at checkpoint-after-rename leaves a checkpoint and no new journal, and that is a normal start", async () => {
        const control = await newControl();
        await runToKill(control, "checkpoint-after-rename");
        const names = (await fsp.readdir(path.join(control, "ledger"))).sort();
        expect(names).toContain("checkpoint.json");
        expect(names).toContain("journal-000000000001.jsonl");
        expect(names).not.toContain(`journal-${String(TOTAL + 1).padStart(12, "0")}.jsonl`);
        const store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(store.lastSeq).toBe(TOTAL);
    }, 120_000);

    it("a kill at checkpoint-before-rename leaves no checkpoint", async () => {
        const control = await newControl();
        await runToKill(control, "checkpoint-before-rename");
        const names = await fsp.readdir(path.join(control, "ledger"));
        expect(names).not.toContain("checkpoint.json");
        const store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(store.lastSeq).toBe(TOTAL);
    }, 120_000);
});

describe("read-only open next to a writer stopped mid-write", () => {
    async function readLine(child: ChildProcess): Promise<string> {
        return new Promise((resolve, reject) => {
            let buffered = "";
            const timer = setTimeout(() => reject(new Error("helper never paused")), 90_000);
            child.stdout?.on("data", (chunk: Buffer) => {
                buffered += chunk.toString();
                if (buffered.includes("\n")) { clearTimeout(timer); resolve(buffered.split("\n")[0]!); }
            });
            child.once("exit", () => { clearTimeout(timer); reject(new Error("helper exited before pausing")); });
        });
    }

    it("while the child is paused at mid-write the file size does not change and nothing is quarantined", async () => {
        const control = await newControl();
        const child = spawnHelper(control, "mid-write", "pause");
        expect(await readLine(child)).toBe("paused");
        const journal = path.join(control, "ledger", "journal-000000000001.jsonl");
        const size = (await fsp.stat(journal)).size;
        const names = (await fsp.readdir(path.join(control, "ledger"))).sort();

        const store = await LedgerStore.open(control, { readOnly: true });
        expect(store.status).toBe("ok");
        expect(store.reasons).toEqual(["torn-tail-ignored"]);
        expect(store.lastSeq).toBe(TOTAL - 1);
        expect((await fsp.stat(journal)).size).toBe(size);
        expect((await fsp.readdir(path.join(control, "ledger"))).sort()).toEqual(names);
        expect(names.some((name) => name.endsWith(".quarantine"))).toBe(false);

        child.kill("SIGKILL");
        await exited(child);
        expect(child.signalCode).toBe("SIGKILL");
        const after = await LedgerStore.open(control, { readOnly: true });
        expect(after.reasons).toEqual(["torn-tail-ignored"]);
        expect((await fsp.stat(journal)).size).toBe(size);
    }, 120_000);
});
