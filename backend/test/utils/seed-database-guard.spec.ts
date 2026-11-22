import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";

import { DEFAULT_SEED_ENV_FILE, resolveLocalSeedDatabaseUrl } from "./seed-database-guard";

const LOCAL_URL = "postgresql://postgres@localhost:5432/postgres";
const REMOTE_URL = "postgresql://seed-user:s3cret-pw@abc.pooler.supabase.com:6543/postgres?pgbouncer=true";

describe("resolveLocalSeedDatabaseUrl", () => {
    let tempDir: string;
    let envFilePath: string;

    beforeEach(() => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), "seed-database-guard-"));
        envFilePath = path.join(tempDir, "seed.env");
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("uses the backend .env path by default without reading it", () => {
        expect(DEFAULT_SEED_ENV_FILE).toBe(path.resolve(__dirname, "../../.env"));
    });

    it.each([
        LOCAL_URL,
        "postgresql://postgres:postgres@127.0.0.1:55432/babyjamjam_auth_e2e",
        "postgresql://postgres@[::1]:5432/x",
        "postgresql://postgres@LOCALHOST:5432/postgres",
        "postgres://postgres@localhost:5432/postgres",
    ])("returns the checked loopback URL %s", (databaseUrl) => {
        for (const directUrl of [undefined, "postgresql://postgres@[::1]:5432/direct"]) {
            expect(resolveLocalSeedDatabaseUrl({
                env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
                envFilePath,
            })).toBe(databaseUrl);
        }
    });

    it.each([
        [REMOTE_URL, "host is not a local database"],
        ["postgresql://postgres@db.example.invalid:5432/x", "host is not a local database"],
        ["postgresql://postgres@127.0.0.2:5432/x", "host is not a local database"],
        ["postgresql://postgres@0.0.0.0:5432/x", "host is not a local database"],
        ["postgresql://postgres@postgres:5432/x", "host is not a local database"],
        ["https://localhost/x", "protocol is not postgresql"],
        ["not a URL", "is not a valid postgres URL"],
        ["postgresql://postgres@::1:5432/x", "is not a valid postgres URL"],
        ["postgresql://postgres@localhost/x?host=evil.example", "sets the host in its query string"],
        ["postgresql://postgres@localhost/x?HOSTADDR=10.0.0.1", "sets the host in its query string"],
        ["postgresql://postgres@localhost/${DATABASE_NAME}", "is not a valid postgres URL"],
    ])("refuses an unsafe DATABASE_URL %s", (databaseUrl, reason) => {
        expect(() => resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: databaseUrl },
            envFilePath,
        })).toThrow(`Refusing seed: DATABASE_URL ${reason}`);
    });

    it("refuses a missing DATABASE_URL with no env file", () => {
        expect(() => resolveLocalSeedDatabaseUrl({ env: {}, envFilePath }))
            .toThrow("Refusing seed: DATABASE_URL is not set");
    });

    it("uses the supplied label and reports the allowed hosts", () => {
        expect(() => resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: REMOTE_URL }, envFilePath, label: "auth-e2e seed",
        })).toThrow(new Error('Refusing auth-e2e seed: DATABASE_URL host is not a local database (allowed: localhost, 127.0.0.1, ::1)'));
    });

    it.each([
        REMOTE_URL,
        "mysql://localhost/x",
        "invalid direct URL",
        "postgresql://localhost/x?HoSt=evil.example",
        "postgresql://localhost/x?HOSTADDR=10.0.0.1",
    ])("checks DIRECT_URL with the same rules: %s", (directUrl) => {
        expect(() => resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: LOCAL_URL, DIRECT_URL: directUrl }, envFilePath,
        })).toThrow("Refusing seed: DIRECT_URL");
    });

    it("refuses a remote DATABASE_URL from the env file", () => {
        writeFileSync(envFilePath, `DATABASE_URL="${REMOTE_URL}"\n`);
        expect(() => resolveLocalSeedDatabaseUrl({ env: {}, envFilePath }))
            .toThrow("DATABASE_URL host is not a local database");
    });

    it("accepts quoted loopback URLs and comments from the env file without mutating the environment", () => {
        writeFileSync(envFilePath, `# disposable database\nDATABASE_URL="${LOCAL_URL}"\nDIRECT_URL='postgresql://postgres@127.0.0.1/direct'\n`);
        const env: NodeJS.ProcessEnv = {};
        const processEnvBefore = { ...process.env };
        expect(resolveLocalSeedDatabaseUrl({ env, envFilePath })).toBe(LOCAL_URL);
        expect(env).toEqual({});
        expect(process.env).toEqual(processEnvBefore);
    });

    it("gives each non-empty environment value precedence over the file", () => {
        writeFileSync(envFilePath, `DATABASE_URL=${REMOTE_URL}\nDIRECT_URL=${REMOTE_URL}\n`);
        expect(resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: LOCAL_URL, DIRECT_URL: LOCAL_URL }, envFilePath,
        })).toBe(LOCAL_URL);
    });

    it("falls back to file values when environment values are empty", () => {
        writeFileSync(envFilePath, `DATABASE_URL=${LOCAL_URL}\nDIRECT_URL=${LOCAL_URL}\n`);
        expect(resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: "", DIRECT_URL: "" }, envFilePath,
        })).toBe(LOCAL_URL);
    });

    it("checks DIRECT_URL from the file even with DATABASE_URL in the environment", () => {
        writeFileSync(envFilePath, `DATABASE_URL=${REMOTE_URL}\nDIRECT_URL=${REMOTE_URL}\n`);
        expect(() => resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: LOCAL_URL }, envFilePath,
        })).toThrow("DIRECT_URL host is not a local database");
    });

    it("ignores an empty DIRECT_URL in the file", () => {
        writeFileSync(envFilePath, "DIRECT_URL=\n");
        expect(resolveLocalSeedDatabaseUrl({
            env: { DATABASE_URL: LOCAL_URL }, envFilePath,
        })).toBe(LOCAL_URL);
    });

    it.each([
        ["postgresql://u:s3cret-pw@abc.pooler.supabase.com:6543/postgres?pgbouncer=true", "host is not a local database (allowed: localhost, 127.0.0.1, ::1)"],
        ["postgresql://u:s3cret-pw@abc.pooler.supabase.com:badport/x", "is not a valid postgres URL"],
        [REMOTE_URL, "host is not a local database (allowed: localhost, 127.0.0.1, ::1)"],
        ["https://seed-user:s3cret-pw@localhost/x?private-query=true", "protocol is not postgresql"],
        ["postgresql://seed-user:s3cret-pw@localhost/x?host=evil.example", "sets the host in its query string"],
        ["postgresql://seed-user:s3cret-pw@localhost/x?HOSTADDR=10.0.0.1", "sets the host in its query string"],
        ["postgresql://alice/x:pw@db.example.com/x", "host is not a local database (allowed: localhost, 127.0.0.1, ::1)"],
        ["postgresql://alice?x:pw@db.example.com/x", "host is not a local database (allowed: localhost, 127.0.0.1, ::1)"],
        ["postgresql://al:ice@pw-fragment/x@db.example.com:5432/x", "host is not a local database (allowed: localhost, 127.0.0.1, ::1)"],
    ])("does not expose credentials in inspected errors for %s", (unsafeUrl, reason) => {
        for (const variable of ["DATABASE_URL", "DIRECT_URL"]) {
            let caught: unknown;
            try {
                resolveLocalSeedDatabaseUrl({
                    env: { DATABASE_URL: LOCAL_URL, [variable]: unsafeUrl }, envFilePath,
                });
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(Error);
            if (!(caught instanceof Error)) throw new Error("Expected a refusal");
            expect(caught.message).toBe(`Refusing seed: ${variable} ${reason}`);
            const inspected = inspect(caught);
            expect(inspected).not.toContain("s3cret-pw");
            expect(inspected).not.toContain("seed-user");
            expect(inspected).not.toContain("u:");
            expect(inspected).not.toContain("pgbouncer=true");
            expect(inspected).not.toContain("private-query=true");
            expect(inspected).not.toContain("host=evil.example");
            expect(inspected).not.toContain("HOSTADDR=10.0.0.1");
            expect(inspected).not.toContain(unsafeUrl);
            expect(inspected).not.toContain(":6543");
            expect(inspected).not.toContain("alice");
            expect(inspected).not.toContain("pw-fragment");
            expect(inspected).not.toContain("al:ice");
            expect(inspected).not.toContain("x:pw");
            expect(inspected).not.toContain("db.example.com");
            expect(inspected).not.toContain("abc.pooler.supabase.com");
            expect(Reflect.get(caught, "cause")).toBeUndefined();
            expect(Object.keys(caught)).toEqual([]);
        }
    });
});
