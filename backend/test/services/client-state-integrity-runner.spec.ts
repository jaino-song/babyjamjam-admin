import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

// Execute the real runner with inert process/command boundaries: never create
// the shared runner database while parallel fix units own separate databases.
const runner = readFileSync(resolve(__dirname, "../../scripts/run-state-integrity.mjs"), "utf8")
    .replace(/^import .*;\n/gm, "");

describe("client integrity runner fresh-worktree setup", () => {
    it("generates Prisma before migrations and keeps the existing lifecycle and scoped arguments", () => {
        const commands: string[] = [];
        runInNewContext(runner, {
            process: { env: {}, argv: ["node", "runner", "test/integrity/clients"] },
            existsSync: (path: string) => path === "test/integrity/clients",
            spawnSync: (command: string, args: string[]) => {
                commands.push([command, ...args].join(" "));
                return { status: 0 };
            },
        });

        expect(commands).toEqual([
            "dropdb --host localhost --port 5432 --username postgres --if-exists bjj_state_integrity_throwaway",
            "createdb --host localhost --port 5432 --username postgres bjj_state_integrity_throwaway",
            "pnpm exec prisma generate",
            "pnpm exec prisma migrate deploy",
            "pnpm exec jest test/integrity/clients --runInBand",
            "dropdb --host localhost --port 5432 --username postgres --if-exists bjj_state_integrity_throwaway",
        ]);
    });

    it("fails before migrations when generation fails and still drops the throwaway database", () => {
        const commands: string[] = [];
        expect(() => runInNewContext(runner, {
            process: { env: {}, argv: ["node", "runner"] },
            existsSync: () => false,
            spawnSync: (command: string, args: string[]) => {
                const invocation = [command, ...args].join(" ");
                commands.push(invocation);
                return { status: invocation === "pnpm exec prisma generate" ? 1 : 0 };
            },
        })).toThrow("pnpm exec prisma generate failed with exit code 1");

        expect(commands).toHaveLength(4);
        expect(commands[2]).toBe("pnpm exec prisma generate");
        expect(commands[3]).toMatch(/^dropdb /);
        expect(commands.some((command) => command.includes("migrate deploy"))).toBe(false);
    });
});
