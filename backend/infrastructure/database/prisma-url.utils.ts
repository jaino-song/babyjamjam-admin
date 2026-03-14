import { Prisma } from "@prisma/client";

const DEFAULT_PGBOUNCER_CONNECTION_LIMIT = "5";

export interface PrismaClientConfigResult {
    options?: Prisma.PrismaClientOptions;
    appliedDefaults: string[];
}

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

export function createPrismaClientConfig(
    rawUrl = process.env["DATABASE_URL"],
): PrismaClientConfigResult {
    if (!rawUrl) {
        return { appliedDefaults: [] };
    }

    const datasourceUrl = stripWrappingQuotes(rawUrl);
    const parsedUrl = new URL(datasourceUrl);
    const appliedDefaults: string[] = [];

    if (parsedUrl.searchParams.get("pgbouncer") === "true") {
        if (!parsedUrl.searchParams.has("connection_limit")) {
            parsedUrl.searchParams.set(
                "connection_limit",
                process.env["PRISMA_CONNECTION_LIMIT"] ?? DEFAULT_PGBOUNCER_CONNECTION_LIMIT,
            );
            appliedDefaults.push(`connection_limit=${parsedUrl.searchParams.get("connection_limit")}`);
        }

        const poolTimeout = process.env["PRISMA_POOL_TIMEOUT"];
        if (poolTimeout && !parsedUrl.searchParams.has("pool_timeout")) {
            parsedUrl.searchParams.set("pool_timeout", poolTimeout);
            appliedDefaults.push(`pool_timeout=${poolTimeout}`);
        }
    }

    return {
        options: {
            datasources: {
                db: {
                    url: parsedUrl.toString(),
                },
            },
        },
        appliedDefaults,
    };
}
