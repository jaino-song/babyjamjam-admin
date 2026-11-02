import { promises as fs } from "node:fs";
import path from "node:path";

import { exitCodeFor, runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";
import { WorkerRunner } from "infrastructure/eformsign-backup/worker/runner";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
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

    it("should still print the run line and its reasons on stdout when the run ends in archive-conflict: stderr is the reason code only, exit 69 (FU-13 M1)", async () => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")] });
        await initArchive(h);
        await runOnce(h);
        const file = path.join(h.archive, (await listFiles(h.archive)).find((name) => name.includes("/D001/manifests/"))!);
        const damaged = JSON.parse(await fs.readFile(file, "utf8"));
        damaged.artifacts[0].byteLength += 1;
        await fs.writeFile(file, JSON.stringify(damaged));

        const run = await cli(["run", "--config", h.configPath]);

        expect(run.code).toBe(69);
        expect(run.stderr).toEqual(["archive-conflict"]);
        const events = lines(run);
        expect(events[0]).toMatchObject({ event: "run_blocked", runId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
        expect(events.slice(1)).toContainEqual(expect.objectContaining({ event: "run_reason", reasonCode: "archive-conflict" }));
        for (const line of events) for (const key of Object.keys(line)) expect(ALLOWED_KEYS.has(key)).toBe(true);
        expect(run.stdout.join("\n")).not.toContain(h.base);
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
        ["a repeated --rebind", ["drive-setup", "--config", "/x", "--rebind", "--rebind"], 78, "config-invalid"],
        ["--rebind on run", ["run", "--config", "/x", "--rebind"], 78, "config-invalid"],
        ["--rebind with a value", ["drive-setup", "--config", "/x", "--rebind", "yes"], 78, "config-invalid"],
        ["--rebind=1", ["drive-setup", "--config", "/x", "--rebind=1"], 78, "config-invalid"],
        ["--installation-id on drive-setup", ["drive-setup", "--config", "/x", "--installation-id", "abc"], 78, "config-invalid"],
        ["--scheduled-for on drive-setup", ["drive-setup", "--config", "/x", "--scheduled-for", "2026-10-19T09:00:00+09:00"], 78, "config-invalid"],
        ["--all on drive-setup", ["drive-setup", "--config", "/x", "--all"], 78, "config-invalid"],
        ["a drive-setup without --config", ["drive-setup", "--rebind"], 78, "config-invalid"],
        ["--drive-root-folder-id on run", ["run", "--config", "/x", "--drive-root-folder-id", "abcdefghij1234"], 78, "config-invalid"],
        ["--drive-root-folder-id on drive-setup", ["drive-setup", "--config", "/x", "--drive-root-folder-id", "abcdefghij1234"], 78, "config-invalid"],
        ["--drive-root-folder-id without a value", ["recover", "--config", "/x", "--installation-id", "abc", "--drive-root-folder-id"], 78, "config-invalid"],
        ["a --drive-root-folder-id that is not a Drive id", ["recover", "--config", "/x", "--installation-id", "abc", "--drive-root-folder-id", "bad id!"], 78, "config-invalid"],
        ["a --drive-root-folder-id that is too short", ["recover", "--config", "/x", "--installation-id", "abc", "--drive-root-folder-id", "short"], 78, "config-invalid"],
        ["a repeated --drive-root-folder-id", ["recover", "--config", "/x", "--installation-id", "abc", "--drive-root-folder-id", "abcdefghij1234", "--drive-root-folder-id", "abcdefghij1234"], 78, "config-invalid"],
        ["a --drive-root-folder-id without --installation-id", ["recover", "--config", "/x", "--drive-root-folder-id", "abcdefghij1234"], 78, "config-invalid"],
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

    describe("drive-setup and recover arguments reach the runner (BJJ-456 U4)", () => {
        afterEach(() => { jest.restoreAllMocks(); });

        it.each([
            [["drive-setup"], { rebind: false }],
            [["drive-setup", "--rebind"], { rebind: true }],
        ])("should pass %j to driveSetup as %j and print one drive_bound line", async (args, expected) => {
            h = await createHarness({ docs: [] });
            const driveSetup = jest.spyOn(WorkerRunner.prototype, "driveSetup").mockResolvedValue({
                rootFolderId: "RootFolderId0000001", destinationRevision: "drive-layout-v1:00000000-0000-4000-8000-000000000001",
            });
            const result = await cli([...args, "--config", h.configPath]);
            expect(driveSetup).toHaveBeenCalledWith(expected);
            expect(result).toMatchObject({ code: 0, stderr: [] });
            expect(lines(result)).toEqual([{
                event: "drive_bound", rootFolderId: "RootFolderId0000001",
                destinationRevision: "drive-layout-v1:00000000-0000-4000-8000-000000000001",
            }]);
        });

        it("should pass --drive-root-folder-id to recover and omit it when absent", async () => {
            h = await createHarness({ docs: [] });
            const recover = jest.spyOn(WorkerRunner.prototype, "recover").mockResolvedValue({
                outcome: "finished", recovered: 0, unverified: 0, sequenceFloor: 0, knownGaps: 0,
            });
            await cli(["recover", "--config", h.configPath, "--installation-id", "abc", "--drive-root-folder-id", "RootFolderId0000001"]);
            await cli(["recover", "--config", h.configPath, "--installation-id", "abc"]);
            expect(recover.mock.calls[0]![0]).toEqual({ installationId: "abc", driveRootFolderId: "RootFolderId0000001" });
            expect(recover.mock.calls[1]![0]).toEqual({ installationId: "abc" });
        });

        it("should refuse drive-setup before init with not-initialized (69) and without a drive block with drive-not-configured (78)", async () => {
            h = await createHarness({ docs: [] });
            expect(await cli(["drive-setup", "--config", h.configPath])).toMatchObject({ code: 69, stdout: [], stderr: ["not-initialized"] });
            await initArchive(h);
            expect(await cli(["drive-setup", "--config", h.configPath])).toMatchObject({ code: 78, stdout: [], stderr: ["drive-not-configured"] });
        });
    });

    describe("exit codes of the Drive reason codes (BJJ-456 U4)", () => {
        it.each([
            ["drive-token-invalid", 78],
            ["drive-not-configured", 78],
            ["drive-root-changed", 69],
            ["drive-permission", 69],
            ["drive-quota", 69],
            ["drive-conflict", 69],
            ["drive-unavailable", 69],
            ["config-invalid", 78],
            ["token-file-invalid", 78],
            ["control-space", 74],
            ["archive-unavailable", 69],
            ["rate-limited", 70],
            ["network-timeout", 70],
            ["crashed", 70],
        ] as const)("should map %s to exit %i", (reasonCode, code) => {
            expect(exitCodeFor(reasonCode)).toBe(code);
        });
    });

    describe("Drive secrets are read after the lock check and only by the commands that use them (BJJ-456 U4)", () => {
        let fakes: DriveHarness;
        beforeEach(async () => { fakes = await startDriveFakes(); });
        afterEach(async () => { await fakes.close(); });

        async function withDrive(): Promise<void> {
            h = await createHarness({ docs: [pairDoc("D001")], config: { drive: fakes.config } as never });
            await initArchive(h);
        }
        const badMode = async (): Promise<void> => { await fs.chmod(fakes.refreshTokenFile, 0o644); };
        const untouched = (): void => {
            expect(fakes.oauth.tokenRequests).toBe(0);
            expect(fakes.drive.requests).toHaveLength(0);
        };

        it.each(["run", "drive-setup", "recover"])("should report lock-not-held, not token-file-invalid, for %s when the lock is not held and a Drive secret file is unusable", async (command) => {
            await withDrive();
            await badMode();
            const { createRealFsProbe } = await import("infrastructure/eformsign-backup/worker/fs-probe");
            const extra = command === "recover" ? ["--installation-id", "abc"] : [];
            const result = await cli([command, "--config", h.configPath, ...extra], { probe: createRealFsProbe() });
            expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["lock-not-held"] });
            untouched();
        });

        it.each(["run", "drive-setup", "recover"])("should report token-file-invalid before any request for %s when the refresh token file is not 0600", async (command) => {
            await withDrive();
            await badMode();
            const extra = command === "recover" ? ["--installation-id", "abc"] : [];
            const result = await cli([command, "--config", h.configPath, ...extra]);
            expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["token-file-invalid"] });
            expect(h.api.requests).toHaveLength(0);
            untouched();
        });

        it.each([
            ["a client file that is not strict JSON", async () => { await fs.writeFile(fakes.clientFile, "{not json", { mode: 0o600 }); }],
            ["a client file with an extra key", async () => { await fs.writeFile(fakes.clientFile, JSON.stringify({ client_id: "a", client_secret: "b", extra: 1 }), { mode: 0o600 }); }],
            ["a refresh token that does not match the pattern", async () => { await fs.writeFile(fakes.refreshTokenFile, "short", { mode: 0o600 }); }],
            ["a missing refresh token file", async () => { await fs.rm(fakes.refreshTokenFile); }],
            ["a refresh token file that is a symlink", async () => {
                const real = `${fakes.refreshTokenFile}.real`;
                await fs.rename(fakes.refreshTokenFile, real);
                await fs.symlink(real, fakes.refreshTokenFile);
            }],
        ])("should report token-file-invalid for %s", async (_name, damage) => {
            await withDrive();
            await damage();
            const result = await cli(["drive-setup", "--config", h.configPath]);
            expect(result).toMatchObject({ code: 78, stdout: [], stderr: ["token-file-invalid"] });
            untouched();
        });

        it("should let init and inspect work with unusable Drive secret files", async () => {
            h = await createHarness({ docs: [pairDoc("D001")], config: { drive: fakes.config } as never });
            await badMode();
            await fs.rm(fakes.clientFile);
            expect((await cli(["init", "--config", h.configPath])).code).toBe(0);
            expect((await cli(["inspect", "--config", h.configPath])).code).toBe(0);
            untouched();
        });

        it("should leave a run without a drive block exactly as before (no Drive reads at all)", async () => {
            h = await createHarness({ docs: [pairDoc("D001")] });
            await initArchive(h);
            const run = await cli(["run", "--config", h.configPath]);
            expect(run.code).toBe(0);
            untouched();
        });
    });
});
