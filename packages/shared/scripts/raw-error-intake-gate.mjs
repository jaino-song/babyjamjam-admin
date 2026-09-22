#!/usr/bin/env node

/**
 * Raw-error intake gate (BJJ-319 Phase 9, Task 9.1).
 *
 * Contract (docs/plans/bjj-319-remaining-plan.md L160): 새 원시 오류 유입은
 * 승인된 inventory 예외 없이 통과하지 못하게 검사한다.
 *
 * Rule (fail-closed): every runtime source file that matches the inventory's
 * own `raw_http_exception` discovery pattern must have an owner row in
 * `docs/error-management-inventory.json`. The inventory is the single
 * allowlist — this script hand-maintains no path list. A violation therefore
 * means: either convert the error to the sanctioned problem contract, or
 * register the file in the inventory with a classification and documented
 * reason (the approved-exception flow).
 *
 * The script also enumerates, report-only, two audited classes that require
 * semantic adjudication and are recorded in docs/error-management.md:
 *  - remaining raw-shaped 500 statements (`InternalServerErrorException` /
 *    `HttpException` throws whose body carries no problem-contract code),
 *  - failure→empty-success catch blocks in frontend/mobile data layers.
 *
 * Scan roots and the raw pattern are derived from the inventory itself
 * (`source_roots`, `method.patterns`). Test files, .d.ts, vendor parity
 * copies, and dependencies stay excluded exactly as in the inventory method.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
export const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../../..");
export const defaultInventoryPath = path.join(
    defaultRepoRoot,
    "docs/error-management-inventory.json",
);

const RUNTIME_SUFFIXES = new Set([".ts", ".tsx", ".mts"]);
const EXCLUDED_SEGMENTS = new Set([
    "node_modules",
    "__tests__",
    "vendor",
]);

export const RAW_500_PATTERN =
    /throw new (?:InternalServerErrorException|HttpException)\(/;
export const EMPTY_RETURN_PATTERN =
    /return\s+(?:NextResponse\.json\(\s*\[\s*\]|json\(\s*\[\s*\]|\[\s*\]|\{\s*\}|null|undefined|0)\s*;?/;
export const CATCH_BLOCK_PATTERN = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;

function isRuntimeSource(relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    if (!RUNTIME_SUFFIXES.has(path.extname(normalized))) return false;
    if (normalized.endsWith(".d.ts")) return false;
    const segments = normalized.split("/");
    if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
    // Test lanes follow the inventory method's "test files are not runtime owners".
    if (/(?:^|\/)(?:test|tests)(?:\/|$)/.test(normalized)) return false;
    if (/\.spec\.|\.test\./.test(normalized)) return false;
    return true;
}

export function collectRuntimeSources(repoRoot, roots) {
    const sources = new Map();
    for (const root of roots) {
        const absoluteRoot = path.join(repoRoot, root);
        if (!existsSync(absoluteRoot)) continue;
        const stack = [absoluteRoot];
        while (stack.length > 0) {
            const current = stack.pop();
            for (const entry of readdirSync(current, { withFileTypes: true })) {
                const absolute = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
                    stack.push(absolute);
                    continue;
                }
                const relative = path.relative(repoRoot, absolute);
                if (!isRuntimeSource(relative)) continue;
                sources.set(relative.split(path.sep).join("/"), readFileSync(absolute, "utf8"));
            }
        }
    }
    return sources;
}

/**
 * Rule 1 — the gate. Files whose source matches the inventory's own
 * `raw_http_exception` pattern must have an inventory owner row.
 */
export function findUncoveredRawErrors({ inventory, sources }) {
    const pattern = new RegExp(inventory.method.patterns.raw_http_exception);
    const inventoried = new Set(inventory.owners.map((owner) => owner.path));
    const violations = [];
    for (const [relativePath, source] of sources) {
        if (inventoried.has(relativePath)) continue;
        if (!pattern.test(source)) continue;
        violations.push(relativePath);
    }
    return violations.sort();
}

/** Report-only evidence: raw-shaped 500 statements (statement = throw line + next 2 lines). */
export function enumerateRaw500Statements({ sources }) {
    const findings = [];
    for (const [relativePath, source] of sources) {
        const lines = source.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
            if (!RAW_500_PATTERN.test(lines[index])) continue;
            const statement = lines
                .slice(index, index + 3)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            if (statement.includes("ProblemBody(") || statement.includes("code:")) continue;
            findings.push({ path: relativePath, line: index + 1, statement: statement.slice(0, 160) });
        }
    }
    return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * Report-only evidence: failure→empty-success catch blocks in the
 * frontend/mobile data layers (app/api routes, lib, hooks).
 */
export function enumerateEmptySuccessCatches({ sources }) {
    const scoped = (relativePath) =>
        /^(?:frontend|mobile)\/src\/(?:app\/api|lib|hooks)\//.test(relativePath);
    const findings = [];
    for (const [relativePath, source] of sources) {
        if (!scoped(relativePath)) continue;
        for (const match of source.matchAll(CATCH_BLOCK_PATTERN)) {
            if (!EMPTY_RETURN_PATTERN.test(match[1])) continue;
            const line = source.slice(0, match.index).split("\n").length;
            findings.push({
                path: relativePath,
                line,
                body: match[1].replace(/\s+/g, " ").trim().slice(0, 120),
            });
        }
    }
    return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function runGate({ repoRoot = defaultRepoRoot, inventoryPath = defaultInventoryPath, stdout = process.stdout } = {}) {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    const roots = Object.keys(inventory.source_roots);
    const sources = collectRuntimeSources(repoRoot, roots);
    const uncovered = findUncoveredRawErrors({ inventory, sources });
    const raw500 = enumerateRaw500Statements({ sources });
    const emptySuccess = enumerateEmptySuccessCatches({ sources });

    stdout.write(`raw-error intake gate: ${sources.size} runtime files scanned\n`);
    stdout.write(`  uncovered raw-error files: ${uncovered.length}\n`);
    stdout.write(`  raw-shaped 500 statements (report-only): ${raw500.length}\n`);
    stdout.write(`  failure→empty-success catches (report-only): ${emptySuccess.length}\n`);

    for (const violation of uncovered) {
        stdout.write(
            `UNCOVERED RAW ERROR: ${violation}\n` +
            "  convert to the sanctioned problem contract, or register the file in\n" +
            "  docs/error-management-inventory.json with a documented reason\n" +
            "  (approved-exception flow) before landing.\n",
        );
    }

    if (process.argv.includes("--report")) {
        for (const finding of raw500) {
            stdout.write(`RAW-500: ${finding.path}:${finding.line} ${finding.statement}\n`);
        }
        for (const finding of emptySuccess) {
            stdout.write(`EMPTY-SUCCESS: ${finding.path}:${finding.line} ${finding.body}\n`);
        }
    }

    return { uncovered, raw500, emptySuccess, scanned: sources.size };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMain) {
    const { uncovered } = runGate();
    process.exit(uncovered.length === 0 ? 0 : 1);
}
