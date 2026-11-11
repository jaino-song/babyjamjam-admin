/** Disposable document-jobs QA only. Importing this module starts nothing and reads no env files. */
import * as children from "node:child_process";
import { get, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";

export const QA_PORTS = [62395, 3001, 63210] as const;
export const QA_DATABASE_URL = "postgresql://bjj_document_jobs_test@127.0.0.1:62395/bjj_document_jobs_qa";
export const QA_IDENTITY_PATH = "/__document-jobs-qa/identity";
const BACKEND_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001"];
const PROBE_TIMEOUT_MS = 1000;

export function assertQaDatabase(databaseUrl?: string, directUrl?: string): void {
    if (databaseUrl !== QA_DATABASE_URL || directUrl !== QA_DATABASE_URL) throw new Error("Wrong disposable QA database");
}

export function backendOrigins(source: string): string[] {
    if (/[\u2028\u2029]/.test(source)) throw new Error("Ambiguous QA environment line separator");
    const keys = ["DEVELOPMENT_API_BASE_URL", "NEXT_PUBLIC_API_BASE_URL"];
    const values = new Map<string, string>();
    for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
        if (/^\s*(?:#.*)?$/.test(line)) continue;
        // Every definition must begin on this physical line; no cross-line key, delimiter or quote continuations.
        if (!/^\s*(?:export\s+)?[\w.-]+\s*(?:=|:\s+)/.test(line)) throw new Error("Incomplete QA environment assignment");
        // Reject ambiguous quoted blocks without interpreting unrelated environment values.
        const quoted = /^\s*(?:export\s+)?[\w.-]+\s*(?:=|:\s+)\s*(["'`])/.exec(line);
        if (quoted) {
            const tail = line.slice(quoted[0].length);
            let closing = -1;
            // Next's dotenv grammar consumes any backslash-preceded quote as an escape, regardless of parity.
            for (let index = 0; index < tail.length; index++) {
                if (tail[index] === quoted[1] && tail[index - 1] !== "\\") { closing = index; break; }
            }
            if (closing < 0 || !/^\s*(?:#.*)?$/.test(tail.slice(closing + 1))) throw new Error("Ambiguous QA quoted assignment");
        }
        const target = /^\s*(?:export\s+)?(DEVELOPMENT_API_BASE_URL|NEXT_PUBLIC_API_BASE_URL)(?![\w.-])/.exec(line);
        if (!target) continue;
        const definition = /^\s*(?:export\s+)?(DEVELOPMENT_API_BASE_URL|NEXT_PUBLIC_API_BASE_URL)\s*=\s*(["']?)(http:\/\/(?:localhost|127\.0\.0\.1):3001)\2\s*(?:#.*)?$/.exec(line);
        const key = definition?.[1], origin = definition?.[3];
        if (!key || !origin || values.has(key)) throw new Error("Ambiguous QA backend definition");
        values.set(key, origin);
    }
    return keys.map(key => {
        const origin = values.get(key);
        if (!origin) throw new Error("Missing QA backend origin");
        return origin;
    });
}

function hasListener(host: string, port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        socket.setTimeout(PROBE_TIMEOUT_MS);
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("timeout", () => { socket.destroy(); reject(new Error("QA port probe timed out")); });
        socket.once("error", (error: NodeJS.ErrnoException) => {
            socket.destroy();
            if (error.code === "ECONNREFUSED") resolve(false);
            else reject(new Error("Cannot inspect QA port connection"));
        });
    });
}

/** lsof covers wildcard holders that coexist with specific-address binds on macOS. */
export async function assertPortFree(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid QA port");
    let output: string | undefined;
    try {
        output = children.execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"], {
            encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: PROBE_TIMEOUT_MS,
        });
    } catch (error) {
        const result = error as { status?: unknown; stdout?: unknown; stderr?: unknown };
        if (result.status !== 1 || String(result.stdout ?? "").trim() || String(result.stderr ?? "").trim()) {
            throw new Error("Cannot inspect QA port listeners");
        }
        output = undefined;
    }
    if (output !== undefined) throw new Error(output.trim() ? "QA port already occupied" : "Cannot inspect QA port listeners");
    const connected = await Promise.all([hasListener("127.0.0.1", port), hasListener("::1", port)]);
    if (connected.some(Boolean)) throw new Error("QA port already occupied");
}

export async function assertQaPortsFree(): Promise<void> {
    for (const port of QA_PORTS) await assertPortFree(port);
}

function readIdentity(origin: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = get(`${origin}${QA_IDENTITY_PATH}`, { agent: false }, response => {
            let body = "";
            response.setEncoding("utf8");
            response.on("error", () => reject(new Error("QA identity response failed")));
            response.on("data", (part: string) => {
                body += part;
                if (body.length > 256) request.destroy(new Error("QA identity response too large"));
            });
            response.on("end", () => {
                try {
                    if (response.statusCode !== 200) throw new Error();
                    resolve((JSON.parse(body) as { runId?: unknown }).runId);
                } catch { reject(new Error("Invalid QA identity response")); }
            });
        });
        request.setTimeout(PROBE_TIMEOUT_MS, () => request.destroy(new Error("QA identity timed out")));
        request.on("error", () => reject(new Error("QA identity request failed")));
    });
}

/** Shared probe supports ephemeral test ports; the runner must call the fixed-port wrapper below. */
export async function verifyOwnedIdentity(listeners: readonly Server[], origins: readonly string[], runId: string): Promise<void> {
    const addresses = listeners.map(listener => listener.listening ? listener.address() : null);
    if (listeners.length !== 2 || !runId || addresses.some(address => !address || typeof address === "string")) {
        throw new Error("Two owned QA listeners and a run identity are required");
    }
    const [first, second] = addresses as AddressInfo[];
    if (!first || !second || first.port !== second.port
        || new Set([first.address, second.address]).size !== 2
        || ![first.address, second.address].every(host => ["127.0.0.1", "::1"].includes(host))) {
        throw new Error("QA listener ownership mismatch");
    }
    const allowed = [`http://127.0.0.1:${first.port}`, `http://[::1]:${first.port}`, `http://localhost:${first.port}`];
    if (origins.some(origin => !allowed.includes(origin))) throw new Error("Unapproved QA identity origin");
    for (const origin of new Set([...allowed.slice(0, 2), ...origins])) {
        if (await readIdentity(origin) !== runId) throw new Error("QA run identity mismatch");
    }
}

export async function verifyQaBackendIdentity(listeners: readonly Server[], origins: readonly string[], runId: string): Promise<void> {
    if (origins.length !== 2 || origins.some(origin => !BACKEND_ORIGINS.includes(origin))
        || listeners.some(listener => (listener.address() as AddressInfo | null)?.port !== QA_PORTS[1])) {
        throw new Error("Wrong QA backend listeners or configured origins");
    }
    await verifyOwnedIdentity(listeners, origins, runId);
}

/** Diagnostics accept no error-derived text except an exact recognized errno. */
export function reportQaFailure(operation: "group-probe" | "group-signal" | "exit-listener-signal" | "journal-before" | "journal-after" | "directory-remove" | "execution", error: unknown, index?: number, signal?: "SIGTERM" | "SIGKILL", child?: children.ChildProcess): void {
    try {
        let code = "UNKNOWN";
        try {
            const candidate = (error as NodeJS.ErrnoException | null)?.code;
            if (typeof candidate === "string" && ["EPERM", "EACCES", "ESRCH", "EIO", "ENOENT", "ENOTEMPTY", "EBUSY", "EROFS", "ETIMEDOUT", "EINVAL"].includes(candidate)) code = candidate;
        } catch { /* Hostile getters cannot replace the original failure. */ }
        console.error(JSON.stringify({ operation, code,
            ...(Number.isSafeInteger(index) && index! >= 0 && index! <= 9999 ? { index } : {}),
            ...(signal ? { signal } : {}), ...(child ? { childState: child.signalCode !== null ? "signaled" : child.exitCode !== null ? "exited" : "running" } : {}),
        }));
    } catch { /* Reporting must preserve the original exception and cleanup policy. */ }
}

/** Only child objects created by this registry can be stopped; no caller-supplied PID is accepted. */
export function createOwnedChildren(): {
    spawn: (file: string, args: string[], options?: Pick<children.SpawnOptions, "cwd" | "env" | "stdio">) => children.ChildProcess;
    stop: (child: children.ChildProcess, signal?: "SIGTERM" | "SIGKILL") => void;
    cleanup: () => void;
} {
    const owned = new Set<children.ChildProcess>(); let nextIndex = 0;
    const stop = (child: children.ChildProcess, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void => {
        if (!owned.has(child)) throw new Error("Process is not owned by this QA run");
        if (child.pid !== undefined) {
            try { process.kill(-child.pid, signal); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        }
    };
    return {
        spawn(file, args, options = {}) {
            const child = children.spawn(file, args, { ...options, detached: true, shell: false, stdio: options.stdio ?? "ignore" });
            owned.add(child); const index = nextIndex++;
            child.once("exit", () => {
                try { if (owned.has(child)) stop(child, "SIGKILL"); }
                catch (error) { reportQaFailure("exit-listener-signal", error, index, "SIGKILL", child); throw error; }
                finally { owned.delete(child); }
            });
            child.once("error", () => owned.delete(child));
            return child;
        },
        stop,
        cleanup() { for (const child of owned) stop(child); },
    };
}
