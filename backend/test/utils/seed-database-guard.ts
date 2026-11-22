import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const DEFAULT_SEED_ENV_FILE = path.resolve(__dirname, "../../.env");

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertLocalDatabaseUrl(rawUrl: string, variable: string, label: string): void {
    let parsed: URL;
    try {
        // Prisma expands dotenv variables; refuse unresolved values instead of guessing.
        if (rawUrl.includes("${")) throw new Error();
        parsed = new URL(rawUrl);
    } catch {
        // A URL parse error carries its credential-bearing input. Do not retain it.
        throw new Error(`Refusing ${label}: ${variable} is not a valid postgres URL`);
    }

    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
        throw new Error(`Refusing ${label}: ${variable} protocol is not postgresql`);
    }

    for (const parameter of parsed.searchParams.keys()) {
        if (parameter.toLowerCase() === "host" || parameter.toLowerCase() === "hostaddr") {
            throw new Error(`Refusing ${label}: ${variable} sets the host in its query string`);
        }
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!LOCAL_DATABASE_HOSTS.has(hostname)) {
        throw new Error(`Refusing ${label}: ${variable} host "${hostname}" is not a local database (allowed: localhost, 127.0.0.1, ::1)`);
    }
}

export function resolveLocalSeedDatabaseUrl(options: {
    env?: NodeJS.ProcessEnv;
    envFilePath?: string;
    label?: string;
} = {}): string {
    const { env = process.env, envFilePath = DEFAULT_SEED_ENV_FILE, label = "seed" } = options;
    const fileEnv = (!env["DATABASE_URL"] || !env["DIRECT_URL"]) && existsSync(envFilePath)
        ? parseEnv(readFileSync(envFilePath, "utf8"))
        : {};
    const databaseUrl = env["DATABASE_URL"] || fileEnv["DATABASE_URL"];
    const directUrl = env["DIRECT_URL"] || fileEnv["DIRECT_URL"];

    if (!databaseUrl) {
        throw new Error(`Refusing ${label}: DATABASE_URL is not set`);
    }
    assertLocalDatabaseUrl(databaseUrl, "DATABASE_URL", label);
    if (directUrl) assertLocalDatabaseUrl(directUrl, "DIRECT_URL", label);
    return databaseUrl;
}
