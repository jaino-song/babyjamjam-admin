import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { resolve } from "node:path";

import { assertThrowawayTarget } from "../helpers/real-db";

export function applyStatusMigration(): SpawnSyncReturns<string> {
    assertThrowawayTarget();
    const migration = resolve(__dirname, "../../../prisma/migrations/20261031000100_eformsign_doc_status_type_canonicalize/migration.sql");
    const result = spawnSync("bash", [
        "scripts/run-prisma-db-execute.sh", "--schema", "prisma/schema.prisma", "--file", migration,
    ], { cwd: resolve(__dirname, "../../.."), encoding: "utf8", stdio: "pipe" });
    if (result.error) throw result.error;
    return result;
}
