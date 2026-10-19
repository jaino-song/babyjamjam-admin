import path from "node:path";

import {
    archivePdfs, createHarness, destinationStates, destroyHarness, initArchive, listFiles, pairDoc, readCompletions, readLedgerRecords, runOnce, singleDoc,
    type Harness,
} from "./helpers/runner-support";
import { spawnUnderFlock } from "./helpers/runner-flock-support";

const POINTS = [
    "after-transferring",
    "after-staged-before-staging_verified",
    "after-publish-before-verifying",
    "after-verifying-before-verified",
    "after-manifest-before-record",
    "after-completion-before-record",
] as const;

describe("T-WRK-17: SIGKILL at every runner step boundary, then the next run converges", () => {
    let h: Harness;
    afterEach(async () => { await destroyHarness(h); });

    it.each(POINTS)("should converge after a kill at %s: one file per artifact, all verified, a late crashed finish for the killed run", async (point) => {
        h = await createHarness({ docs: [pairDoc("D001"), singleDoc("D004")] });
        await initArchive(h);

        const child = spawnUnderFlock(h, ["run", "--config", h.configPath, "--kill-at", point]);
        expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
        const killed = await readLedgerRecords(h.control);
        expect(killed.some((record) => record.type === "run_finished")).toBe(false);
        const killedRun = killed.find((record) => record.type === "run_started")!.body["runId"];

        h.clock.set(new Date(Date.now() + 60_000).toISOString());
        const summary = await runOnce(h);

        expect(summary).toMatchObject({ outcome: "finished", counts: { verified: 3, blocked: 0, integrityError: 0, retryWait: 0 } });
        const pdfs = await archivePdfs(h.archive);
        expect(pdfs).toHaveLength(3);
        expect(new Set(pdfs).size).toBe(3);
        expect((await listFiles(h.archive)).filter((file) => file.includes(".corrupt-"))).toEqual([]);
        expect(Object.values(await destinationStates(h.control))).toEqual(["verified", "verified", "verified"]);

        const records = await readLedgerRecords(h.control);
        const late = records.find((record) => record.type === "run_finished" && record.body["runId"] === killedRun);
        expect(late?.body).toMatchObject({ snapshotStatus: "failed", reasonCodes: ["crashed"] });
        const newStart = records.findIndex((record) => record.type === "run_started" && record.body["runId"] !== killedRun);
        expect(records.indexOf(late!)).toBeLessThan(newStart);

        const files = await listFiles(h.archive);
        expect(files.filter((file) => file.includes("/manifests/"))).toHaveLength(2);
        const completions = await readCompletions(h.archive);
        expect(completions.length).toBeGreaterThanOrEqual(1);
        const last = completions[completions.length - 1]!.value;
        expect(last["entries"].map((entry: { documentId: string }) => entry.documentId)).toEqual(["D001", "D004"]);
        expect(records.filter((record) => record.type === "manifest_published").map((record) => record.body["relativeKey"]).sort()).toEqual(
            files.filter((file) => file.includes("/manifests/")).map((file) => file).sort());
        expect(path.basename(completions[completions.length - 1]!.name)).toMatch(/^\d{12}-[0-9a-f]{64}\.json$/);
    }, 180_000);
});
