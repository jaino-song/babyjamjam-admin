import { createPrismaClientConfig } from "infrastructure/database/prisma-url.utils";

describe("createPrismaClientConfig", () => {
    const originalConnectionLimit = process.env["PRISMA_CONNECTION_LIMIT"];
    const originalPoolTimeout = process.env["PRISMA_POOL_TIMEOUT"];

    afterEach(() => {
        if (originalConnectionLimit === undefined) {
            delete process.env["PRISMA_CONNECTION_LIMIT"];
        } else {
            process.env["PRISMA_CONNECTION_LIMIT"] = originalConnectionLimit;
        }

        if (originalPoolTimeout === undefined) {
            delete process.env["PRISMA_POOL_TIMEOUT"];
        } else {
            process.env["PRISMA_POOL_TIMEOUT"] = originalPoolTimeout;
        }
    });

    it("adds a conservative connection limit when using a pgbouncer url", () => {
        const result = createPrismaClientConfig(
            "postgresql://user:pass@pooler.supabase.com:6543/postgres?pgbouncer=true",
        );

        const url = result.options?.datasources?.db?.url;

        expect(url).toContain("pgbouncer=true");
        expect(url).toContain("connection_limit=5");
        expect(result.appliedDefaults).toContain("connection_limit=5");
    });

    it("preserves an explicit connection limit", () => {
        const result = createPrismaClientConfig(
            "postgresql://user:pass@pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=2",
        );

        const url = result.options?.datasources?.db?.url;

        expect(url).toContain("connection_limit=2");
        expect(result.appliedDefaults).toHaveLength(0);
    });

    it("applies pool timeout only when requested through env", () => {
        process.env["PRISMA_POOL_TIMEOUT"] = "20";

        const result = createPrismaClientConfig(
            "postgresql://user:pass@pooler.supabase.com:6543/postgres?pgbouncer=true",
        );

        const url = result.options?.datasources?.db?.url;

        expect(url).toContain("pool_timeout=20");
        expect(result.appliedDefaults).toContain("pool_timeout=20");
    });
});
