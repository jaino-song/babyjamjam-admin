import { constants, promises as fs } from "node:fs";

import type { z } from "zod";

import { WorkerError, type WorkerReasonCode } from "domain/eformsign-backup/worker";

/** Reads one secret file under the contract W6 rules; every refusal is the caller's reason code, nothing else. */
async function readSecretText(path: string, maxBytes: number, reasonCode: WorkerReasonCode): Promise<string> {
    if (typeof path !== "string" || !path.startsWith("/")) throw new WorkerError(reasonCode);
    let file: import("node:fs/promises").FileHandle | undefined;
    try {
        file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > maxBytes) {
            throw new WorkerError(reasonCode);
        }
        const buffer = Buffer.alloc(stat.size);
        let filled = 0;
        while (filled < buffer.length) {
            const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        const text = buffer.subarray(0, filled).toString("utf8");
        return text.endsWith("\n") ? text.slice(0, -1) : text;
    } catch {
        throw new WorkerError(reasonCode);
    } finally {
        try { await file?.close(); } catch { /* nothing left to report */ }
    }
}

export interface SecretFileOptions {
    pattern: RegExp;
    maxBytes: number;
    reasonCode: WorkerReasonCode;
}

/**
 * Contract W6: an absolute path to a regular file (no symlink) with mode 0600, owned by the current user, at most
 * `maxBytes` long. One trailing newline is tolerated; the rest must match `pattern`. Every refusal is
 * `reasonCode`; no path or content reaches the error.
 */
export async function readSecretFile(path: string, options: SecretFileOptions): Promise<string> {
    const text = await readSecretText(path, options.maxBytes, options.reasonCode);
    if (!options.pattern.test(text)) throw new WorkerError(options.reasonCode);
    return text;
}

/** Same file rules for a JSON secret; `schema` should be strict. A parse or schema failure is `reasonCode`, never the content. */
export async function readSecretJson<T>(path: string, schema: z.ZodType<T>, maxBytes: number, reasonCode: WorkerReasonCode): Promise<T> {
    const text = await readSecretText(path, maxBytes, reasonCode);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new WorkerError(reasonCode); }
    const result = schema.safeParse(value);
    if (!result.success) throw new WorkerError(reasonCode);
    return result.data;
}
