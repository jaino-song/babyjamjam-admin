import type { ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import { LocalDestination } from "infrastructure/eformsign-backup/worker/local-destination";

import { TEST_ARCHIVE_ID, probeFor, publishInput, streamOf } from "./destination-support";
import { buildMinimalPdf } from "./pdf-fixture-minimal";

/** Child process of T-WRK-07. argv: archive root, dev, ino, fault point. Publishes one artifact and SIGKILLs itself at the point. */
async function main(): Promise<void> {
    const [root, dev, ino, point] = process.argv.slice(2);
    if (!root || !dev || !ino || !point) process.exit(64);
    const pdf = buildMinimalPdf("kill");
    const destination = new LocalDestination({
        archivePath: root, archiveId: TEST_ARCHIVE_ID, expectedDev: Number(dev), expectedIno: Number(ino),
        reserveBytes: 1024 * 1024, reserveInodes: 100, requireMountPoint: false,
    }, probeFor(), (stage: ArchiveFaultPoint) => { if (stage === point) process.kill(process.pid, "SIGKILL"); });
    const result = await destination.publishArtifact(publishInput(pdf), streamOf(pdf, 64));
    process.exit(result.ok ? 0 : 1);
}
void main();
