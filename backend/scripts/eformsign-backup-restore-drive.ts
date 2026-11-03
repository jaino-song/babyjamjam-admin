/**
 * Operator CLI that copies the Google Drive archive of the eformsign backup into an empty directory, verifying every file
 * on the way (BJJ-456). It needs only the worker config (its `drive` block and the secret files that block names): no lock,
 * no ledger, no archive and no control directory. It never writes to Drive. Run `eformsign-backup-restore.ts` on the result.
 *
 * Run from backend/:
 *   NODE_PATH=. node -r ts-node/register/transpile-only scripts/eformsign-backup-restore-drive.ts \
 *     --config <abs path> --out <abs path> [--root-folder-id <id>]
 *
 * --out must be a new or empty directory outside the archive and control paths. A file that fails verification is not
 * written; it is listed in <out>/restore-drive-report.json. stdout: one JSON line. stderr: a reason code only.
 * Exit: 0 every file verified, 64 usage or bad --out, 65 a file failed verification, 69 Drive unavailable or no single
 * root, 70 internal, 78 configuration or token.
 */
import { runRestoreDriveCli } from "../infrastructure/eformsign-backup/worker/cli-restore-drive";

void runRestoreDriveCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
