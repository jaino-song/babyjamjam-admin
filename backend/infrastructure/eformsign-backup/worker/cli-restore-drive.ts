import { z } from "zod";

import { WorkerError, driveFileId, type WorkerReasonCode } from "domain/eformsign-backup/worker";
import { isNormalAbsolutePath, loadWorkerConfig, resolveDriveConfig, type WorkerConfig } from "./config";
import { DriveTokenSource } from "./drive-auth";
import { DriveClient } from "./drive-client";
import { DriveRootSelectionError, restoreDrive } from "./restore-drive";
import { readSecretFile, readSecretJson } from "./secret-file";

export interface RestoreDriveEnvironment {
    out?: (line: string) => void;
    err?: (line: string) => void;
    /** Carries every Drive and OAuth call; the real `fetch` when absent. */
    fetchImpl?: typeof fetch;
    clock?: { now(): Date };
}

interface RestoreDriveArgs {
    configPath: string;
    outDir: string;
    rootFolderId: string | null;
}

class UsageError extends Error {}

/** Strict, like the other CLIs: unknown, repeated or valueless flags and a missing `--config` or `--out` are usage errors. */
function parse(args: readonly string[]): RestoreDriveArgs {
    const seen = new Set<string>();
    let configPath: string | null = null;
    let outDir: string | null = null;
    let rootFolderId: string | null = null;
    for (let index = 0; index < args.length; index++) {
        const flag = args[index]!;
        if (seen.has(flag)) throw new UsageError();
        seen.add(flag);
        const value = args[++index];
        if (value === undefined || value.startsWith("--")) throw new UsageError();
        if (flag === "--config") configPath = value;
        else if (flag === "--out") outDir = value;
        else if (flag === "--root-folder-id") rootFolderId = value;
        else throw new UsageError();
    }
    if (configPath === null || outDir === null || !isNormalAbsolutePath(configPath) || !isNormalAbsolutePath(outDir)) throw new UsageError();
    if (rootFolderId !== null && !driveFileId.safeParse(rootFolderId).success) throw new UsageError();
    return { configPath, outDir, rootFolderId };
}

const CLIENT_FILE_MAX_BYTES = 4096;
const REFRESH_TOKEN_MAX_BYTES = 1024;
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_\-/.]{20,512}$/;
const clientFileSchema = z.strictObject({ client_id: z.string().min(1).max(512), client_secret: z.string().min(1).max(512) });

/** The Drive client of a config's `drive` block; unreadable or badly permissioned secret files are `token-file-invalid`. No request is made. */
async function openClient(config: WorkerConfig, environment: RestoreDriveEnvironment): Promise<DriveClient> {
    const settings = resolveDriveConfig(config);
    if (settings === null || config.drive === undefined) throw new WorkerError("drive-not-configured");
    const credentials = await readSecretJson(config.drive.clientFile, clientFileSchema, CLIENT_FILE_MAX_BYTES, "token-file-invalid");
    const refreshToken = await readSecretFile(config.drive.refreshTokenFile, {
        pattern: REFRESH_TOKEN_PATTERN, maxBytes: REFRESH_TOKEN_MAX_BYTES, reasonCode: "token-file-invalid",
    });
    const fetchPart = environment.fetchImpl === undefined ? {} : { fetchImpl: environment.fetchImpl };
    const clock = environment.clock ?? { now: () => new Date() };
    const tokens = new DriveTokenSource({
        tokenUrl: settings.tokenUrl, clientId: credentials.client_id, clientSecret: credentials.client_secret, refreshToken,
        now: () => clock.now(), requestTimeoutMs: settings.requestTimeoutMs, ...fetchPart,
    });
    return new DriveClient({
        apiBaseUrl: settings.apiBaseUrl, uploadBaseUrl: settings.uploadBaseUrl, tokens,
        requestTimeoutMs: settings.requestTimeoutMs, chunkBytes: settings.chunkBytes, ...fetchPart,
    });
}

/** 64 the output directory, 65 a file failed verification, 69 Drive or its root, 78 configuration or token, 70 anything else. */
export function restoreDriveExitCode(reasonCode: WorkerReasonCode): number {
    switch (reasonCode) {
        case "restore-output-invalid": return 64;
        case "artifact-integrity": case "mirror-missing": return 65;
        case "config-invalid": case "token-file-invalid": case "drive-not-configured": case "drive-token-invalid": return 78;
        case "drive-root-changed": case "drive-permission": case "drive-quota": case "drive-conflict": case "drive-unavailable":
        case "network-timeout": case "rate-limited": return 69;
        default: return 70;
    }
}

/** `restore-drive --config <abs> --out <abs> [--root-folder-id <id>]`; stdout is one JSON line. */
export async function runRestoreDriveCli(args: readonly string[], environment: RestoreDriveEnvironment = {}): Promise<number> {
    const out = environment.out ?? ((line: string) => { process.stdout.write(`${line}\n`); });
    const err = environment.err ?? ((line: string) => { process.stderr.write(`${line}\n`); });
    try {
        const parsed = parse(args);
        const config = await loadWorkerConfig(parsed.configPath);
        const client = await openClient(config, environment);
        const report = await restoreDrive({
            client, archiveId: config.archive.archiveId, archivePath: config.archive.path, controlPath: config.control.path,
            outDir: parsed.outDir, ...(parsed.rootFolderId === null ? {} : { rootFolderId: parsed.rootFolderId }),
        });
        const ok = report.failed === 0;
        out(JSON.stringify({
            event: ok ? "restore_drive_verified" : "restore_drive_failed", rootFolderId: report.rootFolderId,
            counts: { verified: report.verified, failed: report.failed },
        }));
        if (ok) return 0;
        // One reason code on stderr: integrity wins over a conflict, a conflict over a missing file.
        const reasons = new Set(report.failures.map((failure) => failure.reason));
        err(reasons.has("artifact-integrity") ? "artifact-integrity" : reasons.has("drive-conflict") ? "drive-conflict" : "mirror-missing");
        return 65;
    } catch (error) {
        if (error instanceof UsageError) {
            err("config-invalid");
            return 64;
        }
        if (error instanceof DriveRootSelectionError) {
            out(JSON.stringify({ event: "restore_drive_root_ambiguous", reasonCode: error.reasonCode, candidates: error.candidates }));
            err(error.reasonCode);
            return restoreDriveExitCode(error.reasonCode);
        }
        if (error instanceof WorkerError) {
            err(error.reasonCode);
            return restoreDriveExitCode(error.reasonCode);
        }
        err("internal");
        return 70;
    }
}
