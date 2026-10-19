import { promises as fs } from "node:fs";
import os from "node:os";
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

/** Every source flavour Node can execute or compile here; a `.js` file would otherwise slip past the scan. */
const SCANNED_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;

async function listSources(dir: string, root: string = BACKEND): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
        if (entry.isDirectory()) found.push(...(await listSources(path.join(dir, entry.name), root)));
        else if (SCANNED_FILE.test(entry.name)) found.push(path.join(dir, entry.name));
    }
    return found.sort();
}

/** The `process` members a runtime file may use. `env` must never be on this list. */
const ALLOWED_PROCESS_MEMBERS = ["argv", "exitCode", "getuid", "pid", "stderr", "stdout"];

/**
 * Blank out comments (keeping string and template contents, so `${process.env}` is still seen) and
 * replace each with one space, so a comment between `process` and `.env` is not glued away.
 * This is a scanner, not a parser, and it does not recognise regex literals: `/^a\/\//` reads as a
 * line comment, and `/x\/*\/` as the start of a block comment, so it can HIDE real code after one.
 * Never rely on it alone for a security rule; `processViolations` also scans the raw source.
 */
function stripComments(source: string): string {
    let out = "";
    let i = 0;
    while (i < source.length) {
        const ch = source[i]!;
        const next = source[i + 1];
        if (ch === "/" && next === "/") {
            while (i < source.length && source[i] !== "\n") i += 1;
            out += " ";
        } else if (ch === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            i = end === -1 ? source.length : end + 2;
            out += " ";
        } else if (ch === '"' || ch === "'" || ch === "`") {
            let j = i + 1;
            while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
            out += source.slice(i, j + 1);
            i = j + 1;
        } else {
            out += ch;
            i += 1;
        }
    }
    return out;
}

/** Unstripped patterns: they hold even where `stripComments` is fooled, at the price of also reading comments. */
const RAW_PROCESS_PATTERNS = [
    /(?<![\w$])process\s*\??\.\s*env\b/,
    /(?<![\w$])process\s*\??\.?\s*\[/,
    /\{[^}]*\}\s*=\s*(?:globalThis\s*\.\s*|global\s*\.\s*)?process(?![\w$])/,
    /(?<![\w$])(globalThis|global)(?![\w$])/,
];

/**
 * Every use of `process` must be `process.<allowed member>`. Anything else is a violation: another
 * member (env, cwd, binding...), a bracket access, destructuring, aliasing, or passing `process`
 * around. `globalThis` and `global` are banned outright because they reach `process` by another name.
 * Takes RAW source: the member check runs on the comment-stripped text, and the raw patterns run on
 * the text as written, so a regex literal that fools the stripper cannot hide an access.
 */
function processViolations(raw: string): string[] {
    const source = stripComments(raw);
    const hits: string[] = [];
    for (const match of source.matchAll(/(?<![\w$])process(?![\w$])/g)) {
        const member = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(source.slice(match.index! + match[0].length));
        if (!member) hits.push(`process used other than as process.<member>: ${source.slice(match.index!, match.index! + 24).trim()}`);
        else if (!ALLOWED_PROCESS_MEMBERS.includes(member[1]!)) hits.push(`process.${member[1]}`);
    }
    for (const match of source.matchAll(/(?<![\w$])(globalThis|global)(?![\w$])/g)) hits.push(match[1]!);
    for (const pattern of RAW_PROCESS_PATTERNS) if (pattern.test(raw)) hits.push(`raw ${pattern.source}`);
    return hits;
}

/** Runtime files report through the CLI's own stdout/stderr writers, never through console. */
function consoleViolations(source: string): string[] {
    return [...source.matchAll(/(?<![\w$])console(?![\w$])/g)].map(() => "console");
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

/** A bare specifier is matched on its text, so a `.` or `..` segment could walk out of an allowed prefix. */
function hasPathTraversal(specifier: string): boolean {
    return specifier.includes("\\") || specifier.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        || path.posix.normalize(specifier) !== specifier;
}

/** `node:process` hands out `env` as a named import, which no `process.<member>` check would see. */
const FORBIDDEN_BARE = new Set(["node:process", "process"]);

function allowed(file: string, specifier: string): boolean {
    if (specifier.startsWith(".")) return insideRuntime(file, specifier);
    if (FORBIDDEN_BARE.has(specifier) || hasPathTraversal(specifier)) return false;
    return ALLOWED_BARE.some((rule) => (typeof rule === "string" ? rule === specifier : rule.test(specifier)));
}

describe("T-WRK-14: worker runtime boundary (static scan)", () => {
    let files: string[] = [];
    const sources = new Map<string, string>();
    beforeAll(async () => {
        files = [...(await Promise.all(RUNTIME_DIRS.map((dir) => listSources(dir)))).flat(), ...RUNTIME_SCRIPTS];
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
        for (const bad of [
            "domain/eformsign-backup/worker/../../../infrastructure/database/prisma.service",
            "domain/eformsign-backup/worker/../../../infrastructure/database/prisma.service.ts",
            "domain/eformsign-backup/worker/./x",
            "domain/eformsign-backup/worker/..",
            "domain/eformsign-backup/export/../evidence",
            "infrastructure/eformsign-backup/local-artifact-archive/../../database/prisma.service",
            "domain/eformsign-backup/source-evidence/../../x",
            "node:fs/../../x",
            "zod/../x",
            "domain\\eformsign-backup\\worker\\x",
            "domain/eformsign-backup//worker/x",
            "node:process",
        ]) expect(allowed("infrastructure/eformsign-backup/worker/x.ts", bad)).toBe(false);
        expect(allowed("infrastructure/eformsign-backup/worker/x.ts", "./runner")).toBe(true);
        expect(allowed("infrastructure/eformsign-backup/worker/x.ts", "domain/eformsign-backup/worker/ledger-state")).toBe(true);
        expect(allowed("infrastructure/eformsign-backup/worker/x.ts", "node:fs/promises")).toBe(true);
        expect(allowed("scripts/eformsign-backup-worker.ts", "../infrastructure/eformsign-backup/worker/cli")).toBe(true);
    });

    it("should touch no process member outside the allowlist, and never read process.env", () => {
        const offenders: string[] = [];
        for (const [file, source] of sources) for (const hit of processViolations(source)) offenders.push(`${file}: ${hit}`);
        expect(offenders).toEqual([]);
        expect(ALLOWED_PROCESS_MEMBERS).not.toContain("env");
    });

    it("should refuse every way of reaching process.env (the check itself can fail)", () => {
        for (const bad of [
            "const x = process.env.DATABASE_URL;",
            'const x = process["env"];',
            'const { env: workerEnv } = process; export const leakedHost = workerEnv["DATABASE_URL"];',
            "const { env } = process;",
            "const p = process; p.env.X;",
            "const { env } = globalThis.process;",
            "globalThis.process.env.X",
            "process?.env",
            "process.cwd()",
            "process.chdir(x)",
            "process.binding('fs')",
            "process[key]",
            'process["en" + "v"]',
            "const e = (0, process).env;",
            "process . env",
            "process\n  .env",
            "process/* hidden */.env",
            "const { getuid, env } = process;",
            // A regex literal ends in `//` or holds `/*`: a scanner that misses regex literals reads the rest as a comment.
            'const URL_PREFIX = /^https?:\\/\\//; export const leaked = URL_PREFIX.test(process.env["DATABASE_URL"] ?? "");',
            "const re = /x\\/*/; export const leaked = process.env.X; const y = 1; /* closes the phantom comment */",
            "const re = /^a\\/\\//; const { env: e } = process; export const z = e.X;",
        ]) expect(processViolations(bad)).not.toEqual([]);
        for (const good of [
            "process.getuid?.()", "process.pid", "process.argv.slice(2)", "process.exitCode = code;",
            "process.stdout.write(line);", "process.stderr.write(line);",
            "// the process must hold it", "/* the process must hold it */", "const child_process = 1;",
        ]) expect(processViolations(good)).toEqual([]);
    });

    it("should write nothing through console (the check itself can fail)", () => {
        const offenders: string[] = [];
        for (const [file, source] of sources) for (const hit of consoleViolations(stripComments(source))) offenders.push(`${file}: ${hit}`);
        expect(offenders).toEqual([]);
        for (const bad of ["console.log(x)", "console.error(x)", "console['warn'](x)", "const { log } = console;", "globalThis.console.info(x)"]) {
            expect(consoleViolations(stripComments(bad))).not.toEqual([]);
        }
        expect(consoleViolations(stripComments("// console.log is not used"))).toEqual([]);
        expect(consoleViolations(stripComments("process.stdout.write(line)"))).toEqual([]);
    });

    it("should scan .js, .mjs and .cjs runtime files too, not only .ts (the check itself can fail)", async () => {
        const root = await fs.mkdtemp(path.join(os.homedir(), "bjj455-a1-"));
        try {
            await fs.mkdir(path.join(root, "w", "nested"), { recursive: true });
            for (const name of ["a.ts", "b.mts", "c.cts", "d.js", "e.mjs", "f.cjs", "nested/g.js", "notes.md", "data.json", "h.d.ts.map"]) {
                await fs.writeFile(path.join(root, "w", name), "export {};\n");
            }
            expect(await listSources("w", root)).toEqual(
                ["w/a.ts", "w/b.mts", "w/c.cts", "w/d.js", "w/e.mjs", "w/f.cjs", "w/nested/g.js"].sort(),
            );
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
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
