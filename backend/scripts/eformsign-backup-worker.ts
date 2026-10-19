/**
 * Operator CLI for the BJJ-455 local backup worker. It holds no business logic: everything is in
 * infrastructure/eformsign-backup/worker/cli.ts. It needs no database and no Nest context.
 *
 * Run from backend/ under the worker lock (the process must hold it, `flock -F` makes the shell's flock the holder):
 *   NODE_PATH=. flock -n -F -E 75 <control>/worker.lock \
 *     node -r ts-node/register/transpile-only scripts/eformsign-backup-worker.ts <command> --config <abs path>
 *
 *   init                                  first install: archive marker, control marker, first ledger record
 *   run     [--scheduled-for <ISO+offset>]  one backup run (crash recovery first)
 *   verify  [--all]                       re-hash verified artifacts (default: older than 7 days)
 *   recover --installation-id <id>        rebuild a damaged ledger from the archive (refuses when unsure)
 *   inspect                               read-only report; needs no lock
 *
 * stdout: one JSON object per line ({event, runId?, reasonCode?, counts?}). stderr: a reason code only.
 * Exit: 0 ok, 69 state or archive, 70 internal, 74 control directory, 75 lock held elsewhere (from flock), 78 configuration.
 */
import { runWorkerCli } from "../infrastructure/eformsign-backup/worker/cli";

void runWorkerCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
