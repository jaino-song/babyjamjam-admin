import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, chmodSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { compareEvent } from './impact.mjs';

const root = resolve(import.meta.dirname, '../..');
const helper = readFileSync(join(root, 'scripts/ci/impact.mjs'), 'utf8');
const parse = name => JSON.parse(execFileSync('ruby', ['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))',join(root,'.github/workflows',name)], {encoding:'utf8'}));
const loader = parse('ci-impact.yml').jobs.classify.steps.find(s => s.id === 'impact').run;
export { parse, loader };
function fixture(t, protectedHelper = helper) {
  const cwd = mkdtempSync(join(root, 'scripts/ci/.impact-fixture-'));
  t.after(() => rmSync(cwd, { recursive:true, force:true }));
  const git = (...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q'); git('config','user.name','CI Fixture'); git('config','user.email','ci@example.invalid');
  const put = (path, data) => { mkdirSync(dirname(join(cwd,path)), {recursive:true}); writeFileSync(join(cwd,path),data); };
  const save = () => {git('add','.');git('-c','core.hooksPath=/dev/null','commit','-qm','fixture');return git('rev-parse','HEAD');};
  put('README.md','base'); put('backend/src/file.ts','same content\n');
  if (protectedHelper !== null) put('scripts/ci/impact.mjs',protectedHelper);
  const base = save();
  const event = (head, b=base) => ({pull_request:{base:{sha:b},head:{sha:head}}});
  function run(payload, mode='classify', extra={}) {
    put('.event.json',JSON.stringify(payload));
    const result = spawnSync('bash',['-eu','-c',loader], {cwd,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:join(cwd,'.event.json'),GITHUB_SHA:git('rev-parse','HEAD'),RUNNER_TEMP:cwd,GITHUB_OUTPUT:join(cwd,'.output'),GITHUB_STEP_SUMMARY:join(cwd,'.summary'),IMPACT_ARTIFACT:join(cwd,'.impact.json'),IMPACT_MODE:mode,...extra}});
    return {...result, routing: existsSync(join(cwd,'.impact.json')) ? JSON.parse(readFileSync(join(cwd,'.impact.json'),'utf8')) : null};
  }
  return {cwd,git,put,save,base,event,run};
}
test('real divergent PR compares merge-base; rebased head and empty PR remain correct',t=>{
  const f=fixture(t); f.git('checkout','-qb','topic'); f.put('frontend/src/changed.ts','topic');const head=f.save();
  f.git('checkout','-qb','base',f.base);f.put('mobile/src/base.ts','base-only');const advanced=f.save();
  let r=compareEvent(f.cwd,'pull_request',f.event(head,advanced),head);
  assert.deepEqual(r.paths,['frontend/src/changed.ts']);assert.equal(r.candidate.mergeBase,f.base);
  f.git('checkout','topic');f.git('rebase','base');const rebased=f.git('rev-parse','HEAD');
  r=compareEvent(f.cwd,'pull_request',f.event(rebased,advanced),rebased);assert.deepEqual(r.paths,['frontend/src/changed.ts']);assert.equal(r.candidate.mergeBase,advanced);
  assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(advanced,advanced),advanced).paths,[]);
});
test('real merge-group synthetic head/base preserves tested candidate vs PR head',t=>{
  const f=fixture(t);f.git('checkout','-qb','topic');f.put('mobile/src/new.ts','topic');const head=f.save();
  f.git('checkout','-qb','queue',f.base);f.put('README.md','updated base');const base=f.save();f.git('merge','--no-ff','-m','synthetic',head);const synthetic=f.git('rev-parse','HEAD');
  const r=compareEvent(f.cwd,'merge_group',{merge_group:{base_sha:base,head_sha:synthetic}},synthetic);
  assert.deepEqual(r.paths,['mobile/src/new.ts']);assert.equal(r.candidate.sha,synthetic);
  const pr=compareEvent(f.cwd,'pull_request',f.event(head,base),synthetic);assert.equal(pr.candidate.sha,synthetic);assert.equal(pr.candidate.head,head);
});
test('real rename includes old/new consumer paths; deletion selects old consumer',t=>{
  const f=fixture(t);f.git('mv','backend/src/file.ts','README-old.md');const head=f.save();
  const r=compareEvent(f.cwd,'pull_request',f.event(head),head);assert.deepEqual(r.paths,['README-old.md','backend/src/file.ts']);assert.equal(r.selected.backend,true);
  f.git('rm','README-old.md');const deleted=f.save();assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(deleted,head),deleted).paths,['README-old.md']);
});
test('invalid/unavailable comparison never becomes an exemption; push/manual ignore zero before',t=>{
  const f=fixture(t);
  for (const base of ['',undefined,'0'.repeat(40),'f'.repeat(40),'$(touch bad)']) assert.throws(()=>compareEvent(f.cwd,'pull_request',{pull_request:{base:{sha:base},head:{sha:f.base}}},f.base));
  for (const eventName of ['push','workflow_dispatch','unknown']) {
    const r=compareEvent(f.cwd,eventName,{before:'0'.repeat(40)},f.base);assert.deepEqual(r.selected,{backend:true,frontend:true,mobile:true});
    const actual=f.run({},'classify',{GITHUB_EVENT_NAME:eventName});assert.equal(actual.status,0,actual.stderr);assert.equal(actual.routing.comparison.kind,'full');
  }
});
test('actual workflow loader ignores malicious candidate helper and refuses false completion',t=>{
  const f=fixture(t);f.put('scripts/ci/impact.mjs',"import{writeFileSync}from'node:fs';writeFileSync('PWNED','candidate executed');process.exit(0);");const head=f.save();
  const r=f.run(f.event(head));assert.equal(r.status,0,r.stderr);assert.deepEqual(r.routing.selected,{backend:true,frontend:true,mobile:true});assert.equal(existsSync(join(f.cwd,'PWNED')),false);
  const pass=f.run(f.event(head),'gate',{COMPONENT:'backend',IMPACT_RESULT:'success',CHECKS_RESULT:'success',REPORTED_SELECTION:'true'});assert.equal(pass.status,0,pass.stderr);
  const refused=f.run(f.event(head),'gate',{COMPONENT:'backend',IMPACT_RESULT:'success',CHECKS_RESULT:'skipped',REPORTED_SELECTION:'false'});assert.notEqual(refused.status,0);
});
test('actual workflow loader authorizes protected docs skip and validates completion afresh',t=>{
  const f=fixture(t);f.put('docs/guide.md','docs');const head=f.save();const r=f.run(f.event(head));assert.equal(r.status,0,r.stderr);assert.deepEqual(r.routing.selected,{backend:false,frontend:false,mobile:false});
  for (const result of ['skipped','success','failure','cancelled','']) {
    const gate=f.run(f.event(head),'gate',{COMPONENT:'mobile',IMPACT_RESULT:'success',CHECKS_RESULT:result,REPORTED_SELECTION:'false'});
    assert.equal(gate.status===0,['skipped','success'].includes(result),gate.stderr);
  }
});
test('genuinely absent protected helper bootstraps FULL, including strict workflow-owned gate',t=>{
  const f=fixture(t,null);f.put('README.md','docs');const head=f.save();const r=f.run(f.event(head));assert.equal(r.status,0,r.stderr);assert.match(r.routing.reasons[0],/bootstrap FULL/);assert.deepEqual(r.routing.selected,{backend:true,frontend:true,mobile:true});
  for(const result of ['success','skipped','failure','cancelled','']) {
    const gate=f.run(f.event(head),'gate',{COMPONENT:'frontend',IMPACT_RESULT:'success',CHECKS_RESULT:result,REPORTED_SELECTION:'true'});assert.equal(gate.status===0,result==='success');
  }
  assert.notEqual(f.run(f.event(head),'gate',{COMPONENT:'frontend',IMPACT_RESULT:'failure',CHECKS_RESULT:'success',REPORTED_SELECTION:'true'}).status,0);
  assert.notEqual(f.run(f.event(head),'gate',{COMPONENT:'frontend',IMPACT_RESULT:'success',CHECKS_RESULT:'success',REPORTED_SELECTION:'false'}).status,0);
});
test('corrupt trusted helper and invalid base fail both routing and completion',t=>{
  const f=fixture(t,'invalid javascript!!!');f.put('README.md','docs');const head=f.save();
  assert.notEqual(f.run(f.event(head)).status,0);
  assert.notEqual(f.run(f.event(head),'gate',{COMPONENT:'backend',IMPACT_RESULT:'success',CHECKS_RESULT:'success',REPORTED_SELECTION:'true'}).status,0);
  assert.notEqual(f.run(f.event(head,'bad base')).status,0);
});

test('executable Markdown and symlink docs cannot authorize exemptions',t=>{
  const f=fixture(t);f.put('docs/run.md','#!/bin/sh\n');chmodSync(join(f.cwd,'docs/run.md'),0o755);const head=f.save();
  const r=compareEvent(f.cwd,'pull_request',f.event(head),head);assert.deepEqual(r.selected,{backend:true,frontend:true,mobile:true});assert.match(r.reasons[0],/Executable/);
  symlinkSync('../README.md',join(f.cwd,'docs/link.md'));const linked=f.save();
  assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(linked,head),linked).selected,{backend:true,frontend:true,mobile:true});
  f.git('rm','backend/src/file.ts');const deleted=f.save();assert.equal(compareEvent(f.cwd,'pull_request',f.event(deleted,head),deleted).selected.backend,true);
});

for (const corrupted of ['', '// truncated helper', 'process.exit(0);']) test(`no-op protected helper refuses routing and completion: ${corrupted}`,t=>{
  const f=fixture(t,corrupted);f.put('README.md','docs');const head=f.save();
  assert.notEqual(f.run(f.event(head)).status,0);
  assert.notEqual(f.run(f.event(head),'gate',{COMPONENT:'backend',IMPACT_RESULT:'success',CHECKS_RESULT:'skipped',REPORTED_SELECTION:'false'}).status,0);
});

for (const path of ['backend/deploy/cloudrun/excluded-keys.txt', 'README.md', 'registry/authorization.txt']) {
  test(`real added/deleted operational text and docs rename endpoints: ${path}`, t => {
    const f = fixture(t);
    const expected = path === 'README.md' ? {backend:true,frontend:false,mobile:false}
      : path.startsWith('backend/') ? {backend:true,frontend:true,mobile:false}
      : {backend:true,frontend:true,mobile:true};
    // README already exists; other operational text paths exercise addition.
    f.put(path, 'operational input\n'); const added = f.save();
    assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(added),added).selected, expected);
    f.put('docs/nested/help.md', 'ordinary documentation\n'); const docs = f.save();
    assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(docs,added),docs).selected, {backend:false,frontend:false,mobile:false});
    f.git('mv',path,'docs/moved.md'); const renamed = f.save();
    let r = compareEvent(f.cwd,'pull_request',f.event(renamed,docs),renamed);
    assert.deepEqual(r.paths, [path,'docs/moved.md'].sort());
    assert.deepEqual(r.selected, expected);
    f.git('mv','docs/moved.md',path); const restored = f.save();
    r = compareEvent(f.cwd,'pull_request',f.event(restored,renamed),restored);
    assert.deepEqual(r.paths, [path,'docs/moved.md'].sort());
    assert.deepEqual(r.selected, expected);
    f.git('rm',path); const deleted = f.save();
    assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(deleted,restored),deleted).selected, expected);
    f.git('rm','docs/nested/help.md'); const removedDocs = f.save();
    assert.deepEqual(compareEvent(f.cwd,'pull_request',f.event(removedDocs,deleted),removedDocs).selected, {backend:false,frontend:false,mobile:false});
  });
}

for (const [path, expected] of [
  ['frontend/src/app/api/ai/chat/stream/route.ts', {backend:true,frontend:true,mobile:false}],
  ['mobile/src/app/api/ai/chat/stream/route.ts', {backend:true,frontend:false,mobile:true}],
]) test(`real legacy chat stream sentinel deletion selects backend and owner: ${path}`, t => {
  const f = fixture(t);
  f.put(path, 'legacy stream sentinel\n'); const base = f.save();
  f.git('rm', path); const head = f.save();
  const r = compareEvent(f.cwd, 'pull_request', f.event(head, base), head);
  assert.deepEqual(r.paths, [path]);
  assert.deepEqual(r.selected, expected);
  assert.equal(r.qa.status, 'interaction-visual-responsive-required');
  // Exercise the protected-base loader as well as direct comparison.
  const loaded = f.run(f.event(head, base));
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.deepEqual(loaded.routing.selected, expected);
});

for (const path of ['backend/domain/constants/system-template-registry.ts', 'backend/domain/constants/service-end-notice-message.ts']) {
  test(`protected loader routes shared compiler input modifications/deletions: ${path}`, t => {
    const f = fixture(t);
    f.put(path, 'original constant\n'); const base = f.save();
    f.put(path, 'modified constant\n'); const modified = f.save();
    const changed = f.run(f.event(modified, base));
    assert.equal(changed.status, 0, changed.stderr);
    assert.deepEqual(changed.routing.selected, {backend:true,frontend:true,mobile:true});
    assert.equal(changed.routing.qa.status, 'assessment-required');
    f.git('rm', path); const deleted = f.save();
    const removed = f.run(f.event(deleted, modified));
    assert.equal(removed.status, 0, removed.stderr);
    assert.deepEqual(removed.routing.selected, {backend:true,frontend:true,mobile:true});
    assert.equal(removed.routing.qa.status, 'assessment-required');
  });
}
