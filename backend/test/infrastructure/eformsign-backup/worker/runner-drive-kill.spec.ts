import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";
import { bindDrive, driveKeys, driveTree, duplicateNodes, PDF_KEY } from "./helpers/drive-run-support";
import { spawnUnderFlock } from "./helpers/runner-flock-support";
import { createHarness, destroyHarness, initArchive, pairDoc, readLedgerRecords, runOnce, type Harness } from "./helpers/runner-support";

const POINTS = [
    "drive-after-reserved-before-create",
    "drive-after-upload-before-verifying",
    "drive-after-verified",
] as const;

describe("V09: SIGKILL at every Drive step boundary, then the next run converges to one Drive object per key", () => {
    let h: Harness;
    let fakes: DriveHarness;

    beforeEach(async () => { fakes = await startDriveFakes(); });
    afterEach(async () => {
        await destroyHarness(h);
        await fakes.close();
    });

    it.each(POINTS)("should leave exactly one Drive object per key and every artifact verified after a kill at %s", async (point) => {
        h = await createHarness({ docs: [pairDoc("D001"), pairDoc("D002")], config: { drive: fakes.config } as never });
        await initArchive(h);
        await bindDrive(h);

        const child = spawnUnderFlock(h, ["run", "--config", h.configPath, "--kill-at", point]);
        expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
        expect((await readLedgerRecords(h.control)).some((record) => record.type === "run_finished")).toBe(false);

        h.clock.set(new Date(Date.now() + 60_000).toISOString());
        const summary = await runOnce(h);

        expect(summary).toMatchObject({ outcome: "finished", counts: { verified: 4, driveVerified: 4, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 } });
        const tree = await driveTree(h, fakes);
        expect(driveKeys(tree, PDF_KEY)).toHaveLength(4);
        expect(duplicateNodes(fakes)).toEqual([]);
        // Every Drive file the ledger knows is one live node: creates match the nodes the fake holds, bar My Drive.
        expect(fakes.drive.creates).toBe(fakes.drive.nodes().length - 1);
    }, 180_000);
});
