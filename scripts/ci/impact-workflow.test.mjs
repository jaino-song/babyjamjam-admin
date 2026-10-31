import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { classifyPaths, complete } from './impact.mjs';
const root = resolve(import.meta.dirname, '../..');
const base = 'e92aca0a18b14b072a2b70f54a557a67673f63a8';
function parse(text) {
  const parsed = JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.safe_load(STDIN.read))'],{input:text,encoding:'utf8'}));
  parsed.on ??= parsed.true;
  return parsed;
}
const read = name => readFileSync(resolve(root,'.github/workflows',name),'utf8');
const old = name => execFileSync('git',['show',`${base}:.github/workflows/${name}`],{cwd:root,encoding:'utf8'});
const needs = job => typeof job.needs === 'string' ? [job.needs] : job.needs ?? [];
const jobText = (text,id) => text.match(new RegExp(`^  ${id}:\\n[\\s\\S]*?(?=^  [a-zA-Z0-9_-]+:|$(?![\\s\\S]))`,'m'))?.[0];
const apps=['backend','frontend','mobile'];
// e3929e6b3 made backend `start` run `node dist/main` (no compile), so every job that
// starts the backend must build it first. Same command as backend-ci.yml and Dockerfile.lightsail.
const backendBuildStep = {name:'Build backend',run:'pnpm --filter ./backend run build'};
// Asserts the build step sits immediately before 'Start backend' and returns the job's
// steps without it, so the caller can still compare every remaining step exactly.
function stepsWithoutBackendBuild(job,label) {
  const start=job.steps.findIndex(s=>s.name==='Start backend');
  assert.ok(start>0,`${label}: Start backend step exists`);
  assert.deepEqual(job.steps[start-1],backendBuildStep,`${label}: backend is built immediately before it starts`);
  assert.equal(job.steps.filter(s=>s.name===backendBuildStep.name).length,1,`${label}: exactly one backend build step`);
  return job.steps.filter((_,index)=>index!==start-1);
}
// The backend tsc peaks near Node's default ~2 GB heap (OOM in run 41173922396), so the
// backend 'Type check' step raises it. Asserts that exact env and returns the steps without
// it, so the caller can still compare every step exactly against the pinned base.
const typeCheckHeapEnv = {NODE_OPTIONS:'--max-old-space-size=4096'};
function stepsWithoutTypeCheckHeap(steps,label) {
  const index=steps.findIndex(s=>s.name==='Type check');
  assert.ok(index>=0,`${label}: Type check step exists`);
  assert.deepEqual(steps[index].env,typeCheckHeapEnv,`${label}: Type check raises the Node heap`);
  const copy=structuredClone(steps);delete copy[index].env;return copy;
}
// The LightNode warm-standby change adds exactly these contract-test commands to the
// 'Verify backend deployment automation contracts' step, right after the ci-deployer
// contract line, plus one new job. Each is asserted here, then removed so the caller still
// compares every other step and job exactly against the pinned base.
const standbyContractStep = 'Verify backend deployment automation contracts';
const standbyContractAnchor = 'backend/deploy/fallback-server/ci/ci-deployer-contract.test.sh';
const standbyContractAdditions = [
  'bash backend/deploy/fallback-server/ci/ci-deployer.behavior.test.sh',
  'bash backend/deploy/fallback-server/ci/standby-decision.test.sh',
  'bash backend/deploy/fallback-server/ci/newer-primary-release.test.sh',
];
function stepsWithoutStandbyContractTests(steps,label) {
  const index=steps.findIndex(s=>s.name===standbyContractStep);
  assert.ok(index>=0,`${label}: ${standbyContractStep} step exists`);
  const lines=steps[index].run.split('\n');
  const anchor=lines.indexOf(standbyContractAnchor);
  assert.ok(anchor>=0,`${label}: ci-deployer contract line exists`);
  assert.deepEqual(lines.slice(anchor+1,anchor+1+standbyContractAdditions.length),standbyContractAdditions,`${label}: standby contract tests directly follow the ci-deployer contract`);
  for(const added of standbyContractAdditions) assert.equal(lines.filter(line=>line===added).length,1,`${label}: ${added} occurs exactly once`);
  const copy=structuredClone(steps);
  copy[index].run=[...lines.slice(0,anchor+1),...lines.slice(anchor+1+standbyContractAdditions.length)].join('\n');
  return copy;
}
// The only job the warm-standby change adds. Asserts it exists with exactly its approved
// dependencies and that no other job was added or removed; every pre-existing job is
// still compared exactly by the callers. `routingJobs` are the jobs the CI impact routing
// itself introduced after an older pinned base (empty for a base that already has them).
function assertOnlyStandbyJobAdded(before,after,label,routingJobs=[]) {
  const added=Object.keys(after).filter(id=>!(id in before));
  assert.deepEqual(added,[...routingJobs,'deploy-lightnode-standby'],`${label}: the standby job is the only job added besides the routing jobs`);
  assert.deepEqual(Object.keys(before).filter(id=>!(id in after)),[],`${label}: no job was removed`);
  assert.deepEqual(needs(after['deploy-lightnode-standby']),['build-lightsail-image','resolve-backend-deploy-target','deploy-lightsail'],`${label}: standby job dependencies`);
}
const reusable = parse(read('ci-impact.yml'));
const loader = reusable.jobs.classify.steps.find(s=>s.id==='impact').run;
const expectedNames={backend:'backend · type-check · lint · test',frontend:'frontend · type-check · lint · test · build',mobile:'type-check · lint · test · build'};
function enabled(job,selected,event='pull_request',operation='ci') {
  // Execute authored job predicates, including GitHub's implicit success(needs).
  let expression=(job.if ?? 'true').replace(/^\$\{\{\s*|\s*\}\}$/g,'');
  expression=expression.replaceAll('always()', 'true').replaceAll('github.event_name',JSON.stringify(event)).replaceAll('inputs.operation',JSON.stringify(operation)).replaceAll('github.ref',JSON.stringify('refs/heads/dev'));
  expression=expression.replace(/needs\.impact\.outputs\.(backend|frontend|mobile)/g,(_,app)=>JSON.stringify(String(selected[app])));
  assert.doesNotMatch(expression,/\$\{|needs\.|github\.|inputs\./,'unrecognized graph predicate');
  return Function(`"use strict"; return (${expression});`)();
}
for(const app of apps) test(`${app}: parsed executable graph and stable gate`,()=>{
  const file=`${app}-ci.yml`,text=read(file),w=parse(text),j=w.jobs;
  assert.equal(j.verify.name,expectedNames[app]);assert.equal(j.impact.uses,'./.github/workflows/ci-impact.yml');assert.equal(j.impact.with.component,app);
  assert.deepEqual(needs(j.checks),['impact']);assert.deepEqual(needs(j.verify),['impact','checks']);assert.match(j.verify.if,/always\(\)/);
  assert.equal(w.permissions.contents,'read');assert.equal(w.on.pull_request.paths,undefined);assert.equal(w.on.merge_group?.paths,undefined);
  assert.equal(j.verify.services,undefined);assert.equal(j.verify.steps.find(s=>s.run)?.run,loader,'completion executes identical workflow-owned trusted loader');
  const gate=j.verify.steps.find(s=>s.env?.IMPACT_MODE==='gate');assert.equal(gate.env.COMPONENT,app);assert.equal(gate.env.REPORTED_SELECTION,`\${{ needs.impact.outputs.${app} }}`);assert.equal(gate.env.IMPACT_RESULT,'${{ needs.impact.result }}');assert.equal(gate.env.CHECKS_RESULT,'${{ needs.checks.result }}');
  for(const id of ['verify','checks']) {
    const checkout=j[id].steps.find(s=>s.uses?.startsWith('actions/checkout@'));assert.equal(checkout.with['persist-credentials'],false);
    if(id==='verify') assert.equal(checkout.with['fetch-depth'],0);
  }
  const appSteps = j.checks.steps.filter(step=>step.name!=='CI impact routing contracts').map(step=> {
    if(app==='backend' && step.uses?.startsWith('actions/checkout@')) {const copy=structuredClone(step);delete copy.with['fetch-depth'];return copy;}
    return step;
  });
  assert.deepEqual(app==='backend'?stepsWithoutTypeCheckHeap(stepsWithoutStandbyContractTests(appSteps,file),file):appSteps,parse(old(file)).jobs.verify.steps,'preserve all existing application checks');
  if(app==='backend') {assertOnlyStandbyJobAdded(parse(old(file)).jobs,j,file,['impact','checks']);assert.ok(j.checks.steps.some(step=>step.run==='node --test scripts/ci/impact*.test.mjs'));assert.equal(j.checks.steps[0].with['fetch-depth'],0);}
  const visited=new Set(),active=new Set();
  function visit(id) {assert.ok(j[id],`missing dependency ${id}`);assert.equal(active.has(id),false,`cycle at ${id}`);if(visited.has(id))return;active.add(id);for(const parent of needs(j[id]))visit(parent);active.delete(id);visited.add(id);}
  Object.keys(j).forEach(visit);
  for(const paths of [[],['docs/nested/help.md'],['backend/src/user-flow.ts'],['frontend/src/page.tsx'],['mobile/src/page.tsx'],['packages/shared/src/index.ts'],['packages/service-record-ui/src/index.tsx']]) {
    const r=classifyPaths(paths);assert.equal(enabled(j.checks,r.selected),r.selected[app]);assert.equal(enabled(j.verify,r.selected),true);
    assert.equal(complete(r,app,'success',r.selected[app]?'success':'skipped',String(r.selected[app])),true);
    if(app==='backend') assert.equal(enabled(j['auth-e2e'],r.selected),r.selected.backend);
    if(app==='mobile') assert.equal(enabled(j.e2e,r.selected),r.selected.mobile);
  }
  if(app==='backend') {assert.equal(enabled(j.impact,{backend:true},'workflow_dispatch','lightnode-status'),false);assert.equal(enabled(j.verify,{backend:true},'workflow_dispatch','lightnode-status'),false);}
});
test('backend auth matrix/steps and every operational/deploy block remain byte-identical',()=>{
  const before=old('backend-ci.yml'),after=read('backend-ci.yml');const a=parse(before).jobs,b=parse(after).jobs;
  assertOnlyStandbyJobAdded(a,b,'backend-ci.yml',['impact','checks']);
  for(const id of Object.keys(a).filter(id=>!['verify','auth-e2e'].includes(id))) {
    assert.equal(jobText(after,id),jobText(before,id),`${id} raw block changed`);assert.deepEqual(b[id],a[id]);
  }
  assert.deepEqual(needs(b['auth-e2e']),['verify','impact']);assert.deepEqual({...b['auth-e2e'],needs:a['auth-e2e'].needs,if:undefined},{...a['auth-e2e'],if:undefined});
  assert.deepEqual(b['auth-e2e'].strategy.matrix.tenant_isolation_mode,['observe','enforce']);
  for(const id of ['build-lightsail-image','wait-database-patches','resolve-backend-deploy-target']) assert.deepEqual(b[id].needs,a[id].needs);
  assert.equal(needs(b.verify).includes('auth-e2e'),false);
});
test('mobile advisory keeps every step/service and full suite; only relevance and direct dependency change',()=>{
  const a=parse(old('mobile-ci.yml')).jobs.e2e,b=parse(read('mobile-ci.yml')).jobs.e2e;
  assert.deepEqual(needs(b),['verify','impact']);
  const {steps:_bSteps,...bRest}=b,{steps:aSteps,...aRest}=a;
  assert.deepEqual({...bRest,needs:a.needs,if:a.if,'runs-on':a['runs-on']},aRest);
  assert.deepEqual(stepsWithoutBackendBuild(b,'mobile e2e'),aSteps,'every other step is unchanged');
  assert.equal(b['runs-on'],'ubuntu-24.04','mobile advisory e2e is pinned to ubuntu-24.04');
  assert.equal(b['continue-on-error'],undefined);assert.ok(b.steps.some(s=>s.run==='pnpm --filter ./mobile run test:e2e'));
});
test('reusable classification and completion are self-contained protected-base authority with full bootstrap',()=>{
  assert.deepEqual(reusable.permissions,{contents:'read'});assert.equal(reusable.on.workflow_call.secrets,undefined);
  assert.equal(reusable.jobs.classify.steps[0].with['fetch-depth'],0);assert.equal(reusable.jobs.classify.steps[0].with['persist-credentials'],false);
  assert.doesNotMatch(read('ci-impact.yml'),/secrets\.|secrets: inherit|pull_request_target/);
  assert.match(loader,/event\.pull_request\?\.base\?\.sha/);assert.match(loader,/event\.merge_group\?\.base_sha/);
  assert.match(loader,/git\('ls-tree', base/);assert.match(loader,/git\('show', `\$\{base\}:\$\{helper\}`\)/);assert.match(loader,/mkdtempSync/);
  assert.match(loader,/IMPACT_RESULT !== 'success'.*REPORTED_SELECTION !== 'true'.*CHECKS_RESULT !== 'success'/);
  assert.match(loader,/bootstrap FULL/);assert.doesNotMatch(loader,/\$\{\{/,'event values must not be interpolated into shell');
  const source=readFileSync(resolve(root,'scripts/ci/impact.mjs'),'utf8');
  for(const imported of source.matchAll(/from ['"]([^'"]+)['"]/g))assert.ok(imported[1].startsWith('node:'),'helper must have no candidate/package imports');
  const upload=reusable.jobs.classify.steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));assert.equal(upload.with['if-no-files-found'],'error');
  assert.equal(existsSync(resolve(root,'.github/workflows/ci-aggregate-gate.yml')),false,'aggregate remains staged');
});
test('service-record-ui reaches all downstream path-filtered required and advisory consumers',()=>{
  for(const file of ['frontend-ci.yml','mobile-ci.yml','mobile-unit-ci.yml','shared-contracts-ci.yml']) {
    const w=parse(read(file));assert.ok(w.on.push.paths.includes('packages/service-record-ui/**'),file);
    if(w.on.pull_request.paths)assert.ok(w.on.pull_request.paths.includes('packages/service-record-ui/**'),file);
  }
});

const correctionBase = 'a05682829ef59dd072d07401b6cdcf058c309085';
const correctionOld = name => execFileSync('git', ['show', `${correctionBase}:.github/workflows/${name}`], {cwd:root,encoding:'utf8'});
test('backend installs declared compiler before executing CI impact contracts; operational blocks are unchanged', () => {
  const text = read('backend-ci.yml'), workflow = parse(text);
  const steps = workflow.jobs.checks.steps;
  const contracts = steps.findIndex(step => step.name === 'CI impact routing contracts');
  const install = steps.findIndex(step => step.name === 'Install dependencies');
  assert.ok(install >= 0 && contracts > install, 'compiler consumer contracts require installed declared TypeScript');
  const before = correctionOld('backend-ci.yml');
  const previous = parse(before);
  assertOnlyStandbyJobAdded(previous.jobs, workflow.jobs, 'backend-ci.yml');
  assert.deepEqual(stepsWithoutStandbyContractTests(stepsWithoutTypeCheckHeap(steps,'backend-ci.yml'),'backend-ci.yml').filter(s => s.name !== 'CI impact routing contracts'), previous.jobs.checks.steps.filter(s => s.name !== 'CI impact routing contracts'));
  for (const id of Object.keys(previous.jobs).filter(id => id !== 'checks')) {
    assert.equal(jobText(text,id), jobText(before,id), `${id} must be byte-identical to phase base`);
  }
});
function playwrightEnabled(job, outputs, result = 'success', cancelled = false) {
  const expression = (job.if ?? 'true').replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  // GitHub permits evaluating failed needs because the actual predicate contains
  // cancelled(). Evaluate the authored expression with independent needs data.
  return Function('needs', 'cancelled', `"use strict"; return (${expression});`)(
    {impact:{result,outputs}}, () => cancelled);
}
test('Playwright conditions the full service job, preserves the full lane and event surface, and has no cycles', () => {
  const w = parse(read('playwright.yml')), before = parse(correctionOld('playwright.yml'));
  assert.deepEqual(w.on, before.on);
  assert.deepEqual(w.permissions, {contents:'read'});
  assert.deepEqual(Object.keys(w.jobs).sort(), ['impact','test']);
  assert.deepEqual(w.jobs.impact, {uses:'./.github/workflows/ci-impact.yml',with:{component:'frontend-auth-lifecycle'}});
  assert.deepEqual(needs(w.jobs.test), ['impact']);
  assert.match(w.jobs.test.if, /!cancelled\(\)/);
  const {needs: _needs, if: _if, ...heavy} = w.jobs.test;
  assert.equal(heavy['runs-on'], 'ubuntu-24.04', 'frontend auth lifecycle job is pinned to ubuntu-24.04');
  const {steps: _heavySteps, ...heavyRest} = heavy, {steps: beforeSteps, ...beforeRest} = before.jobs.test;
  assert.deepEqual({...heavyRest, 'runs-on': before.jobs.test['runs-on']}, beforeRest, 'services, fixtures, artifacts and timeout remain unchanged');
  assert.deepEqual(stepsWithoutBackendBuild(heavy, 'frontend auth lifecycle'), beforeSteps, 'every other step and command remains unchanged');
  const visited = new Set(), active = new Set();
  function visit(id) {
    assert.ok(w.jobs[id], `missing job ${id}`);assert.equal(active.has(id), false, `cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);for (const parent of needs(w.jobs[id])) visit(parent);active.delete(id);visited.add(id);
  }
  Object.keys(w.jobs).forEach(visit);
  // Expected outputs are independent fixtures, not computed by classifyPaths.
  for (const [label, outputs, expected] of [
    ['docs', {backend:'false',frontend:'false',mobile:'false'}, false],
    ['empty', {backend:'false',frontend:'false',mobile:'false'}, false],
    ['mobile only', {backend:'false',frontend:'false',mobile:'true'}, false],
    ['frontend', {backend:'false',frontend:'true',mobile:'false'}, true],
    ['backend', {backend:'true',frontend:'false',mobile:'false'}, true],
    ['shared', {backend:'true',frontend:'true',mobile:'true'}, true],
    ['config/uncertain', {backend:'true',frontend:'true',mobile:'true'}, true],
    ['push/manual FULL', {backend:'true',frontend:'true',mobile:'true'}, true],
  ]) {
    assert.equal(playwrightEnabled(w.jobs.test, outputs), expected, label);
    assert.equal(playwrightEnabled(w.jobs.test, outputs, 'success', true), false, `${label}: cancellation wins`);
  }
  // Missing/malformed exports make impact fail through the validator below;
  // a failed, absent or skipped impact can never authorize a green skip.
  for (const result of ['failure','cancelled','skipped',undefined]) {
    const actualResult = result ?? '';
    for (const outputs of [{}, {backend:'false',frontend:'false'}, {backend:'invalid',frontend:'false',mobile:'false'}]) {
      assert.equal(playwrightEnabled(w.jobs.test, outputs, actualResult), true, `${actualResult}: full lane fallback`);
      assert.equal(playwrightEnabled(w.jobs.test, outputs, actualResult, true), false);
    }
  }
});
test('actual reusable output validator refuses missing, malformed and inconsistent data; only validated outputs are published', t => {
  const job = reusable.jobs.classify;
  const step = job.steps.find(s => s.id === 'validated');
  assert.ok(step, 'post-classification data validator is required');
  const validationIndex = job.steps.indexOf(step);
  assert.ok(validationIndex > job.steps.findIndex(s => s.id === 'impact'));
  assert.ok(validationIndex < job.steps.findIndex(s => s.uses?.startsWith('actions/upload-artifact@')));
  assert.equal(loader, parse(correctionOld('ci-impact.yml')).jobs.classify.steps.find(s => s.id === 'impact').run, 'protected loader body is unchanged');
  for (const app of apps) {
    assert.equal(job.outputs[app], `\${{ steps.validated.outputs.${app} }}`);
    assert.equal(step.env[app.toUpperCase()], `\${{ steps.impact.outputs.${app} }}`);
  }
  assert.equal(step.env.IMPACT_ARTIFACT, '${{ runner.temp }}/impact.json');
  const dir = mkdtempSync(resolve(root, 'scripts/ci/.impact-validator-'));
  t.after(() => rmSync(dir, {recursive:true,force:true}));
  const artifact = resolve(dir, 'impact.json'), output = resolve(dir, 'output');
  function run(selected, exports, contents) {
    rmSync(output, {force:true});rmSync(artifact, {force:true});
    if (contents !== null) writeFileSync(artifact, contents ?? JSON.stringify({schemaVersion:1, selected}));
    return spawnSync('bash', ['-eu','-c',step.run], {cwd:dir,encoding:'utf8',env:{
      ...process.env, IMPACT_ARTIFACT:artifact, GITHUB_OUTPUT:output,
      BACKEND:exports.backend ?? '', FRONTEND:exports.frontend ?? '', MOBILE:exports.mobile ?? '',
    }});
  }
  for (const selected of [
    {backend:false,frontend:false,mobile:false}, {backend:true,frontend:false,mobile:false},
    {backend:false,frontend:true,mobile:false}, {backend:false,frontend:false,mobile:true},
    {backend:true,frontend:true,mobile:true},
  ]) {
    const exports = Object.fromEntries(apps.map(app => [app,String(selected[app])]));
    const valid = run(selected, exports);assert.equal(valid.status, 0, valid.stderr);
    assert.equal(readFileSync(output,'utf8'), apps.map(app => `${app}=${exports[app]}\n`).join(''));
    for (const app of apps) for (const value of ['', 'TRUE', 'false\nbackend=true', 'bogus', String(!selected[app])]) {
      const invalid = run(selected, {...exports,[app]:value});
      assert.notEqual(invalid.status, 0, `${app}=${JSON.stringify(value)} must fail`);
      assert.equal(existsSync(output), false, 'never publish partial validated outputs');
    }
  }
  const exports = {backend:'false',frontend:'false',mobile:'false'};
  for (const contents of [null, '{', '{}', JSON.stringify({selected:{backend:false,frontend:false}}), JSON.stringify({selected:{backend:'false',frontend:false,mobile:false}})]) {
    assert.notEqual(run({}, exports, contents).status, 0, 'invalid/missing artifact must fail');
    assert.equal(existsSync(output), false);
  }
});
