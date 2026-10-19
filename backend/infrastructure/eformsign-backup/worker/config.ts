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
}).superRefine((config, ctx) => {
    const control = config.control.path;
    const archive = config.archive.path;
    // One tree must never contain the other, and the credential must not sit in the archive.
    if (inside(control, archive) || inside(archive, control)) ctx.addIssue({ code: "custom", message: "control and archive overlap" });
    if (inside(archive, config.tokenFile)) ctx.addIssue({ code: "custom", message: "token file inside the archive" });
});

export type WorkerConfig = Readonly<z.infer<typeof configSchema>>;

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
