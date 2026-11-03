import { constants, promises as fs } from "node:fs";

import { z } from "zod";

import { WorkerError, isPathIdentifier } from "domain/eformsign-backup/worker";
import { validateExportBaseUrl } from "./export-client";

/** Contract W6: one JSON file named by `--config`, strict, no environment variables. */
const CONFIG_MAX_BYTES = 64 * 1024;
const MIN_RESERVE_BYTES = 64 * 1024 * 1024;
const MIN_RESERVE_INODES = 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Drive takes every non-final chunk of a resumable upload in multiples of 256 KiB; the default is 8 MiB. */
const DRIVE_CHUNK_GRANULARITY = 262_144;
const DEFAULT_DRIVE_CHUNK_BYTES = 8_388_608;
const DEFAULT_DRIVE_ROOT_NAME = "bjj-eformsign-backup";
const DEFAULT_DRIVE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_DRIVE_BASE_URL = "https://www.googleapis.com";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WRITABLE_BY_OTHERS = 0o022;

/** Absolute, normalised, not the root, no trailing slash and no `.`/`..`/empty segment. */
export function isNormalAbsolutePath(value: unknown): value is string {
    return typeof value === "string" && value.length <= 4096 && value.startsWith("/") && value !== "/" && !value.includes("\u0000")
        && value.split("/").slice(1).every((part) => part !== "" && part !== "." && part !== "..");
}
const absolutePath = z.string().refine(isNormalAbsolutePath);
const reserveBytes = z.number().int().min(MIN_RESERVE_BYTES).max(Number.MAX_SAFE_INTEGER);
const reserveInodes = z.number().int().min(MIN_RESERVE_INODES).max(Number.MAX_SAFE_INTEGER);

function inside(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`);
}

/** https, or http for a loopback host only: the same rule as the export base url. */
const driveUrl = z.string().min(1).max(2048).refine((url) => {
    try {
        validateExportBaseUrl(url);
        return true;
    } catch {
        return false;
    }
});

/** Google Drive as the second destination (BJJ-456). Optional: a config without it behaves exactly as before. */
const driveSchema = z.strictObject({
    clientFile: absolutePath,
    refreshTokenFile: absolutePath,
    tokenUrl: driveUrl.default(DEFAULT_DRIVE_TOKEN_URL),
    apiBaseUrl: driveUrl.default(DEFAULT_DRIVE_BASE_URL),
    uploadBaseUrl: driveUrl.default(DEFAULT_DRIVE_BASE_URL),
    rootFolderName: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/).default(DEFAULT_DRIVE_ROOT_NAME),
    chunkBytes: z.number().int().min(DRIVE_CHUNK_GRANULARITY).multipleOf(DRIVE_CHUNK_GRANULARITY).default(DEFAULT_DRIVE_CHUNK_BYTES),
    requestTimeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
});

const configSchema = z.strictObject({
    schemaVersion: z.literal(1),
    enabled: z.boolean().default(false),
    companyId: z.string().refine(isPathIdentifier),
    exportBaseUrl: z.string().min(1).max(2048).refine((url) => {
        try {
            validateExportBaseUrl(url);
            return true;
        } catch {
            return false;
        }
    }),
    tokenFile: absolutePath,
    control: z.strictObject({ path: absolutePath, reserveBytes, reserveInodes }),
    archive: z.strictObject({
        path: absolutePath,
        archiveId: z.string().regex(UUID_PATTERN),
        reserveBytes,
        reserveInodes,
        requireMountPoint: z.boolean().default(true),
    }),
    requestTimeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
    drive: driveSchema.optional(),
}).superRefine((config, ctx) => {
    const control = config.control.path;
    const archive = config.archive.path;
    // One tree must never contain the other, and the credential must not sit in the archive.
    if (inside(control, archive) || inside(archive, control)) ctx.addIssue({ code: "custom", message: "control and archive overlap" });
    if (inside(archive, config.tokenFile)) ctx.addIssue({ code: "custom", message: "token file inside the archive" });
    // The Drive credentials are as secret as the export token: never in the archive (it is copied around) or in the control tree.
    if (config.drive !== undefined) {
        for (const secret of [config.drive.clientFile, config.drive.refreshTokenFile]) {
            if (inside(archive, secret) || inside(control, secret)) ctx.addIssue({ code: "custom", message: "drive secret file inside the archive or control" });
        }
    }
});

export type WorkerConfig = Readonly<z.infer<typeof configSchema>>;

/** The Drive settings the runner works with: every default applied, the request timeout falling back to the worker's. Paths only, no secret. */
export interface ResolvedDriveConfig {
    tokenUrl: string;
    apiBaseUrl: string;
    uploadBaseUrl: string;
    rootFolderName: string;
    chunkBytes: number;
    requestTimeoutMs: number;
}

/** `null` when the config has no `drive` block. */
export function resolveDriveConfig(config: WorkerConfig): ResolvedDriveConfig | null {
    const { drive } = config;
    if (drive === undefined) return null;
    return {
        tokenUrl: drive.tokenUrl, apiBaseUrl: drive.apiBaseUrl, uploadBaseUrl: drive.uploadBaseUrl, rootFolderName: drive.rootFolderName,
        chunkBytes: drive.chunkBytes, requestTimeoutMs: drive.requestTimeoutMs ?? config.requestTimeoutMs,
    };
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/**
 * Reads and validates the worker configuration. The file must be a regular file (never a symlink) owned by this user and
 * not writable by group or others. Every refusal is `config-invalid`; no path, value or parser message reaches the error.
 */
export async function loadWorkerConfig(configPath: string): Promise<WorkerConfig> {
    if (!isNormalAbsolutePath(configPath)) throw new WorkerError("config-invalid");
    let file: import("node:fs/promises").FileHandle | undefined;
    try {
        file = await fs.open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & WRITABLE_BY_OTHERS) !== 0 || stat.size > CONFIG_MAX_BYTES) {
            throw new WorkerError("config-invalid");
        }
        const buffer = Buffer.alloc(stat.size);
        let filled = 0;
        while (filled < buffer.length) {
            const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        const parsed = configSchema.safeParse(JSON.parse(buffer.subarray(0, filled).toString("utf8")));
        if (!parsed.success) throw new WorkerError("config-invalid");
        return deepFreeze(parsed.data);
    } catch {
        throw new WorkerError("config-invalid");
    } finally {
        try { await file?.close(); } catch { /* read-only handle */ }
    }
}
