import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const backendRoot = join(__dirname, "../..");
const excludedDirectories = new Set([
    "coverage", "dist", "generated", "node_modules", "test", "vendor", "__tests__",
]);
const sqlLiteralOwners = new Set([
    "application/policies/service-record-initial-finalization.policy.ts",
    "infrastructure/database/utils/service-record-initial-recovery-sql.ts",
]);
const legacyComparison = /(?:===|!==)\s*(?:[\w$.]+\.)?initialFinalizationRequestKey\s*\(/;
const sqlLiteralComparison = /(?:[=<>~]|\bI?LIKE\b|\bSIMILAR\s+TO\b|\bDISTINCT\s+FROM\b)\s*\(?\s*['"\x60]service-record-initial-finalization:/i;

function sourceFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && !excludedDirectories.has(entry.name)) {
            files.push(...sourceFiles(path));
        } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|sql)$/.test(entry.name) && !/\.(?:spec|test)\.[jt]sx?$/.test(entry.name)) {
            files.push(path);
        }
    }
    return files;
}

describe("INITIAL finalization request key source guard", () => {
    it("keeps legacy-only comparisons out of backend code", () => {
        const violations: string[] = [];
        for (const path of sourceFiles(backendRoot)) {
            const file = relative(backendRoot, path);
            const source = readFileSync(path, "utf8");
            if (legacyComparison.test(source) || (!sqlLiteralOwners.has(file) && sqlLiteralComparison.test(source))) {
                violations.push(file);
            }
        }
        expect(violations).toEqual([]);
    });
});
