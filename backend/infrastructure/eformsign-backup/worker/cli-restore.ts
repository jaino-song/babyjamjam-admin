import { WorkerError, identifier, isPathIdentifier, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import { isNormalAbsolutePath } from "./config";
import { restoreFromArchive } from "./restore";

export interface RestoreEnvironment {
    out?: (line: string) => void;
    err?: (line: string) => void;
}

interface RestoreArgs {
    archivePath: string;
    companyId: string;
    selector: { latest: true } | { snapshotId: string };
    outDir: string;
    allowIncomplete: boolean;
}

class UsageError extends Error {}

/** Strict, like the worker CLI: unknown, repeated or valueless flags and a missing or doubled selector are usage errors. */
function parse(args: readonly string[]): RestoreArgs {
    const seen = new Set<string>();
    let archivePath: string | null = null;
    let companyId: string | null = null;
    let outDir: string | null = null;
    let snapshotId: string | null = null;
    let latest = false;
    let allowIncomplete = false;
    for (let index = 0; index < args.length; index++) {
        const flag = args[index]!;
        if (seen.has(flag)) throw new UsageError();
        seen.add(flag);
        if (flag === "--latest") { latest = true; continue; }
        if (flag === "--allow-incomplete") { allowIncomplete = true; continue; }
        const value = args[++index];
        if (value === undefined || value.startsWith("--")) throw new UsageError();
        if (flag === "--archive") archivePath = value;
        else if (flag === "--company") companyId = value;
        else if (flag === "--out") outDir = value;
        else if (flag === "--snapshot") snapshotId = value;
        else throw new UsageError();
    }
    if (archivePath === null || companyId === null || outDir === null || (latest === (snapshotId !== null))) throw new UsageError();
    if (!isNormalAbsolutePath(archivePath) || !isPathIdentifier(companyId)) throw new UsageError();
    if (snapshotId !== null && !identifier.safeParse(snapshotId).success) throw new UsageError();
    return { archivePath, companyId, selector: snapshotId === null ? { latest: true } : { snapshotId }, outDir, allowIncomplete };
}

/** 65 data is wrong, 66 nothing to restore, 64 usage, 69 archive state, 70 anything else. */
export function restoreExitCode(reasonCode: WorkerReasonCode): number {
    switch (reasonCode) {
        case "restore-conflict": case "artifact-integrity": case "pdf-shape": return 65;
        case "not-initialized": return 66;
        case "restore-output-invalid": case "config-invalid": case "invalid-path-segment": return 64;
        case "archive-unavailable": case "archive-unsafe-path": case "archive-identity-mismatch": case "archive-marker-invalid": return 69;
        default: return 70;
    }
}

/** `restore --archive <abs> --company <id> (--latest | --snapshot <id>) [--allow-incomplete] --out <abs>`; stdout is one JSON line. */
export async function runRestoreCli(args: readonly string[], environment: RestoreEnvironment = {}): Promise<number> {
    const out = environment.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
    const err = environment.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
    try {
        const parsed = parse(args);
        const report = await restoreFromArchive(parsed);
        const artifacts = report.documents.reduce((total, doc) => total + doc.artifacts.length, 0);
        out(JSON.stringify({
            event: `restore_${report.status.replace("-", "_")}`,
            counts: { documents: report.documents.length, artifacts, gaps: report.gaps.length },
        }));
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            err("config-invalid");
            return 64;
        }
        if (error instanceof WorkerError) {
            err(error.reasonCode);
            return restoreExitCode(error.reasonCode);
        }
        err("internal");
        return 70;
    }
}
