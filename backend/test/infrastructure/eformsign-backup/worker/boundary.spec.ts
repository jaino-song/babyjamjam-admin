import { promises as fs } from "node:fs";
import path from "node:path";

const BACKEND = path.resolve(__dirname, "../../../..");
const RUNTIME_DIRS = ["domain/eformsign-backup/worker", "infrastructure/eformsign-backup/worker"];
const RUNTIME_SCRIPTS = ["scripts/eformsign-backup-worker.ts", "scripts/eformsign-backup-restore.ts"];

/** Contract W1: the exact import allowlist of a worker runtime file. */
const ALLOWED_BARE: Array<string | RegExp> = [
    /^node:/,
    "zod",
    "domain/eformsign-backup/source-evidence",
    "domain/eformsign-backup/export/constants",
    "domain/eformsign-backup/export/cursor",
    /^domain\/eformsign-backup\/worker(\/.*)?$/,
    "infrastructure/eformsign-backup/local-artifact-archive",
];
const FORBIDDEN_UNLINK = /(^|[^A-Za-z0-9_$])(unlink|unlinkSync|rmdir|rmdirSync|rmSync|rm)\s*\(|\.(unlink|rmdir|rm)\b|\b(unlink|rmdir|rmSync)\b/;
const FORBIDDEN_EXCEPTIONS = /\b(BadRequest|NotFound|Conflict|Forbidden|Unauthorized|InternalServerError|ServiceUnavailable|BadGateway|Http)Exception\b/;

async function listTs(dir: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(path.join(BACKEND, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) found.push(...(await listTs(path.join(dir, entry.name))));
        else if (entry.name.endsWith(".ts")) found.push(path.join(dir, entry.name));
    }
    return found.sort();
}

function specifiers(source: string): string[] {
    const out: string[] = [];
    const patterns = [
        /\bfrom\s*["']([^"']+)["']/g,
        /\bimport\s*["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\bexport\s+\*\s+from\s*["']([^"']+)["']/g,
    ];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) out.push(match[1]!);
    return out;
}

function insideRuntime(file: string, specifier: string): boolean {
    const resolved = path.normalize(path.join(path.dirname(file), specifier));
    return RUNTIME_DIRS.some((dir) => resolved === dir || resolved.startsWith(`${dir}/`));
}

function allowed(file: string, specifier: string): boolean {
    if (specifier.startsWith(".")) return insideRuntime(file, specifier);
    return ALLOWED_BARE.some((rule) => (typeof rule === "string" ? rule === specifier : rule.test(specifier)));
}

describe("T-WRK-14: worker runtime boundary (static scan)", () => {
    let files: string[] = [];
    const sources = new Map<string, string>();
    beforeAll(async () => {
        files = [...(await Promise.all(RUNTIME_DIRS.map(listTs))).flat(), ...RUNTIME_SCRIPTS];
        for (const file of files) sources.set(file, await fs.readFile(path.join(BACKEND, file), "utf8"));
    });

    it("should scan the files it is meant to scan (the scan itself is not empty)", () => {
        for (const expected of [
            "domain/eformsign-backup/worker/ledger-state.ts", "infrastructure/eformsign-backup/worker/atomic-file.ts",
            "infrastructure/eformsign-backup/worker/runner.ts", "infrastructure/eformsign-backup/worker/restore.ts",
            "infrastructure/eformsign-backup/worker/cli.ts", "infrastructure/eformsign-backup/worker/lock.ts",
            "infrastructure/eformsign-backup/worker/config.ts", ...RUNTIME_SCRIPTS,
        ]) expect(files).toContain(expected);
        expect(files.length).toBeGreaterThan(30);
    });

    it("should import nothing outside the allowlist", () => {
        const offenders: string[] = [];
        for (const [file, source] of sources) {
            for (const specifier of specifiers(source)) if (!allowed(file, specifier)) offenders.push(`${file}: ${specifier}`);
        }
        expect(offenders).toEqual([]);
    });

    it("should refuse the specifiers the allowlist exists to keep out (the check itself can fail)", () => {
        for (const bad of ["@prisma/client", "@nestjs/common", "@nestjs/config", "app.module", "infrastructure/database/prisma.service",
            "application/services/x", "interface/x", "ioredis", "domain/eformsign-backup/export/evidence", "domain/eformsign-backup/export",
            "domain/utils/x", "../application/x"]) {
            expect(allowed("infrastructure/eformsign-backup/worker/x.ts", bad)).toBe(false);
        }
        expect(allowed("infrastructure/eformsign-backup/worker/x.ts", "./runner")).toBe(true);
        expect(allowed("scripts/eformsign-backup-worker.ts", "../infrastructure/eformsign-backup/worker/cli")).toBe(true);
    });

    it("should never read process.env", () => {
        expect([...sources].filter(([, source]) => /\bprocess\s*\.\s*env\b|process\[\s*["']env["']\s*\]/.test(source)).map(([file]) => file)).toEqual([]);
    });

    it("should unlink or remove nothing except atomic-file.ts removing its own temp file", () => {
        const offenders = [...sources]
            .filter(([file]) => file !== "infrastructure/eformsign-backup/worker/atomic-file.ts")
            .filter(([, source]) => FORBIDDEN_UNLINK.test(source))
            .map(([file]) => file);
        expect(offenders).toEqual([]);
        expect(FORBIDDEN_UNLINK.test("await fs.unlink(x)")).toBe(true);
        expect(FORBIDDEN_UNLINK.test("await fs.rm(x, { recursive: true })")).toBe(true);
        expect(FORBIDDEN_UNLINK.test("rmdir(x)")).toBe(true);
        expect(FORBIDDEN_UNLINK.test("await fs.rename(a, b)")).toBe(false);
    });

    it("should carry no ioredis or valkey reference, not even in a comment", () => {
        expect([...sources].filter(([, source]) => /ioredis|valkey/i.test(source)).map(([file]) => file)).toEqual([]);
    });

    it("should not name the HTTP exception classes the raw-error intake gate flags", () => {
        expect([...sources].filter(([, source]) => FORBIDDEN_EXCEPTIONS.test(source)).map(([file]) => file)).toEqual([]);
        expect(FORBIDDEN_EXCEPTIONS.test("throw new BadRequestException()")).toBe(true);
    });

    it("should give both CLI scripts no Nest or Prisma import and only a thin call into the CLI module", () => {
        for (const script of RUNTIME_SCRIPTS) {
            const source = sources.get(script)!;
            expect(source).not.toMatch(/@nestjs|@prisma|reflect-metadata/);
            expect(source.split("\n").length).toBeLessThan(60);
        }
    });
});
