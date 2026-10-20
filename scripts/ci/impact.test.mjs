import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPaths, complete, compareEvent } from './impact.mjs';

for (const [paths, expected, qa] of [
  [[], [], 'not-applicable'],
  [['docs/guide.md', 'docs/nested/help.md', 'docs/guide.txt', 'docs/guide.rst', 'frontend/docs/help.md', 'backend/docs/help.md', 'mobile/docs/help.md'], [], 'not-applicable'],
  [['backend/scripts/maintenance.ts'], ['backend','frontend'], 'assessment-required'],
  [['backend/src/orders.ts'], ['backend','frontend'], 'assessment-required'],
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

// Independent expectations pin real consumers, not a closure over selected app jobs.
for (const [path, expected, qa] of [
  ['backend/application/dto/contract.dto.ts', ['backend','frontend'], 'assessment-required'],
  ['frontend/src/app/api/ai/chat/stream/route.ts', ['backend','frontend'], 'interaction-visual-responsive-required'],
  ['mobile/src/app/api/ai/chat/stream/route.ts', ['backend','mobile'], 'interaction-visual-responsive-required'],
  ['frontend/src/components/app/clients/client-update-payload.ts', ['frontend','mobile'], 'interaction-visual-responsive-required'],
  ['frontend/src/components/app/chat/parts/AgentPartRegistry.tsx', ['backend','frontend'], 'interaction-visual-responsive-required'],
  ['mobile/src/components/app/chat/MobileAgentPartRegistry.tsx', ['backend','mobile'], 'interaction-visual-responsive-required'],
  ['frontend/src/components/app/clients/unrelated.ts', ['frontend'], 'interaction-visual-responsive-required'],
  ['mobile/src/components/app/clients/unrelated.ts', ['mobile'], 'interaction-visual-responsive-required'],
  ['backend/deploy/cloudrun/excluded-keys.txt', ['backend','frontend'], 'assessment-required'],
  ['README.md', ['backend'], 'assessment-required'],
  ['frontend/src/content/help.md', ['frontend'], 'interaction-visual-responsive-required'],
  ['mobile/src/content/help.md', ['mobile'], 'interaction-visual-responsive-required'],
  ['registry/authorization.txt', ['backend','frontend','mobile'], 'assessment-required'],
  ['unrecognized/new-policy.md', ['backend','frontend','mobile'], 'assessment-required'],
  ['packages/shared/src/help.md', ['backend','frontend','mobile'], 'assessment-required'],
  ['packages/service-record-ui/src/help.md', ['frontend','mobile'], 'interaction-visual-responsive-required'],
]) test(`consumer or non-doc input ${path}`, () => {
  const result = classifyPaths([path]);
  assert.deepEqual(Object.keys(result.selected).filter(key => result.selected[key]), expected);
  assert.equal(result.qa.status, qa);
  // Every refused exemption remains paired with a supported ordinary docs exemption.
  assert.deepEqual(classifyPaths(['docs/nested/help.md']).selected, {backend:false,frontend:false,mobile:false});
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

for (const path of ['backend/domain/constants/system-template-registry.ts', 'backend/domain/constants/service-end-notice-message.ts']) {
  test(`shared compiler backend input selects every required consumer: ${path}`, () => {
    const result = classifyPaths([path]);
    assert.deepEqual(result.selected, {backend:true,frontend:true,mobile:true});
    assert.equal(result.qa.status, 'assessment-required');
  });
}
