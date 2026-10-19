import { promises as fs } from "node:fs";
import path from "node:path";

import { runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";

import {
    COMPANY, TOKEN, createHarness, destroyHarness, environmentFor, initArchive, listFiles, pairDoc, readLedgerRecords, rewriteConfig,
    runOnce, treeSignature, type Harness,
} from "./helpers/runner-support";

interface Captured { code: number; stdout: string[]; stderr: string[] }

describe("worker CLI (argv, exit codes, output)", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });

    async function cli(args: string[], extra: Parameters<typeof environmentFor>[1] = {}): Promise<Captured> {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const code = await runWorkerCli(args, environmentFor(h, { out: (line) => stdout.push(line), err: (line) => stderr.push(line), ...extra }));
        return { code, stdout, stderr };
    }
    const lines = (captured: Captured): Array<Record<string, unknown>> => captured.stdout.map((line) => JSON.parse(line));
    const ALLOWED_KEYS = new Set(["event", "runId", "reasonCode", "counts"]);

    it("should init, run and inspect: exit 0 and one JSON object per stdout line with only the documented keys", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });

        const init = await cli(["init", "--config", h.configPath]);
        expect(init.code).toBe(0);
        expect(lines(init).map((line) => line["event"])).toEqual(["initialized"]);

        const run = await cli(["run", "--config", h.configPath, "--scheduled-for", "2026-10-19T09:00:00+09:00"]);
        expect(run.code).toBe(0);
        const events = lines(run);
        expect(events[0]).toMatchObject({ event: "run_partial", runId: expect.stringMatching(/^[0-9a-f-]{36}$/), counts: { verified: 4, candidates: 2, included: 2 } });
        expect(events.slice(1).map((line) => line["reasonCode"])).toEqual(["coverage-unverified", "drive-not-configured"]);
        for (const line of [...lines(init), ...events]) {
            for (const key of Object.keys(line)) expect(ALLOWED_KEYS.has(key)).toBe(true);
        }
        const started = (await readLedgerRecords(h.control)).find((record) => record.type === "run_started")!;
        expect(started.body["scheduledFor"]).toBe("2026-10-19T09:00:00+09:00");
        expect(run.stderr).toEqual([]);

        const inspect = await cli(["inspect", "--config", h.configPath]);
        expect(inspect.code).toBe(0);
        expect(lines(inspect)[0]).toMatchObject({ event: "inspect", counts: { verified: 4 } });
    });

    it("should never print the token, a path or an error message: stderr is the reason code only", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        const result = await cli(["run", "--config", h.configPath]);
        expect(result).toMatchObject({ code: 69, stdout: [], stderr: ["not-initialized"] });
        await initArchive(h);
        const ok = await cli(["run", "--config", h.configPath]);
        expect([...ok.stdout, ...ok.stderr].join("\n")).not.toContain(TOKEN);
        expect([...ok.stdout, ...ok.stderr].join("\n")).not.toContain(h.base);
    });

    it.each([
        ["no arguments", [], 78, "config-invalid"],
        ["an unknown command", ["frobnicate", "--config", "/x"], 78, "config-invalid"],
        ["a missing --config", ["run"], 78, "config-invalid"],
        ["a relative --config", ["run", "--config", "worker.json"], 78, "config-invalid"],
        ["an unknown flag", ["run", "--config", "/x", "--force"], 78, "config-invalid"],
        ["a flag without a value", ["run", "--config"], 78, "config-invalid"],
        ["a repeated --config", ["run", "--config", "/a", "--config", "/b"], 78, "config-invalid"],
    ])("should exit 78 with config-invalid for %s, before anything is opened", async (_name, args, code, reason) => {
        h = await createHarness({ docs: [] });
        const before = [await treeSignature(h.control), await treeSignature(h.archive)];
        const result = await cli(args as string[]);
        expect(result).toMatchObject({ code, stdout: [], stderr: [reason] });
        expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
    });

    it("should exit 78 for a bad --scheduled-for and for a --installation-id that only recover takes", async () => {
        h = await createHarness({ docs: [] });
        expect((await cli(["run", "--config", h.configPath, "--scheduled-for", "yesterday"])).code).toBe(78);
        expect((await cli(["run", "--config", h.configPath, "--installation-id", "x"])).code).toBe(78);
        expect((await cli(["recover", "--config", h.configPath])).code).toBe(78);
        expect((await cli(["verify", "--config", h.configPath, "--scheduled-for", "2026-10-19T09:00:00+09:00"])).code).toBe(78);
    });

    it("should exit 78 with lock-not-held when the process does not hold the lock, and touch nothing", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        const before = [await treeSignature(h.control), await treeSignature(h.archive)];
        const { createRealFsProbe } = await import("infrastructure/eformsign-backup/worker/fs-probe");
        for (const command of ["run", "verify", "init"]) {
            const result = await cli([command, "--config", h.configPath], { probe: createRealFsProbe() });
            expect(result).toMatchObject({ code: 78, stderr: ["lock-not-held"] });
        }
        expect(h.api.requests).toHaveLength(0);
        expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
    });

    it("should exit 78 with token-file-invalid for a token file that is not 0600, before any request", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        await fs.chmod(h.tokenPath, 0o644);
        const result = await cli(["run", "--config", h.configPath]);
        expect(result).toMatchObject({ code: 78, stderr: ["token-file-invalid"] });
        expect(h.api.requests).toHaveLength(0);
    });

    it("should exit 69 for init over an installed archive and for recover on a healthy ledger", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        expect((await cli(["init", "--config", h.configPath])).code).toBe(69);
        expect((await cli(["recover", "--config", h.configPath, "--installation-id", "abc"])).code).toBe(69);
    });

    it("should exit 74 when the control ledger cannot be written", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        const result = await cli(["run", "--config", h.configPath], {
            ledgerFault: (point) => { if (point === "before-write") throw Object.assign(new Error("EIO"), { code: "EIO" }); },
        });
        expect(result).toMatchObject({ code: 74, stderr: ["control-unavailable"] });
    });

    it("should do nothing at all when enabled is false: disabled on stdout, exit 0, no network, no writes; init and inspect still work", async () => {
        h = await createHarness({ docs: [pairDoc("D001")], config: { enabled: false } });
        const first = await cli(["init", "--config", h.configPath]);
        expect(first.code).toBe(0);
        const before = [await treeSignature(h.control), await treeSignature(h.archive)];
        const files = await listFiles(h.control);

        for (const args of [["run"], ["verify", "--all"], ["recover", "--installation-id", "x"]]) {
            const result = await cli([args[0]!, "--config", h.configPath, ...args.slice(1)]);
            expect(result).toMatchObject({ code: 0, stderr: [] });
            expect(lines(result)).toEqual([{ event: "disabled" }]);
        }
        expect(h.api.requests).toHaveLength(0);
        expect([await treeSignature(h.control), await treeSignature(h.archive)]).toEqual(before);
        expect(await listFiles(h.control)).toEqual(files);
        expect((await cli(["inspect", "--config", h.configPath])).code).toBe(0);
    });

    it("should inspect read-only, without the lock, and report a damaged ledger without repairing it", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        await runOnce(h);
        const journal = path.join(h.control, "ledger", "journal-000000000001.jsonl");
        await fs.appendFile(journal, "{\"torn\":");
        const before = await treeSignature(h.control);
        const { createRealFsProbe } = await import("infrastructure/eformsign-backup/worker/fs-probe");

        const result = await cli(["inspect", "--config", h.configPath], { probe: createRealFsProbe() });

        expect(result.code).toBe(0);
        expect(lines(result)[0]).toMatchObject({ event: "inspect", counts: { verified: 2 } });
        expect(await treeSignature(h.control)).toBe(before);
        await fs.writeFile(journal, "garbage\n");
        const bad = await cli(["inspect", "--config", h.configPath], { probe: createRealFsProbe() });
        expect(bad.code).toBe(0);
        expect(lines(bad)[0]).toMatchObject({ event: "inspect", reasonCode: "recovery-required" });
    });

    it("should print the configuration's company nowhere but in the archive layout, never in the log lines", async () => {
        h = await createHarness({ docs: [pairDoc("D001")] });
        await initArchive(h);
        const result = await cli(["run", "--config", h.configPath]);
        expect(result.stdout.join("\n")).not.toContain(COMPANY);
        await rewriteConfig(h, { requestTimeoutMs: 5000 } as never);
        expect((await cli(["inspect", "--config", h.configPath])).code).toBe(0);
    });
});
