/**
 * Operator CLI for BJJ-454 machine export credentials.
 *
 * Run from backend/ with the target database configured in the environment:
 *   NODE_PATH=. pnpm exec ts-node scripts/eformsign-backup-export-credential.ts <command>
 *
 *   issue  --principal <id> --label <text> --company <id> [--company <id> ...]
 *   revoke --id <uuid>
 *   list
 *
 * `issue` prints `token=<raw>` and `id=<uuid>` on stdout. The raw token exists
 * nowhere else: the database keeps only its sha256. Nothing else is written to
 * stdout and the token is never logged.
 */
import "reflect-metadata";

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { resolve } from "node:path";

import { resolveEformsignBackfillTarget } from "application/utils/eformsign-backfill-safety";
import { DatabaseModule } from "infrastructure/database/database.module";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";

const PRINCIPAL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Same shape the snapshot builder requires of EFORMSIGN_COMPANY_ID (source-evidence assertIdentifier).
const COMPANY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL_LENGTH = 80;

export const CREDENTIAL_CLI_USAGE = [
    "Usage:",
    "  issue  --principal <id> --label <text> --company <id> [--company <id> ...]",
    "  revoke --id <uuid>",
    "  list",
    "principal: ^[a-z0-9][a-z0-9._-]{0,63}$   label: 1-80 chars   company: ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$",
].join("\n");

export class CredentialUsageError extends Error {
    constructor(reason: string) {
        // Argument values are never echoed: a mistyped token must not reach the terminal log.
        super(`${reason}\n${CREDENTIAL_CLI_USAGE}`);
        this.name = "CredentialUsageError";
    }
}

export type CredentialCommand =
    | { kind: "issue"; principalId: string; label: string; companyIds: string[] }
    | { kind: "revoke"; id: string }
    | { kind: "list" };

type FlagMap = Map<string, string[]>;

function readFlags(args: string[], allowed: readonly string[]): FlagMap {
    const flags: FlagMap = new Map();
    for (let index = 0; index < args.length; index++) {
        const arg = args[index] as string;
        if (!arg.startsWith("--")) throw new CredentialUsageError("Unexpected argument");
        const eq = arg.indexOf("=");
        const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
        if (!allowed.includes(name)) throw new CredentialUsageError("Unknown option");
        let value: string | undefined;
        if (eq !== -1) {
            value = arg.slice(eq + 1);
        } else {
            value = args[++index];
        }
        if (value === undefined) throw new CredentialUsageError(`Missing value for --${name}`);
        flags.set(name, [...(flags.get(name) ?? []), value]);
    }
    return flags;
}

function single(flags: FlagMap, name: string): string {
    const values = flags.get(name);
    if (!values || values.length === 0) throw new CredentialUsageError(`Missing --${name}`);
    if (values.length > 1) throw new CredentialUsageError(`--${name} may be given once`);
    return values[0] as string;
}

export function parseCredentialCommand(argv: string[]): CredentialCommand {
    const [command, ...rest] = argv;
    switch (command) {
        case "issue": {
            const flags = readFlags(rest, ["principal", "label", "company"]);
            const principalId = single(flags, "principal");
            if (!PRINCIPAL_PATTERN.test(principalId)) throw new CredentialUsageError("Invalid --principal");
            const label = single(flags, "label");
            if (label.length < 1 || label.length > MAX_LABEL_LENGTH) throw new CredentialUsageError("Invalid --label");
            const companies = flags.get("company") ?? [];
            if (companies.length === 0) throw new CredentialUsageError("Missing --company");
            if (!companies.every(company => COMPANY_PATTERN.test(company))) throw new CredentialUsageError("Invalid --company");
            return { kind: "issue", principalId, label, companyIds: [...new Set(companies)] };
        }
        case "revoke": {
            const id = single(readFlags(rest, ["id"]), "id");
            if (!UUID_PATTERN.test(id)) throw new CredentialUsageError("Invalid --id");
            return { kind: "revoke", id };
        }
        case "list":
            if (rest.length > 0) throw new CredentialUsageError("list takes no arguments");
            return { kind: "list" };
        default:
            throw new CredentialUsageError(command === undefined ? "Missing command" : "Unknown command");
    }
}

/**
 * The one stderr line naming the database this run will write to. It reuses the
 * backfill resolver, which keeps host, port, database and schema and replaces the
 * user with a fingerprint: neither the password nor the URL is ever printed.
 */
export function formatCredentialCliTarget(env: NodeJS.ProcessEnv): string {
    const target = resolveEformsignBackfillTarget({
        railwayEnvironmentName: env["RAILWAY_ENVIRONMENT_NAME"],
        nodeEnv: env["NODE_ENV"],
        databaseUrl: env["DATABASE_URL"],
    });
    return `target environment=${target.environment} databaseTarget=${target.databaseTarget}`;
}

/** Returns the process exit code. `print` is the only place output leaves this function. */
export async function runCredentialCommand(
    command: CredentialCommand,
    repository: Pick<SbEformsignBackupExportCredentialRepository, "issue" | "revoke" | "list">,
    print: (line: string) => void,
): Promise<number> {
    switch (command.kind) {
        case "issue": {
            const issued = await repository.issue({
                principalId: command.principalId,
                label: command.label,
                companyIds: command.companyIds,
            });
            print(`token=${issued.token}`);
            print(`id=${issued.id}`);
            return 0;
        }
        case "revoke": {
            const changed = await repository.revoke(command.id);
            print(changed ? `revoked=${command.id}` : `not-revoked=${command.id} (unknown or already revoked)`);
            return changed ? 0 : 1;
        }
        case "list": {
            for (const item of await repository.list()) {
                print(JSON.stringify({
                    ...item,
                    createdAt: item.createdAt.toISOString(),
                    revokedAt: item.revokedAt?.toISOString() ?? null,
                    lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
                }));
            }
            return 0;
        }
    }
}

const ENV_FILE_PATHS = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env.local"),
    resolve(process.cwd(), "backend/.env"),
];

@Module({
    imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATHS }), DatabaseModule],
    providers: [SbEformsignBackupExportCredentialRepository],
})
class EformsignBackupExportCredentialCliModule {}

async function main(): Promise<number> {
    let command: CredentialCommand;
    try {
        command = parseCredentialCommand(process.argv.slice(2));
    } catch (error) {
        if (error instanceof CredentialUsageError) {
            process.stderr.write(`${error.message}\n`);
            return 2;
        }
        throw error;
    }

    // ConfigModule.forRoot loaded the env files when this module was evaluated, so
    // process.env already holds the DATABASE_URL Prisma is about to use.
    process.stderr.write(`${formatCredentialCliTarget(process.env)}\n`);
    const app = await NestFactory.createApplicationContext(EformsignBackupExportCredentialCliModule, { logger: ["error", "warn"] });
    try {
        return await runCredentialCommand(command, app.get(SbEformsignBackupExportCredentialRepository), line => {
            process.stdout.write(`${line}\n`);
        });
    } finally {
        await app.close();
    }
}

if (require.main === module) {
    void main().then(
        code => { process.exitCode = code; },
        (error: unknown) => {
            // Name only: a driver error message can echo connection details.
            process.stderr.write(`Credential command failed: ${error instanceof Error ? error.name : "unknown error"}\n`);
            process.exitCode = 1;
        },
    );
}
