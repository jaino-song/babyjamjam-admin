import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { isAbsolute, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function demand(condition) { if (!condition) throw new Error("Protected manual-backup test target rejected"); }
function physicalFile(path) {
    demand(typeof path === "string" && isAbsolute(path) && !path.split(sep).includes(".."));
    demand(realpathSync(path) === path);
    const stat = lstatSync(path);
    demand(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600);
}
try {
    const args = process.argv.slice(2);
    demand(args.length === 2 && args[0] === "--connection-file");
    const descriptor = args[1]; physicalFile(descriptor);
    const parent = dirname(descriptor);
    const directory = lstatSync(parent);
    demand(directory.isDirectory() && directory.uid === process.getuid() && (directory.mode & 0o777) === 0o700);
    const config = JSON.parse(readFileSync(descriptor, "utf8"));
    demand(Object.keys(config).sort().join(",") === "database,host,passwordFile,port,user");
    // Validate every target field BEFORE opening the password file or starting a child.
    demand(config.host === "127.0.0.1" && config.port === 63241 && config.user === "backup_test_owner"
        && typeof config.database === "string" && /^backup_exec_throwaway_[a-z0-9_]+$/.test(config.database));
    demand(typeof config.passwordFile === "string" && dirname(config.passwordFile) === parent
        && relative(parent, config.passwordFile) !== "" && !relative(parent, config.passwordFile).startsWith(".."));
    physicalFile(config.passwordFile);
    const password = readFileSync(config.passwordFile, "utf8").trim();
    demand(password.length > 0 && !/[\r\n\0]/.test(password));
    const url = new URL(`postgresql://${config.host}:${config.port}/${config.database}`);
    url.username = config.user; url.password = password;
    const env = { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href, HOLIDAY_REVIEW_REAL_DB: "1" };
    const candidate = spawnSync("git", ["rev-parse", "HEAD"], { cwd: backend, encoding: "utf8" });
    demand(candidate.status === 0);
    const state = spawnSync("git", ["status", "--porcelain"], { cwd: backend, encoding: "utf8" });
    demand(state.status === 0);
    const receipt = { workingTreeDirty: state.stdout.trim().length > 0, candidateGitSHA: candidate.stdout.trim(), host: config.host, port: config.port, database: config.database, generateExitCode: null, testExitCode: null };
    function child(args) {
        const result = spawnSync("pnpm", args, { cwd: backend, env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
        // Children receive credentials only in their environment; redact defensively before relaying errors.
        for (const output of [result.stdout, result.stderr]) if (output) process.stdout.write(output
            .replaceAll(url.href, "[redacted-test-target]").replace(/postgres(?:ql)?:\/\/[^\s"'`]+/g, "[redacted-database-url]")
            .replaceAll(password, "[redacted]"));
        return result.status ?? 1;
    }
    receipt.generateExitCode = child(["exec", "prisma", "generate"]);
    if (receipt.generateExitCode === 0) receipt.testExitCode = child(["exec", "jest", "--runInBand", "--runTestsByPath", "test/prisma/manual-backup-runs.real-db.spec.ts", "test/prisma/manual-backup-live-source.real-db.spec.ts", "test/prisma/manual-backup-delivery.real-db.spec.ts"]);
    console.log(JSON.stringify(receipt));
    process.exitCode = receipt.generateExitCode || receipt.testExitCode || 0;
} catch {
    // Never echo parser/OS errors: they can include descriptor contents or credentials.
    console.error("Protected manual-backup real-DB runner failed; no target details disclosed");
    process.exitCode = 1;
}
