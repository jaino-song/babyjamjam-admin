/** BJJ-494 only. No imports that load application modules or environment files. */
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export const QA_DATABASE_URL = "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4";
export const QA_BACKEND_ORIGIN = "http://127.0.0.1:63101";
export const APPROVED_ENV_PATHS = [
    "/Users/jaino/Development/babyjamjam-admin/bjj494-browser-qa/frontend/.env.local",
    "/Users/jaino/Development/babyjamjam-admin/service-record-followups/frontend/.env.local",
] as const;
const KEY = "DEVELOPMENT_API_BASE_URL";
const RECOVERY = ".env.bjj494-browser-qa.recovery.json";
export type QaOptions = { mode: "agent" | "legacy"; role: "admin" | "user"; internalBackend: boolean; recover: boolean };

export function parseQaOptions(args: string[]): QaOptions {
    const result: QaOptions = { mode: "agent", role: "admin", internalBackend: false, recover: false };
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index++) {
        const key = args[index]!;
        if (seen.has(key)) throw new Error("Duplicate QA option");
        seen.add(key);
        if (key === "--recover") result.recover = true;
        else if (key === "--internal-backend") result.internalBackend = true;
        else if (key === "--mode" && ["agent", "legacy"].includes(args[index + 1] ?? "")) result.mode = args[++index] as QaOptions["mode"];
        else if (key === "--role" && ["admin", "user"].includes(args[index + 1] ?? "")) result.role = args[++index] as QaOptions["role"];
        else throw new Error("Unsupported QA option");
    }
    if (result.recover && args.length !== 1) throw new Error("Recovery accepts no other options");
    return result;
}

export function assertQaDatabase(databaseUrl?: string, directUrl?: string): void {
    if (databaseUrl !== QA_DATABASE_URL || directUrl !== QA_DATABASE_URL) throw new Error("QA requires both exact disposable database URLs");
}

export function loopbackOrigin(value: string): string {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
            || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/"
            || value !== parsed.origin) throw new Error();
        return parsed.origin;
    } catch { throw new Error("Invalid local QA origin"); }
}

function privateFile(path: string): Buffer {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error("QA file must be a private regular file");
    return readFileSync(path);
}

function ownedLine(bytes: Buffer) {
    // latin1 makes string offsets identical to byte offsets, preserving even
    // unrelated non-UTF8 bytes. Only the owned ASCII line is ever replaced.
    const source = bytes.toString("latin1");
    const candidates = source.match(/^[ \t]*(?:export[ \t]+)?DEVELOPMENT_API_BASE_URL[ \t]*[=:][^\r\n]*/gm) ?? [];
    const match = /^DEVELOPMENT_API_BASE_URL=([^\r\n]+)(?=\r?$)/m.exec(source);
    if (candidates.length !== 1 || !match) throw new Error("QA requires exactly one plain existing backend URL line");
    return { start: match.index, end: match.index + match[0].length, url: loopbackOrigin(match[1]!) };
}

/** Test IO mapping is a programmatic seam only. Public apply/restore and the CLI
 * never accept mappings; the immutable logical allowlist is checked first. */
export function createQaEnvAdapter(io: { resolvePath?: (logical: string) => string; onAtomicTemp?: (path: string) => void } = {}) {
    const target = (logical: string) => {
        if (!(APPROVED_ENV_PATHS as readonly string[]).includes(logical)) throw new Error("Unapproved QA env path");
        return io.resolvePath ? io.resolvePath(logical) : logical;
    };
    const atomic = (path: string, before: Buffer, after: Buffer) => {
        const temporary = join(dirname(path), `.env.bjj494-${randomBytes(12).toString("hex")}.tmp`);
        let fd: number | undefined;
        try {
            fd = openSync(temporary, "wx", 0o600);
            writeFileSync(fd, after); fsyncSync(fd); closeSync(fd); fd = undefined;
            io.onAtomicTemp?.(temporary);
            if (!privateFile(path).equals(before)) throw new Error("QA env changed during atomic replacement");
            renameSync(temporary, path);
        } finally {
            if (fd !== undefined) closeSync(fd);
            if (existsSync(temporary)) unlinkSync(temporary);
        }
    };
    const replace = (bytes: Buffer, line: ReturnType<typeof ownedLine>, value: string) => Buffer.concat([
        bytes.subarray(0, line.start), Buffer.from(`${KEY}=${value}`, "ascii"), bytes.subarray(line.end),
    ]);
    return {
        apply(logical: string, request = { key: KEY, value: QA_BACKEND_ORIGIN }) {
            if (Object.keys(request).sort().join(",") !== "key,value" || request.key !== KEY || request.value !== QA_BACKEND_ORIGIN) throw new Error("Unapproved QA env edit");
            const path = target(logical); const recovery = join(dirname(path), RECOVERY);
            if (existsSync(recovery)) throw new Error("QA recovery metadata already exists; recover after stopping owned processes");
            const before = privateFile(path); const line = ownedLine(before);
            if (line.url === QA_BACKEND_ORIGIN) throw new Error("QA env is already adapted; explicit recovery required");
            const fd = openSync(recovery, "wx", 0o600);
            try { writeFileSync(fd, JSON.stringify({ originalUrl: line.url })); fsyncSync(fd); } finally { closeSync(fd); }
            // Keep recovery metadata on any failure; never overwrite it on retry.
            try { atomic(path, before, replace(before, line, QA_BACKEND_ORIGIN)); }
            catch (error) {
                // If nothing changed, there is nothing to recover. Otherwise
                // retain the private URL record and fail closed for inspection.
                if (privateFile(path).equals(before)) unlinkSync(recovery);
                throw error;
            }
            return { adapted: true };
        },
        restore(logical: string) {
            const path = target(logical); const recovery = join(dirname(path), RECOVERY);
            const metadata: unknown = JSON.parse(privateFile(recovery).toString("utf8"));
            if (!metadata || typeof metadata !== "object" || Object.keys(metadata).join() !== "originalUrl"
                || typeof (metadata as { originalUrl?: unknown }).originalUrl !== "string") throw new Error("Invalid QA recovery metadata");
            const original = loopbackOrigin((metadata as { originalUrl: string }).originalUrl);
            if (original === QA_BACKEND_ORIGIN) throw new Error("Invalid QA recovery origin");
            const before = privateFile(path); const line = ownedLine(before);
            if (line.url !== QA_BACKEND_ORIGIN) throw new Error("Owned QA URL line changed; refusing restore");
            atomic(path, before, replace(before, line, original)); unlinkSync(recovery);
            return { restored: true };
        },
    };
}
export const applyQaEnv = (path: string) => createQaEnvAdapter().apply(path);
export const restoreQaEnv = (path: string) => createQaEnvAdapter().restore(path);

/** Same local dotenv forms as the native QA launcher, used only in memory. */
export function parseLocalEnv(source: string): Record<string, string> {
    const values: Record<string, string> = {};
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index++) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(lines[index]!);
        if (!match) continue;
        let raw = match[2]!.trimStart(); const quote = raw[0];
        if (quote === '"' || quote === "'") {
            while (raw.indexOf(quote, 1) < 0 && index + 1 < lines.length) raw += `\n${lines[++index]}`;
            const end = raw.indexOf(quote, 1);
            if (end < 0) throw new Error("Invalid local QA environment syntax");
            raw = raw.slice(1, end); values[match[1]!] = quote === '"' ? raw.replace(/\\n/g, "\n") : raw;
        } else values[match[1]!] = raw.split("#")[0]!.trim();
    }
    return values;
}

/** Values are never returned. Fail closed on key shapes dotenv accepts but a
 * process environment cannot safely shadow, including colon assignments. */
export function backendEnvKeys(source: string): string[] {
    const result: string[] = []; const lines = source.replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (/^\s*(?:#|$)/.test(line)) continue;
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:\s)(.*)$/.exec(line);
        if (!match) throw new Error("Cannot safely shadow backend env key");
        result.push(match[1]!);
        const raw = match[2]!.trimStart(); const quote = raw[0];
        if (["'", '"', "`"].includes(quote ?? "") && raw.indexOf(quote!, 1) < 0) {
            do { index++; } while (index < lines.length && !lines[index]!.includes(quote!));
            if (index === lines.length) throw new Error("Unterminated backend env value");
        }
    }
    return result;
}

export function backendEnvironment(root: string): NodeJS.ProcessEnv {
    const clean: NodeJS.ProcessEnv = {};
    for (const directory of [root, join(root, "backend"), join(root, "backend", "backend")]) {
        for (const name of [".env.local", ".env"]) {
            const path = join(directory, name);
            if (existsSync(path)) for (const key of backendEnvKeys(readFileSync(path, "utf8"))) clean[key] = "";
        }
    }
    for (const key of ["PATH", "HOME", "TMPDIR", "USER", "LANG"]) if (process.env[key]) clean[key] = process.env[key];
    return Object.assign(clean, {
        NODE_PATH: ".", NODE_ENV: "test", CI: "true", DATABASE_URL: QA_DATABASE_URL, DIRECT_URL: QA_DATABASE_URL,
        JWT_SECRET: randomBytes(32).toString("hex"), AUTH_EMAIL_TOKEN_HMAC_SECRET: randomBytes(32).toString("hex"),
        E2E_VENDOR_STUBS: "1", STORAGE_BOOTSTRAP_DISABLED: "1", SCHEDULERS_ENABLED: "false",
        EMAIL_TRANSPORT: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025", VALKEY_URL: "",
        DEVELOPMENT_FRONTEND_URL: "http://127.0.0.1:63110", DEVELOPMENT_MOBILE_FRONTEND_URL: "http://127.0.0.1:63112",
    });
}

/** Only the test backend installs this guard. Vendors are still stubbed at
 * their actual adapter boundary; this also refuses accidental Node egress. */
export function assertLocalSocketArguments(raw: unknown[]): void {
    const args = Array.isArray(raw[0]) ? raw[0] as unknown[] : raw;
    const first = args[0];
    let host: unknown = "localhost";
    if (first && typeof first === "object") {
        const options = first as { path?: unknown; host?: unknown };
        if (typeof options.path === "string") return; // local IPC socket
        host = options.host ?? "localhost";
    } else if (typeof first === "string" && !/^\d+$/.test(first)) return; // local IPC socket
    else if (typeof args[1] === "string") host = args[1];
    if (typeof host !== "string" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new Error("External network is disabled in BJJ494 QA");
}
