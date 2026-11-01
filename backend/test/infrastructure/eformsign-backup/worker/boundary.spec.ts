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

/** The only shape in which `require` may appear: `require(<one statically known string>)`, e.g. `require("literal")`. */
function isStaticRequireCallee(node: ts.Identifier, staticString: (node: ts.Node) => string | undefined): boolean {
    const call = node.parent;
    return ts.isCallExpression(call) && call.expression === node && call.arguments.length === 1 && staticString(call.arguments[0]!) !== undefined;
}

/**
 * `eval` and `Function` build code from a string, so `eval("req" + "uire")` or `Function("return this")()`
 * reaches `require` and `process` with no name the scans above can see; `arguments[1]` is `require` inside
 * a CommonJS wrapper. No worker file needs any of them, so any use as a value is a violation.
 */
const DYNAMIC_CODE_NAMES = new Set(["eval", "arguments", "Function"]);

/**
 * Names that must never appear as a statically known string (`f["con" + "structor"]`, `const k = "pro" + "cess"`):
 * `constructor` is `Function`, the rest are the loaders and globals the other rules ban by name.
 */
const BANNED_KEYS = new Set(["constructor", "process", "env", "globalThis", "global", "require", "module", "eval", "Function", "arguments"]);

/**
 * Production strings that spell a banned name as plain DATA, not as a member to read. Each entry matches the
 * exact source text of an expression that encloses the string, in that file only; `analyzeLoads` counts how often
 * an entry is used, and a test requires exactly one use, so a stale or over-broad entry fails.
 */
const DATA_ALLOWLIST: Array<{ file: string; text: string; reason: string }> = [
    {
        file: "domain/eformsign-backup/source-evidence.ts",
        text: '["__proto__", "constructor", "prototype"].includes(key)',
        reason: "prototype-pollution guard: the strings are keys the canonicaliser rejects, never used to read a member",
    },
];

/** `Reflect` is allowed only as the receiver of a direct `Reflect.ownKeys(...)` / `Reflect.has(...)` call, which name keys and reach nothing. */
const SAFE_REFLECT_MEMBERS = new Set(["ownKeys", "has"]);

function isSafeReflectUse(node: ts.Identifier): boolean {
    const access = node.parent;
    return ts.isPropertyAccessExpression(access) && access.expression === node && SAFE_REFLECT_MEMBERS.has(access.name.text)
        && ts.isCallExpression(access.parent) && access.parent.expression === access;
}

/** True where an identifier declares a binding of any kind that could shadow a name (a catch variable is a VariableDeclaration). */
function declaresName(node: ts.Identifier): boolean {
    const parent = node.parent;
    return isDeclarationName(node)
        || ((ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)
            || ts.isEnumDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassExpression(parent)) && parent.name === node);
}

/**
 * True inside a type position (annotation, interface, type alias, type literal), which names a type and runs
 * nothing. A class `extends` clause is an expression, though TypeScript models it as a type node.
 */
function inTypePosition(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
        if (ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) return true;
        if (ts.isTypeNode(current) && !ts.isExpressionWithTypeArguments(current)) return true;
        if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
    }
    return false;
}

/** The string literal that names a module in an import / export-from / import-equals / import type: the allowlist checks it as a specifier. */
function isModuleSpecifierLiteral(node: ts.Node): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node)
        || (ts.isExternalModuleReference(parent) && parent.expression === node)
        || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent) && parent.parent.argument === parent);
}

/**
 * Resolves an expression to the one string it always evaluates to, or undefined: string and
 * no-substitution template literals, template literals whose spans are all static, `+` chains of any
 * length, parentheses and type assertions, and an identifier bound by a `const` with a static initializer
 * (a `const` cannot be reassigned). Resolution follows the declarations it has already entered, so a
 * cycle (`const a = b; const b = a`) resolves to undefined instead of looping; there is no depth cap.
 * An identifier declared more than once anywhere in the file (a shadowing parameter, a second `const`)
 * is not resolved: this is a scanner, not a scope analyser.
 */
function makeStaticString(sf: ts.SourceFile): (node: ts.Node) => string | undefined {
    const declarations = new Map<string, number>();
    const constants = new Map<string, ts.Expression>();
    const collect = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && declaresName(node)) declarations.set(node.text, (declarations.get(node.text) ?? 0) + 1);
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
            && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
            constants.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, collect);
    };
    collect(sf);
    const resolve = (node: ts.Node, entered: ReadonlySet<string>): string | undefined => {
        if (ts.isStringLiteralLike(node)) return node.text;
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
            || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return resolve(node.expression, entered);
        if (ts.isTemplateExpression(node)) {
            let out = node.head.text;
            for (const span of node.templateSpans) {
                const part = resolve(span.expression, entered);
                if (part === undefined) return undefined;
                out += part + span.literal.text;
            }
            return out;
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = resolve(node.left, entered);
            const right = left === undefined ? undefined : resolve(node.right, entered);
            return left === undefined || right === undefined ? undefined : left + right;
        }
        if (ts.isIdentifier(node) && declarations.get(node.text) === 1 && constants.has(node.text) && !entered.has(node.text)) {
            return resolve(constants.get(node.text)!, new Set(entered).add(node.text));
        }
        return undefined;
    };
    return (node) => resolve(node, new Set());
}

/** The expressions whose value is a string; a maximal one is resolved once and its parts are not visited again. */
function isStringExpressionCandidate(node: ts.Node): boolean {
    return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node) || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken);
}

/**
 * What a source file loads, read from the TypeScript syntax tree, not from text. A regex or the
 * comment stripper above can be fooled by `from/**\/"node:module"`, `require/**\/(name)` or a regex
 * literal that looks like a comment; the parser sees tokens, so comments and regex literals between
 * them change nothing. Collected:
 *  - every import / export-from / import-equals / `import("x")` type specifier, in `specifiers`;
 *  - every `import(...)` call whose argument is not statically one string, every identifier named
 *    `createRequire`, every use of `require` other than `require(<static string>)` (alias, argument,
 *    `.call`), every `module` read as a value (`module.require`, `module["require"]`), and every
 *    call of a property named `require` on any receiver, and every `eval` / `arguments` / `Function`
 *    read as a value, and every use of `Reflect` other than a direct `Reflect.ownKeys(...)` /
 *    `Reflect.has(...)` call, in `violations`;
 *  - an `import(x)` / `require(x)` whose argument is statically known is resolved and checked against
 *    the allowlist as if it were a literal.
 *
 * The criterion is keyed on the VALUE, not on the access shape (dot, element, destructuring, assignment
 * pattern, for-of target... always leave another shape open): no statically known banned name appears in
 * value code, in any syntactic position. Two rules carry it:
 *  - the name `constructor` (`(() => {}).constructor` is `Function`) as an identifier or property name
 *    anywhere outside a type position; a class `constructor(...)` declaration is not such a name;
 *  - any expression that statically resolves to a string in `BANNED_KEYS` (see `makeStaticString`), except a
 *    module specifier or `import()` / `require()` argument (the allowlist checks those) and the explicit
 *    `DATA_ALLOWLIST` entries.
 * Names computed at RUN TIME (from input, I/O, a function result, a `let`, a parameter) are out of scope by
 * design: this test guards the worker against accidental coupling to Nest, Prisma and the environment, not
 * against hostile code. Pass `file` to apply that file's `DATA_ALLOWLIST` entries; `allowanceUses` counts them.
 */
function analyzeLoads(source: string, file?: string): { specifiers: string[]; violations: string[]; allowanceUses: Map<string, number> } {
    const sf = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const specs: string[] = [];
    const violations: string[] = [];
    const staticString = makeStaticString(sf);
    const allowances = DATA_ALLOWLIST.filter((entry) => entry.file === file);
    const allowanceUses = new Map<string, number>();
    /** Reports a banned name unless an enclosing expression is an allowlisted data expression. */
    const reportName = (node: ts.Node, message: string): void => {
        if (inTypePosition(node)) return;
        for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
            if (ts.isSourceFile(current)) break;
            const entry = allowances.find((candidate) => candidate.text === current!.getText(sf));
            if (entry) {
                allowanceUses.set(entry.text, (allowanceUses.get(entry.text) ?? 0) + 1);
                return;
            }
        }
        violations.push(message);
    };
    const isLoadArgument = (node: ts.Node): boolean => {
        const call = node.parent;
        return call !== undefined && ts.isCallExpression(call) && call.arguments.length === 1 && call.arguments[0] === node
            && (call.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(call.expression) && call.expression.text === "require"));
    };
    const visit = (node: ts.Node): void => {
        if (isModuleSpecifierLiteral(node) || (isLoadArgument(node) && staticString(node) !== undefined)) return;
        if (isStringExpressionCandidate(node)) {
            const value = staticString(node);
            if (value !== undefined) {
                if (BANNED_KEYS.has(value)) reportName(node, `statically known name ${value}: ${node.getText(sf).slice(0, 24)}`);
                return;
            }
        }
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
                const resolved = argument ? staticString(argument) : undefined;
                if (node.arguments.length === 1 && resolved !== undefined) specs.push(resolved);
                else violations.push(`import( with a non-literal argument: ${node.arguments.map((a) => a.getText(sf)).join(", ").slice(0, 24)}`);
            } else if (ts.isIdentifier(callee) && callee.text === "require" && node.arguments.length === 1 && argument && staticString(argument) !== undefined) {
                specs.push(staticString(argument)!);
            } else if ((ts.isPropertyAccessExpression(callee) && callee.name.text === "require")
                || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === "require")) {
                violations.push(`.require( called on a receiver: ${callee.getText(sf).slice(0, 24)}`);
            }
        } else if (ts.isIdentifier(node)) {
            if (node.text === "constructor") reportName(node, `the name constructor: ${node.parent.getText(sf).slice(0, 24)}`);
            else if (node.text === "createRequire") violations.push("createRequire");
            else if (node.text === "require" && !isPropertyName(node) && !isStaticRequireCallee(node, staticString)) {
                violations.push(`require used other than as require("literal"): ${node.parent.getText(sf).slice(0, 24)}`);
            } else if (node.text === "module" && !isPropertyName(node) && !isDeclarationName(node)) {
                violations.push(`module used as a value: ${node.parent.getText(sf).slice(0, 24)}`);
            } else if (node.text === "Reflect" && !isPropertyName(node) && !isDeclarationName(node) && !isTypeReferenceName(node) && !isSafeReflectUse(node)) {
                violations.push(`Reflect used other than as Reflect.ownKeys(...) / Reflect.has(...): ${node.parent.getText(sf).slice(0, 24)}`);
            } else if (DYNAMIC_CODE_NAMES.has(node.text) && !isPropertyName(node) && !isDeclarationName(node) && !isTypeReferenceName(node)) {
                violations.push(`${node.text} used as a value: ${node.parent.getText(sf).slice(0, 24)}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return { specifiers: specs, violations, allowanceUses };
}

function specifiers(source: string): string[] {
    return analyzeLoads(source).specifiers;
}

/** `createRequire` and a dynamic `import(x)` / `require(x)` with a computed argument load code the specifier scan never sees. */
function loaderViolations(source: string, file?: string): string[] {
    return analyzeLoads(source, file).violations;
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

/** `"c" + "o" + ... + "r"`: spells `constructor` in 11 parts, more than any fixed resolution depth. */
const LONG_CONCAT = [..."constructor"].map((char) => JSON.stringify(char)).join(" + ");
/** 30 parts that still spell `constructor`: empty strings padded between the letters. */
const SPLIT_OVER_30_PARTS = [..."constructor"].flatMap((char, index) => (index < 8 ? [JSON.stringify(char), '""', '""'] : [JSON.stringify(char)])).join(" + ");
/** Eleven chained `const` aliases, each cast, whose last link spells `constructor`. */
const ALIAS_CHAIN = ['const a0 = "c" as string', ...[..."onstructor"].map((char, index) => `const a${index + 1} = (a${index} as string) + ${JSON.stringify(char)}`)].join("; ");

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
            "const o = { constructor: 1 };",
            "class D extends Function {}",
            '(() => {}).constructor("return process")()',
            'Object.getPrototypeOf(async function(){}).constructor("return process")()',
            'x["constructor"]("return process")()',
            'x?.constructor("return process")()',
            "const C = x.constructor;",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        for (const good of [
            "foo.eval",
            "foo.eval(x)",
            "const o = { arguments: 1 };",
            "interface Callback { Function: string }",
            "function f(args: string[]) { return args; }",
            "class C { eval() { return 1; } arguments = 2; }",
            "const { x: eval_ } = y;",
            "class K { constructor(private readonly a: string) {} }",
            "class L extends K { constructor() { super(\"a\"); } }",
            "interface I { constructor: string }",
            "type T = { constructor: string };",
            "let x: { constructor: string };",
        ]) expect(loaderViolations(good)).toEqual([]);
    });

    it("should refuse every statically known banned name, however spelled, and accept runtime keys and plain constructors (the check itself can fail)", () => {
        for (const bad of [
            '(() => {})["con" + "structor"]("return this")()["pro" + "cess"]["e" + "nv"]',
            'const { constructor: C } = (() => {}); C("return this")()["pro" + "cess"]["e" + "nv"]',
            'const k = "constructor"; f[k]("return this")',
            'Reflect.get(() => {}, "constructor")',
            'const { ["con" + "structor"]: C } = f',
            "f[`con${\"structor\"}`]",
            'g["global" + "This"]',
            'const k = "pro" + "cess"; g[k]',
            'f[("constructor")]',
            'const a = "con", b = "structor"; f[a + b]',
            'const { "constructor": C } = f',
            "({ constructor: C } = f)",
            'x["env"]',
            'Reflect.apply(f, null, [])',
            'Reflect.construct(F, [])',
            'Reflect.getOwnPropertyDescriptor(o, "a")',
            "Reflect.getPrototypeOf(o)",
            'Reflect["get"](o, "a")',
            "Reflect[k](o)",
            "const R = Reflect",
            "run(Reflect)",
            "const { get } = Reflect",
            "Reflect.ownKeys.call(null, x)",
            "const own = Reflect.ownKeys; own(x)",
            // F2: rules keyed on the value, whatever the syntactic position.
            `f[${LONG_CONCAT}]`,
            `const k = ${SPLIT_OVER_30_PARTS}; f[k]`,
            `${ALIAS_CHAIN}; f[a11 + ""]`,
            "[{ constructor: C }] = [f]",
            "for ({ constructor: D } of [f]) {}",
            "for (const { constructor: E } of [f]) {}",
            "const { a: [{ constructor: G }] } = f",
            "const o = { constructor: 1 }",
            "const o = { constructor() { return 1; } }",
            "const { constructor } = f",
            'const o = { "constructor": 1 }',
            'const k = "pro" + "cess"',
            "const t = `en${\"v\"}`",
            'const e = "e" + "v" + "al"; e',
            "run(x ?? 'constructor')",
            'const bad = "constructor" as string; run(bad)',
            "class D { static m() { return this.constructor; } }",
            "class D extends x.constructor {}",
            "const a = x + 'constructor'",
        ]) expect(loaderViolations(bad)).not.toEqual([]);
        for (const good of [
            "function pick(obj: Record<string, number>, key: string) { return obj[key]; }",
            'const k = "id"; obj[k]',
            'const rows = ["a"]; rows[0]; obj[rows[0]!]',
            "class K { constructor(private readonly a: string) {} }",
            "const o = { process: 2 }; o.process",
            "const { id, ...rest } = row;",
            "const { id: renamed } = row;",
            'const k = "id"; const { [k]: v } = row;',
            "class K2 { constructor(public readonly a: string, private b = 1) { run(a, b); } }",
            "interface Shape { constructor: Function; process: string }",
            "type Mixed = { env: string; constructor: unknown };",
            "function fn(obj: Record<string, number>, key: string) { return obj[key] ?? obj[key + 'x']; }",
            'require("zod")',
            // A cycle of consts resolves to nothing and terminates.
            "const a1 = b1; const b1 = a1; run(a1);",
            'const self = self + "x"; run(self);',
            "Reflect.ownKeys(x)",
            'Reflect.has(x, "a")',
            "if (Reflect.ownKeys(x).length > 0) run();",
            "type R = Record<string, number>; const t: R[\"a\"] = 1;",
        ]) expect(loaderViolations(good)).toEqual([]);
        // A load whose name is statically known is checked against the allowlist as if it were a literal.
        const file = "infrastructure/eformsign-backup/worker/x.ts";
        for (const [source, expected] of [
            ['require("node:" + "module")', ["node:module"]],
            ['const m = "./runner"; import(m)', ["./runner"]],
            ["require(`zo${\"d\"}`)", ["zod"]],
            ['await import(("node:fs") + "/promises")', ["node:fs/promises"]],
        ] as Array<[string, string[]]>) {
            expect(specifiers(source)).toEqual(expected);
            expect(loaderViolations(source)).toEqual([]);
        }
        expect(allowed(file, "node:module")).toBe(false);
        for (const bad of ['require("./" + name)', "const m = name + 1; import(m)", "let m = './runner'; import(m)"]) expect(loaderViolations(bad)).not.toEqual([]);
    });

    it("should allow banned-name data strings only through exact, still-matching DATA_ALLOWLIST entries (the check itself can fail)", () => {
        for (const entry of DATA_ALLOWLIST) {
            const source = scanned.get(entry.file)!;
            expect(entry.reason.length).toBeGreaterThan(10);
            // The entry's text occurs exactly once in its file, and the scan uses it exactly once.
            expect(source.split(entry.text).length - 1).toBe(1);
            const { violations, allowanceUses } = analyzeLoads(source, entry.file);
            expect(violations).toEqual([]);
            expect(allowanceUses.get(entry.text)).toBe(1);
            // Without the entry, the same expression is a violation: it is load-bearing, not dead.
            expect(loaderViolations(entry.text)).not.toEqual([]);
            expect(loaderViolations(entry.text, "domain/eformsign-backup/worker/other.ts")).not.toEqual([]);
            expect(loaderViolations(entry.text, entry.file)).toEqual([]);
            // A different expression with the same strings in the same file is not covered.
            expect(loaderViolations(`run(["constructor"].includes(key))`, entry.file)).not.toEqual([]);
        }
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
        for (const [file, source] of scanned) for (const hit of loaderViolations(source, file)) offenders.push(`${file}: ${hit}`);
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
