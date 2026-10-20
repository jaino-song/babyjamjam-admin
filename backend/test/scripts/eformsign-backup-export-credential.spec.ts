import { generateExportToken, hashExportToken } from "domain/eformsign-backup/export";
import {
    CredentialUsageError,
    formatCredentialCliTarget,
    parseCredentialCommand,
    runCredentialCommand,
} from "../../scripts/eformsign-backup-export-credential";

const UUID = "0b1f6b5e-2c1d-4a52-8d6a-0c6f6f1f8e11";

describe("eformsign backup export credential CLI: argument parsing", () => {
    it("parses issue with repeated --company and de-duplicates them", () => {
        expect(parseCredentialCommand(["issue", "--principal", "backup-worker-1", "--label", "nightly worker",
            "--company", "C1", "--company", "C2", "--company", "C1"])).toEqual({
            kind: "issue", principalId: "backup-worker-1", label: "nightly worker", companyIds: ["C1", "C2"],
        });
    });

    it("accepts --flag=value", () => {
        expect(parseCredentialCommand(["issue", "--principal=p1", "--label=l", "--company=C1"])).toEqual({
            kind: "issue", principalId: "p1", label: "l", companyIds: ["C1"],
        });
    });

    it("parses revoke and list", () => {
        expect(parseCredentialCommand(["revoke", "--id", UUID])).toEqual({ kind: "revoke", id: UUID });
        expect(parseCredentialCommand(["list"])).toEqual({ kind: "list" });
    });

    it.each([
        ["no command", []],
        ["unknown command", ["rotate"]],
        ["issue without principal", ["issue", "--label", "l", "--company", "C1"]],
        ["issue without label", ["issue", "--principal", "p1", "--company", "C1"]],
        ["issue without company", ["issue", "--principal", "p1", "--label", "l"]],
        ["uppercase principal", ["issue", "--principal", "Backup", "--label", "l", "--company", "C1"]],
        ["principal starting with a dot", ["issue", "--principal", ".p", "--label", "l", "--company", "C1"]],
        ["principal over 64 chars", ["issue", "--principal", "a".repeat(65), "--label", "l", "--company", "C1"]],
        ["empty label", ["issue", "--principal", "p1", "--label", "", "--company", "C1"]],
        ["label over 80 chars", ["issue", "--principal", "p1", "--label", "x".repeat(81), "--company", "C1"]],
        ["company with a space", ["issue", "--principal", "p1", "--label", "l", "--company", "bad id"]],
        ["flag without a value", ["issue", "--principal"]],
        ["unknown flag", ["issue", "--principal", "p1", "--label", "l", "--company", "C1", "--force", "1"]],
        ["repeated principal", ["issue", "--principal", "p1", "--principal", "p2", "--label", "l", "--company", "C1"]],
        ["revoke without id", ["revoke"]],
        ["revoke with a non-uuid id", ["revoke", "--id", "123"]],
        ["list with a flag", ["list", "--all"]],
    ])("rejects %s with a usage error", (_name, argv) => {
        expect(() => parseCredentialCommand(argv as string[])).toThrow(CredentialUsageError);
    });

    it("accepts an 80 char label and a 64 char principal", () => {
        expect(() => parseCredentialCommand(["issue", "--principal", "a".repeat(64), "--label", "x".repeat(80), "--company", "C1"])).not.toThrow();
    });

    it("never echoes a rejected argument value in the usage error", () => {
        const secret = "ebx_" + "S".repeat(43);
        try {
            parseCredentialCommand(["issue", "--principal", secret, "--label", "l", "--company", "C1"]);
            throw new Error("expected a usage error");
        } catch (error) {
            expect((error as Error).message).not.toContain(secret);
        }
    });
});

describe("eformsign backup export credential CLI: execution", () => {
    function repositoryMock() {
        return {
            issue: jest.fn(),
            revoke: jest.fn(),
            list: jest.fn(),
        };
    }

    it("issue prints exactly the token and id lines and nothing else", async () => {
        const token = generateExportToken();
        const repository = repositoryMock();
        repository.issue.mockResolvedValue({ id: UUID, token });
        const lines: string[] = [];

        await runCredentialCommand({ kind: "issue", principalId: "p1", label: "l", companyIds: ["C1"] }, repository as never, line => lines.push(line));

        expect(repository.issue).toHaveBeenCalledWith({ principalId: "p1", label: "l", companyIds: ["C1"] });
        expect(lines).toEqual([`token=${token}`, `id=${UUID}`]);
        expect(lines.join("\n")).not.toContain(hashExportToken(token));
    });

    it("revoke reports the outcome and signals a miss", async () => {
        const repository = repositoryMock();
        const lines: string[] = [];
        repository.revoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await expect(runCredentialCommand({ kind: "revoke", id: UUID }, repository as never, line => lines.push(line))).resolves.toBe(0);
        await expect(runCredentialCommand({ kind: "revoke", id: UUID }, repository as never, line => lines.push(line))).resolves.toBe(1);

        expect(lines).toEqual([`revoked=${UUID}`, `not-revoked=${UUID} (unknown or already revoked)`]);
    });

    it("list prints one JSON line per credential without any hash", async () => {
        const repository = repositoryMock();
        repository.list.mockResolvedValue([{
            id: UUID, principalId: "p1", label: "l", companyIds: ["C1"],
            createdAt: new Date("2026-10-19T00:00:00Z"), revokedAt: null, lastUsedAt: null,
        }]);
        const lines: string[] = [];

        await runCredentialCommand({ kind: "list" }, repository as never, line => lines.push(line));

        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] as string)).toEqual({
            id: UUID, principalId: "p1", label: "l", companyIds: ["C1"],
            createdAt: "2026-10-19T00:00:00.000Z", revokedAt: null, lastUsedAt: null,
        });
        expect(lines[0]).not.toMatch(/token/i);
    });
});

describe("eformsign backup export credential CLI: target line", () => {
    it("names environment, host, port and database", () => {
        expect(formatCredentialCliTarget({
            NODE_ENV: "development",
            DATABASE_URL: "postgresql://postgres@localhost:55441/throwaway_u33a",
        })).toMatch(/^target environment=development databaseTarget=localhost:55441\/throwaway_u33a\?/);
    });

    it("prefers the Railway environment name", () => {
        expect(formatCredentialCliTarget({ RAILWAY_ENVIRONMENT_NAME: "dev", NODE_ENV: "production", DATABASE_URL: "postgresql://u@h:5432/d" }))
            .toContain("environment=dev ");
    });

    it("never prints the password, the user name or the URL", () => {
        // Assembled at run time so secret scanners do not read the fixture as a hard-coded credential.
        const password = ["p4ss/w0rd", "SECRET@x"].join(":");
        const line = formatCredentialCliTarget({
            DATABASE_URL: `postgresql://operator_user:${encodeURIComponent(password)}@db.example.test:6543/appdb?schema=public&pgbouncer=true`,
        });
        expect(line).toContain("db.example.test:6543/appdb");
        for (const secret of [password, encodeURIComponent(password), "SECRET", "operator_user", "postgresql://"]) {
            expect(line).not.toContain(secret);
        }
    });

    it("reports unknown when DATABASE_URL is unset or unparsable", () => {
        expect(formatCredentialCliTarget({})).toBe("target environment=unknown databaseTarget=unknown");
        expect(formatCredentialCliTarget({ DATABASE_URL: "not a url" })).toContain("databaseTarget=unknown");
    });
});
