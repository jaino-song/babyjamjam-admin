/**
 * Operator CLI that restores one backup from the archive alone (BJJ-455). It reads only the archive, never the
 * control directory, the ledger or the database, and never writes into the archive.
 *
 * Run from backend/:
 *   NODE_PATH=. node -r ts-node/register/transpile-only scripts/eformsign-backup-restore.ts \
 *     --archive <abs path> --company <id> (--latest | --snapshot <id>) [--allow-incomplete] --out <abs path>
 *
 * --out must be a new or empty directory outside the archive. The result is always reported as unverified:
 * the archive proves its own bytes, not that it holds every document.
 * stdout: one JSON line. stderr: a reason code only. Exit: 0 ok, 64 usage or bad --out, 65 conflict or damaged
 * data (nothing written), 66 nothing to restore, 69 archive unavailable, 70 internal.
 */
import { runRestoreCli } from "../infrastructure/eformsign-backup/worker/cli-restore";

void runRestoreCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
