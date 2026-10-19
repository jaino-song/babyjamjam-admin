import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPaths, complete, compareEvent } from './impact.mjs';

for (const [paths, expected, qa] of [
  [[], [], 'not-applicable'],
  [['README.md', 'docs/guide.md', 'frontend/docs/help.md'], [], 'not-applicable'],
  [['backend/scripts/maintenance.ts'], ['backend'], 'assessment-required'],
  [['backend/src/orders.ts'], ['backend'], 'assessment-required'],
  [['frontend/src/page.tsx'], ['frontend'], 'interaction-visual-responsive-required'],
  [['mobile/src/page.tsx'], ['mobile'], 'interaction-visual-responsive-required'],
  [['packages/shared/src/index.ts'], ['backend','frontend','mobile'], 'assessment-required'],
  [['packages/service-record-ui/src/index.tsx'], ['frontend','mobile'], 'interaction-visual-responsive-required'],
  [['native/shared/src/Foo.kt'], ['backend','frontend','mobile'], 'assessment-required'],
  [['mobile/package.json'], ['backend','frontend','mobile'], 'assessment-required'],
  [['docs/policies/review.md'], ['backend','frontend','mobile'], 'assessment-required'],
  [['package.json'], ['backend','frontend','mobile'], 'assessment-required'],
  [['frontend/tsconfig.json'], ['backend','frontend','mobile'], 'assessment-required'],
  [['infra/main.tf'], ['backend','frontend','mobile'], 'assessment-required'],
  [['docs/check.sh'], ['backend','frontend','mobile'], 'assessment-required'],
  [['AGENTS.md'], ['backend','frontend','mobile'], 'assessment-required'],
  [['unknown.xyz'], ['backend','frontend','mobile'], 'assessment-required'],
  [['scripts/ci/impact.mjs'], ['backend','frontend','mobile'], 'assessment-required'],
]) test(`routing ${JSON.stringify(paths)}`, () => {
  const result = classifyPaths(paths);
  assert.deepEqual(Object.keys(result.selected).filter(key => result.selected[key]), expected);
  assert.equal(result.qa.status, qa);
});

test('completion refuses every failure mode; only deliberate skips pass', () => {
  for (const selected of [true,false]) for (const result of ['success','failure','cancelled','skipped',undefined]) {
    const routing = classifyPaths(selected ? ['backend/src/index.ts'] : []);
    const valid = selected ? result === 'success' : ['success','skipped'].includes(result);
    if (valid) assert.equal(complete(routing, 'backend', 'success', result, String(selected)), true);
    else assert.throws(() => complete(routing, 'backend', 'success', result, String(selected)));
  }
  for (const impact of ['failure','cancelled','skipped',undefined])
    assert.throws(() => complete(classifyPaths([]),'backend',impact,'skipped','false'));
  for (const value of ['',undefined,'bogus','true'])
    assert.throws(() => complete(classifyPaths([]),'backend','success','skipped',value));
});
