import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const BACKEND = path.resolve(__dirname, "../../../..");
const RUNTIME_DIRS = ["domain/eformsign-backup/worker", "infrastructure/eformsign-backup/worker"];
const RUNTIME_SCRIPTS = ["scripts/eformsign-backup-worker.ts", "scripts/eformsign-backup-restore.ts"];
/** The non-worker modules the worker may import (see ALLOWED_BARE); they run inside it, so they obey the same rules. */
const ALLOWED_MODULE_FILES = [
    "infrastructure/eformsign-backup/local-artifact-archive.ts",
    "domain/eformsign-backup/source-evidence.ts",
    "domain/eformsign-backup/export/constants.ts",
    "domain/eformsign-backup/export/cursor.ts",
];

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

/** True where an identifier only names a property or a declaration, not a value read from scope. */
function isPropertyName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)
            || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent)
            || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node);
}

/** True where an identifier declares a local binding (variable, parameter, destructuring element, function, class, namespace). */
function isDeclarationName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)
        || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isModuleDeclaration(parent)) && parent.name === node;
}

/** True where an identifier is a type annotation (`x: Function`), which names a type and executes nothing. */
function isTypeReferenceName(node: ts.Identifier): boolean {
    return ts.isTypeReferenceNode(node.parent) && node.parent.typeName === node;
}

/** The only shape in which `require` may appear: `require("literal")` or ``require(`literal`)``. */
function isLiteralRequireCallee(node: ts.Identifier): boolean {
    const call = node.parent;
    return ts.isCallExpression(call) && call.expression === node && call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]!);
}

/**
 * `eval` and `Function` build code from a string, so `eval("req" + "uire")` or `Function("return this")()`
 * reaches `require` and `process` with no name the scans above can see; `arguments[1]` is `require` inside
 * a CommonJS wrapper. No worker file needs any of them, so any use as a value is a violation.
 */
const DYNAMIC_CODE_NAMES = new Set(["eval", "arguments", "Function"]);

/**
 * What a source file loads, read from the TypeScript syntax tree, not from text. A regex or the
 * comment stripper above can be fooled by `from/**\/"node:module"`, `require/**\/(name)` or a regex
 * literal that looks like a comment; the parser sees tokens, so comments and regex literals between
 * them change nothing. Collected:
 *  - every import / export-from / import-equals / `import("x")` type specifier, in `specifiers`;
 *  - every `import(...)` call whose argument is not one plain string literal, every identifier named
 *    `createRequire`, every use of `require` other than `require("literal")` (alias, argument,
 *    `.call`), every `module` read as a value (`module.require`, `module["require"]`), and every
 *    call of a property named `require` on any receiver, and every `eval` / `arguments` / `Function`
 *    read as a value, in `violations`.
 */
function analyzeLoads(source: string): { specifiers: string[]; violations: string[] } {
    const sf = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specs: string[] = [];
    const violations: string[] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specs.push(node.moduleSpecifier.text);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            const ref = node.moduleReference.expression;
            if (ts.isStringLiteralLike(ref)) specs.push(ref.text);
            else violations.push(`import = require( with a non-literal argument: ${ref.getText(sf).slice(0, 24)}`);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            specs.push(node.argument.literal.text);
        } else if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const [argument] = node.arguments;
            if (callee.kind === ts.SyntaxKind.ImportKeyword) {
                if (node.arguments.length === 1 && argument && ts.isStringLiteralLike(argument)) specs.push(argument.text);
                else violations.push(`import( with a non-literal argument: ${node.arguments.map((a) => a.getText(sf)).join(", ").slice(0, 24)}`);
            } else if (ts.isIdentifier(callee) && callee.text === "require" && node.arguments.length === 1 && argument && ts.isStringLiteralLike(argument)) {
                specs.push(argument.text);
            } else if ((ts.isPropertyAccessExpression(callee) && callee.name.text === "require")
                || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === "require")) {
                violations.push(`.require( called on a receiver: ${callee.getText(sf).slice(0, 24)}`);
            }
        } else if (ts.isIdentifier(node)) {
            if (node.text === "createRequire") violations.push("createRequire");
            else if (node.text === "require" && !isPropertyName(node) && !isLiteralRequireCallee(node)) {
                violations.push(`require used other than as require("literal"): ${node.parent.getText(sf).slice(0, 24)}`);
            } else if (node.text === "module" && !isPropertyName(node) && !isDeclarationName(node)) {
                violations.push(`module used as a value: ${node.parent.getText(sf).slice(0, 24)}`);
            } else if (DYNAMIC_CODE_NAMES.has(node.text) && !isPropertyName(node) && !isDeclarationName(node) && !isTypeReferenceName(node)) {
                violations.push(`${node.text} used as a value: ${node.parent.getText(sf).slice(0, 24)}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return { specifiers: specs, violations };
}

function specifiers(source: string): string[] {
    return analyzeLoads(source).specifiers;
}

/** `createRequire` and a dynamic `import(x)` / `require(x)` with a computed argument load code the specifier scan never sees. */
function loaderViolations(source: string): string[] {
    return analyzeLoads(source).violations;
}

function insideRuntime(file: string, specifier: string): boolean {
    const resolved = path.normalize(path.join(path.dirname(file), specifier));
    return RUNTIME_DIRS.some((dir) => resolved === dir || resolved.startsWith(`${dir}/`))
        || ALLOWED_MODULE_FILES.some((module) => module.replace(/\.ts$/, "") === resolved);
}

/** A bare specifier is matched on its text, so a `.` or `..` segment could walk out of an allowed prefix. */
function hasPathTraversal(specifier: string): boolean {
    return specifier.includes("\\") || specifier.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        || path.posix.normalize(specifier) !== specifier;
}

/**
 * `node:process` hands out `env` as a named import, which no `process.<member>` check would see.
 * `node:module` / `module` hand out `createRequire`, which loads any module without a visible specifier.
 */
const FORBIDDEN_BARE = new Set(["node:process", "process", "node:module", "module"]);

function allowed(file: string, specifier: string): boolean {
    if (specifier.startsWith(".")) return insideRuntime(file, specifier);
    if (FORBIDDEN_BARE.has(specifier) || hasPathTraversal(specifier)) return false;
    return ALLOWED_BARE.some((rule) => (typeof rule === "string" ? rule === specifier : rule.test(specifier)));
}

describe("T-WRK-14: worker runtime boundary (static scan)", () => {
    let files: string[] = [];
    /** The worker's own files: every rule applies. */
    const sources = new Map<string, string>();
    /** `sources` plus the allowed non-worker modules: the import, loader and process/global rules apply (they may legitimately unlink, for one). */
    const scanned = new Map<string, string>();
    beforeAll(async () => {
        files = [...(await Promise.all(RUNTIME_DIRS.map((dir) => listSources(dir)))).flat(), ...RUNTIME_SCRIPTS, ...ALLOWED_MODULE_FILES];
        for (const file of files) {
            const text = await fs.readFile(path.join(BACKEND, file), "utf8");
            scanned.set(file, text);
            if (!ALLOWED_MODULE_FILES.includes(file)) sources.set(file, text);
        }
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
        for (const [file, source] of scanned) {
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
        // The allowed non-worker modules may reach each other, and nothing else, by relative path.
        expect(allowed("domain/eformsign-backup/export/cursor.ts", "./constants")).toBe(true);
        for (const bad of ["./evidence", "./index", "../../x", "@prisma/client", "@nestjs/common"]) {
            expect(allowed("domain/eformsign-backup/export/cursor.ts", bad)).toBe(false);
        }
    });

    it("should refuse node:module and module, which hand out createRequire (the check itself can fail)", () => {
        const file = "infrastructure/eformsign-backup/worker/x.ts";
        for (const bad of ["node:module", "module"]) expect(allowed(file, bad)).toBe(false);
        for (const source of ['import { createRequire } from "node:module";', 'import Module from "module";', 'require("module")', "require('node:module')"]) {
            const found = specifiers(source);
            expect(found).not.toEqual([]);
            expect(found.some((specifier) => !allowed(file, specifier))).toBe(true);
        }
        expect(allowed(file, "node:fs")).toBe(true);
    });

    it("should see through comments and regex literals between tokens (the check itself can fail)", () => {
        const file = "infrastructure/eformsign-backup/worker/x.ts";
        // F1: a regex literal fools the comment stripper, and `/**/` splits `require` from its `(`.
        for (const bad of [
            "const urlPattern = /^https?:\\/\\//; return require/**/(name);",
            "require /* x */ ( name )",
            "import(/* c */ name)",
            "require(/* c */ `./${name}`)",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        // F2: comments between the keyword and the specifier leave the module name in place.
        for (const bad of ['import * as Module from/**/"node:module";', 'export * from/**/"module"', 'import/**/"node:module";']) {
            const found = specifiers(bad);
            expect(found).not.toEqual([]);
            expect(found.some((specifier) => !allowed(file, specifier))).toBe(true);
        }
        for (const [source, expected] of [
            ['import /* a */ { x } /* b */ from /* c */ "./runner";', ["./runner"]],
            ["import x = require/**/('node:fs');", ["node:fs"]],
            ["const m = import/**/('./literal');", ["./literal"]],
            ['// import("node:module")\nconst s = "require(name)";', []],
        ] as Array<[string, string[]]>) {
            expect(specifiers(source)).toEqual(expected);
            expect(loaderViolations(source)).toEqual([]);
        }
    });

    it("should refuse createRequire and any import()/require() whose argument is not one string literal (the check itself can fail)", () => {
        for (const bad of [
            'import { createRequire } from "node:module"',
            'createRequire(__filename)("../../app.module")',
            "const r = createRequire(import.meta.url);",
            "import(name)",
            "const m = await import(name);",
            "require(name)",
            'require("../" + name)',
            'import("./" + name)',
            "await import(`./adapters/${name}`)",
            "require(`./${name}`)",
            "import(\n  name\n)",
            "const m = require (name);",
            "import()",
            "/^a\\//; const m = require(name);",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        for (const good of [
            'import("./literal")',
            "import('./literal')",
            'await import("node:fs/promises")',
            'const z = require("zod");',
            'import { promises as fs } from "node:fs";',
            'import path from "node:path";',
            'import { x } from "./runner";',
            'export * from "./runner";',
            "import type { X } from './x';",
            "const importer = 1; const required = importer;",
        ]) expect(loaderViolations(good)).toEqual([]);
    });

    it("should refuse module.require, a require alias and require.call, and accept plain literal requires (the check itself can fail)", () => {
        for (const bad of [
            'module.require("node:module")',
            "module.require(name)",
            'module["require"]("x")',
            "const r = require; r(name)",
            'require.call(null, "x")',
            'const loader = foo.require; loader(name); bar["require"]("x")',
            "foo.require(name)",
            "run(require)",
            "module.constructor._load(name)",
            "const { require: r } = module;",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        for (const bad of ['foo.require("x")', 'bar["require"]("x")']) expect(loaderViolations(bad)).not.toEqual([]);
        for (const good of [
            'require("zod")',
            "require(`zod`)",
            "const x = foo.module;",
            "const o = { module: 1, require: 2 };",
            "interface I { module: string }",
            "foo.module.bar()",
        ]) expect(loaderViolations(good)).toEqual([]);
        expect(specifiers('require("zod")')).toEqual(["zod"]);
    });

    it("should refuse eval, arguments and Function used as values, and accept them as names (the check itself can fail)", () => {
        for (const bad of [
            'export function loadA(name: string) { return eval("req" + "uire")(name); }',
            "const load = arguments[1]; exports.m = (n) => load(n);",
            'const g = Function("return this")(); g["pro" + "cess"]["e" + "nv"]["HOME"];',
            'new Function("return process")()',
            '(0, eval)("require")',
            "const e = eval; e(x);",
            "const F = Function; F(x);",
            "run(arguments)",
            "const q = { eval };",
            "class D extends Function {}",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        for (const good of [
            "foo.eval",
            "foo.eval(x)",
            "const o = { arguments: 1 };",
            "interface Callback { Function: string }",
            "function f(args: string[]) { return args; }",
            "class C { eval() { return 1; } arguments = 2; }",
            "const { x: eval_ } = y;",
        ]) expect(loaderViolations(good)).toEqual([]);
    });

    it("should scan the allowed non-worker modules the worker imports, not only the worker directories", () => {
        for (const expected of [
            "infrastructure/eformsign-backup/local-artifact-archive.ts", "domain/eformsign-backup/source-evidence.ts",
            "domain/eformsign-backup/export/constants.ts", "domain/eformsign-backup/export/cursor.ts",
        ]) {
            expect(files).toContain(expected);
            expect(scanned.has(expected)).toBe(true);
        }
    });

    it("should load no module through createRequire or a computed import()/require() in any runtime file", () => {
        const offenders: string[] = [];
        for (const [file, source] of scanned) for (const hit of loaderViolations(source)) offenders.push(`${file}: ${hit}`);
        expect(offenders).toEqual([]);
    });

    it("should touch no process member outside the allowlist, and never read process.env", () => {
        const offenders: string[] = [];
        for (const [file, source] of scanned) for (const hit of processViolations(source)) offenders.push(`${file}: ${hit}`);
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
