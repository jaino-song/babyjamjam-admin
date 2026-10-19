import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const cli = resolve('scripts/ci/qa-handoff.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  writeFileSync(join(root, 'tracked'), 'initial'); git('add', 'tracked'); git('commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const impact = { schemaVersion: 1, candidate: { event: 'pull_request', sha, base: sha, head: sha, mergeBase: sha }, comparison: { kind: 'merge-base', reason: 'fixture' }, paths: ['frontend/page.tsx'], categories: { frontend: true, uncertain: false }, selected: { backend: false, frontend: true, mobile: false }, qa: { status: 'interaction-visual-responsive-required', reasons: ['UI'] }, reasons: ['UI'] };
  const manifest = { schemaVersion: 1, candidateSha: sha, target: 'login', evidencePath: join(root, 'evidence'), assessment: { by: 'Main', reference: 'assessment:1', decision: 'required', reason: 'Login flow' }, verification: [{ id: 'frontend', component: 'frontend', kind: 'local', required: true, sha, status: 'success', exitCode: 0, reference: 'log:1', result: 'checks passed' }], review: { sha, independent: true, reviewer: 'independent-reviewer', verdict: 'SHIP', reference: 'review:1', result: 'approved' }, deployment: { deploymentId: 'local-login', environmentId: 'isolated-local', buildDigest: 'sha256:fixture', servedCommit: sha, fixtureSnapshotId: 'anonymous-fixture', isolated: true, production: false, allowedOrigins: ['http://localhost:4000'], approvedOrigins: [], allowedEffects: ['READ'], accountRoleRefs: ['anonymous'], viewportProfiles: [{ id: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 }, { id: 'phone', width: 390, height: 844, deviceScaleFactor: 1 }], locale: 'ko-KR', timezone: 'Asia/Seoul', designReferenceRefs: ['spec:login'], testCases: [{ id: 'login', criterionId: 'AC-1', required: true, preconditions: ['anonymous'], fixtureRefs: ['fixture:anonymous'], actions: ['Open /login'], assertions: [{ id: 'state', oracleKind: 'DRIVER', expected: 'Login form visible', evidenceKinds: ['screenshot', 'resulting-state'] }, { id: 'visual', oracleKind: 'VISUAL_RUBRIC', expected: 'Matches approved design', evidenceKinds: ['screenshot'] }], viewportIds: ['desktop', 'phone'], cleanupRef: 'none:read-only' }] } };
  return { root, sha, impact, manifest, run() {
    writeFileSync(join(root, 'impact.json'), JSON.stringify(impact)); writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    return spawnSync(process.execPath, [cli, '--impact', join(root, 'impact.json'), '--manifest', join(root, 'manifest.json'), '--worktree', root, '--output-dir', join(root, 'out'), '--playbook-root', '/operator/.agents/playbook', '--lane', 'codex'], { encoding: 'utf8' });
  } };
}
test('isolated UI handoff preserves every case/viewport and emits inert lifecycle argv', t => {
  const f = fixture(t); f.manifest.target = 'login;$(touch PWNED)'; f.manifest.deployment.nodeEnv = 'production';
  assert.equal(f.run().status, 0);
  const result = JSON.parse(readFileSync(join(f.root, 'out/readiness.json')));
  assert.equal(result.status, 'prepared'); assert.equal(result.candidate.sha, f.sha);
  assert.ok(result.lifecycle.start.argv.includes('login;$(touch PWNED)'));
  assert.equal(existsSync(join(f.root, 'PWNED')), false);
  assert.equal(result.unexecutedCoverage.length, 4);
  assert.match(result.trustBoundary, /consistency.*not authenticity/i);
  assert.match(readFileSync(join(f.root, 'out/dispatch.md'), 'utf8'), /resulting-state/);
});
test('reviewed maintenance exemption remains explicit and does not start QA', t => {
  const f = fixture(t); f.impact.qa.status = 'assessment-required'; f.impact.categories = { backend: true, uncertain: true }; f.manifest.assessment.decision = 'exempt';
  assert.equal(f.run().status, 0); const r = JSON.parse(readFileSync(join(f.root, 'out/readiness.json')));
  assert.equal(r.assessment.decision, 'exempt'); assert.equal(r.lifecycle, null);
});
test('backend user-flow assessment required accepts complete explicit Main assessment', t => {
  const f = fixture(t); f.impact.qa.status = 'assessment-required'; assert.equal(f.run().status, 0);
});
test('intentional unselected app skip requires same-component successful stable gate', t => {
  const f = fixture(t); const common = { component: 'mobile', kind: 'ci', required: true, sha: f.sha, reference: 'ci:2', result: 'intentional routing' };
  f.manifest.verification.push({ ...common, id: 'mobile-job', status: 'skipped', intentionalSkip: true, skipReason: 'impact deselected mobile' }, { ...common, id: 'mobile-gate', status: 'success', stableGate: true });
  assert.equal(f.run().status, 0);
});
const refusals = {
  'stale review': f => f.manifest.review.sha = 'a'.repeat(40),
  'stale verification': f => f.manifest.verification[0].sha = 'a'.repeat(40),
  'stale served commit': f => f.manifest.deployment.servedCommit = 'a'.repeat(40),
  'dirty tracked worktree': f => writeFileSync(join(f.root, 'tracked'), 'dirty'),
  'missing reference': f => f.manifest.verification[0].reference = '',
  'missing result': f => delete f.manifest.verification[0].result,
  'missing required verification': f => f.manifest.verification = [],
  'nonzero local exit': f => f.manifest.verification[0].exitCode = 1,
  'non-independent review': f => f.manifest.review.independent = false,
  'unknown viewport': f => f.manifest.deployment.testCases[0].viewportIds.push('unknown'),
  'unknown case reference': f => f.manifest.requiredCaseIds = ['unknown'],
  'missing state assertion': f => f.manifest.deployment.testCases[0].assertions[0].evidenceKinds = ['toast'],
  'missing screenshot': f => f.manifest.deployment.testCases[0].assertions.forEach(a => a.evidenceKinds = ['resulting-state']),
  'missing fixture': f => f.manifest.deployment.fixtureSnapshotId = '',
  'missing isolation': f => delete f.manifest.deployment.isolated,
  'production target': f => f.manifest.deployment.production = true,
  'production effects': f => f.manifest.deployment.allowedEffects = ['REAL_PAYMENT'],
  'inline password': f => f.manifest.password = 'fixture-secret',
  'inline bearer': f => f.manifest.deployment.testCases[0].actions.push('Bearer abcdefghijklmnopqrst'),
  'unapproved remote origin': f => f.manifest.deployment.allowedOrigins = ['https://qa.example.invalid'],
  'auto login remote origin': f => { f.manifest.autoLogin = true; f.manifest.deployment.allowedOrigins = ['https://qa.example.invalid']; f.manifest.deployment.approvedOrigins = ['https://qa.example.invalid']; },
  'missing assessment': f => delete f.manifest.assessment,
  'UI exemption': f => f.manifest.assessment.decision = 'exempt',
  'uncovered UI viewport': f => f.manifest.deployment.testCases[0].viewportIds = ['desktop'],
  'duplicate assertion': f => f.manifest.deployment.testCases[0].assertions[1].id = 'state',
  'unknown oracle': f => f.manifest.deployment.testCases[0].assertions[0].oracleKind = 'GUESS',
  'selected app skipped': f => Object.assign(f.manifest.verification[0], { status: 'skipped', intentionalSkip: true, skipReason: 'skip' }),
  'stable gate skipped': f => Object.assign(f.manifest.verification[0], { status: 'skipped', stableGate: true }),
};
for (const status of ['failure', 'cancelled', 'pending', 'blocked', 'inconclusive', 'neutral', 'unknown', undefined]) refusals[`required verification ${status}`] = f => f.manifest.verification[0].status = status;
for (const verdict of ['FAIL', 'BLOCKED', 'INCONCLUSIVE', 'PENDING', undefined]) refusals[`review ${verdict}`] = f => f.manifest.review.verdict = verdict;
for (const [name, mutate] of Object.entries(refusals)) test(`refuses ${name} without output`, t => { const f = fixture(t); mutate(f); assert.notEqual(f.run().status, 0); assert.equal(existsSync(join(f.root, 'out')), false); });

test('case-specific responsive assignments remain intact', t => {
  const f = fixture(t), first = f.manifest.deployment.testCases[0];
  first.viewportIds = ['desktop'];
  f.manifest.deployment.testCases.push({ ...structuredClone(first), id: 'phone-only', viewportIds: ['phone'] });
  assert.equal(f.run().status, 0);
  const r = JSON.parse(readFileSync(join(f.root, 'out/readiness.json')));
  assert.deepEqual(r.deployment.testCases.map(c => c.viewportIds), [['desktop'], ['phone']]);
});
test('explicit Main-approved isolated remote manual origin is allowed', t => {
  const f = fixture(t); f.manifest.deployment.allowedOrigins = ['https://qa.example.invalid']; f.manifest.deployment.approvedOrigins = ['https://qa.example.invalid'];
  assert.equal(f.run().status, 0);
});
test('nonrequired failed/unexecuted verification stays explicit, never success', t => {
  const f = fixture(t); f.manifest.verification.push({ id: 'optional', kind: 'local', required: false, sha: f.sha, status: 'not-run', reference: 'scope:1', result: 'not executed' });
  assert.equal(f.run().status, 0);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'out/readiness.json'))).nonrequiredVerification[0].status, 'not-run');
});
test('matching forged caller claims are consistency-only, not authenticated', t => {
  const f = fixture(t); f.manifest.review.reviewer = 'caller-claimed reviewer';
  assert.equal(f.run().status, 0);
  const r = JSON.parse(readFileSync(join(f.root, 'out/readiness.json')));
  assert.match(r.trustBoundary, /independently verify/); assert.equal(r.authenticated, undefined);
});
test('unselected skip without stable gate is refused', t => {
  const f = fixture(t); f.manifest.verification.push({ id: 'mobile', component: 'mobile', kind: 'ci', required: true, sha: f.sha, status: 'skipped', intentionalSkip: true, skipReason: 'deselected', reference: 'ci:1', result: 'skipped' });
  assert.notEqual(f.run().status, 0); assert.equal(existsSync(join(f.root, 'out')), false);
});
test('full/bootstrap comparison cannot authorize app skips', t => {
  const f = fixture(t); f.impact.comparison.kind = 'full';
  const common = { component: 'mobile', kind: 'ci', required: true, sha: f.sha, reference: 'ci:2', result: 'routing' };
  f.manifest.verification.push({ ...common, id: 'mobile-job', status: 'skipped', intentionalSkip: true, skipReason: 'deselected' }, { ...common, id: 'mobile-gate', status: 'success', stableGate: true });
  assert.notEqual(f.run().status, 0); assert.equal(existsSync(join(f.root, 'out')), false);
});
test('external storage-state path is a reference only; its content is never read', t => {
  const f = fixture(t); f.manifest.storageStatePath = join(f.root, 'does-not-exist.json');
  assert.equal(f.run().status, 0);
});
test('help does not prepare any handoff', () => {
  const r = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.match(r.stdout, /--manifest/);
});
test('functional UI case may rely on separate required visual coverage', t => {
  const f = fixture(t), first = f.manifest.deployment.testCases[0];
  const visualCase = { ...structuredClone(first), id: 'visual-layout' };
  first.assertions = first.assertions.filter(a => a.oracleKind === 'DRIVER');
  f.manifest.deployment.testCases.push(visualCase);
  assert.equal(f.run().status, 0);
  const r = JSON.parse(readFileSync(join(f.root, 'out/readiness.json')));
  assert.equal(r.deployment.testCases[0].assertions.length, 1);
});
test('UI matrix without any required visual rubric is refused', t => {
  const f = fixture(t); f.manifest.deployment.testCases[0].assertions = f.manifest.deployment.testCases[0].assertions.filter(a => a.oracleKind !== 'VISUAL_RUBRIC');
  assert.notEqual(f.run().status, 0); assert.equal(existsSync(join(f.root, 'out')), false);
});
test('PASS review is an approving independent outcome', t => {
  const f = fixture(t); f.manifest.review.verdict = 'PASS'; assert.equal(f.run().status, 0);
});
test('docs-only reviewed exemption is explicit, not browser PASS', t => {
  const f = fixture(t); f.impact.qa.status = 'not-applicable'; f.impact.selected.frontend = false; f.impact.paths = ['docs/example.md']; f.impact.categories = { docs: true }; f.manifest.assessment.decision = 'exempt';
  assert.equal(f.run().status, 0);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'out/readiness.json'))).status, 'prepared');
});
test('existing output is refused and never overwritten', t => {
  const f = fixture(t); assert.equal(f.run().status, 0);
  const before = readFileSync(join(f.root, 'out/readiness.json'), 'utf8');
  assert.notEqual(f.run().status, 0); assert.equal(readFileSync(join(f.root, 'out/readiness.json'), 'utf8'), before);
});
