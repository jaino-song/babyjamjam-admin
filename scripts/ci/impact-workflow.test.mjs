import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
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
  assert.deepEqual(appSteps,parse(old(file)).jobs.verify.steps,'preserve all existing application checks');
  if(app==='backend') {assert.ok(j.checks.steps.some(step=>step.run==='node --test scripts/ci/impact*.test.mjs'));assert.equal(j.checks.steps[0].with['fetch-depth'],0);}
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
  assert.deepEqual(needs(b),['verify','impact']);assert.deepEqual({...b,needs:a.needs,if:a.if},a);
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
