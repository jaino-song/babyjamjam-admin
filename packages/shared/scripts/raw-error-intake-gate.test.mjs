import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
    defaultInventoryPath,
    collectRuntimeSources,
    findUncoveredRawErrors,
    enumerateRaw500Statements,
    enumerateEmptySuccessCatches,
} from "./raw-error-intake-gate.mjs";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);

function inventory() {
    return JSON.parse(readFileSync(defaultInventoryPath, "utf8"));
}

test("the current tree passes the intake gate — every raw-error file is inventoried", () => {
    const inv = inventory();
    const sources = collectRuntimeSources(repoRoot, Object.keys(inv.source_roots));
    assert.ok(sources.size > 1000, `unexpectedly small scan: ${sources.size}`);
    assert.deepEqual(findUncoveredRawErrors({ inventory: inv, sources }), []);
});

test("a raw exception throw in an un inventoried file is rejected", () => {
    const inv = inventory();
    const sources = new Map([
        ["backend/application/usecases/brand-new.feature.ts", `
export function guard(value: unknown) {
    if (!value) throw new BadRequestException("새 원시 오류 본문");
}
`],
    ]);
    const violations = findUncoveredRawErrors({ inventory: inv, sources });
    assert.deepEqual(violations, ["backend/application/usecases/brand-new.feature.ts"]);
});

test("an inventoried file that merely mentions exception classes is accepted", () => {
    const inv = inventory();
    const inventoriedPath = inv.owners[0].path;
    const sources = new Map([
        [inventoriedPath, "// references ConflictException in a comment\n"],
    ]);
    assert.deepEqual(findUncoveredRawErrors({ inventory: inv, sources }), []);
});

test("raw-shaped 500 statements are enumerated with sanctioned helpers excluded", () => {
    const sources = new Map([
        ["backend/a.ts", 'throw new InternalServerErrorException(codeOnlyProblemBody("INTERNAL_ERROR"));\n'],
        ["backend/b.ts", 'throw new InternalServerErrorException("raw known cause");\n'],
        ["backend/c.ts", 'throw new ConflictException("not a 500 shape");\n'],
    ]);
    const findings = enumerateRaw500Statements({ sources });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].path, "backend/b.ts");
    assert.equal(findings[0].line, 1);
});

test("failure→empty-success catches are enumerated only in the scoped data layers", () => {
    const sources = new Map([
        ["frontend/src/hooks/useThing.ts", `
try { await q(); } catch (error) {
    console.error(error);
    return [];
}
`],
        ["backend/application/services/svc.service.ts", `
try { await q(); } catch (error) {
    return [];
}
`],
        ["mobile/src/lib/report.ts", `
try { await q(); } catch (error) {
    return null;
}
`],
    ]);
    const findings = enumerateEmptySuccessCatches({ sources });
    assert.deepEqual(
        findings.map((f) => f.path),
        ["frontend/src/hooks/useThing.ts", "mobile/src/lib/report.ts"],
    );
});
