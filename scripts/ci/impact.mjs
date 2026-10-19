// Protected-base authority. Keep this file self-contained and dependency-free:
// callers extract exactly this blob to an isolated runner-temp directory.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const apps = ['backend', 'frontend', 'mobile'];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
export function commit(cwd, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || /^0+$/.test(sha)) throw new Error('Invalid commit identity');
  if (git(cwd, 'rev-parse', '--verify', `${sha}^{commit}`).trim() !== sha) throw new Error('Unresolved exact commit');
  return sha;
}
export function classifyPaths(paths, fullReason = null) {
  const categories = Object.fromEntries([...apps, 'shared', 'native', 'infra', 'docs', 'dependencies', 'config', 'uncertain'].map(key => [key, false]));
  const selected = Object.fromEntries(apps.map(key => [key, false]));
  const reasons = [];
  let uncertain = Boolean(fullReason), ui = false;
  categories.uncertain = uncertain;
  for (const path of paths) {
    // Policy and executable/configuration changes are never documentation exemptions.
    if (/^(?:\.agents\/|\.codex\/|\.github\/|scripts\/)|(?:^|\/)(?:policies|rules)\/|(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$|(?:^|\/)(?:package\.json|[^/]*lock[^/]*|[^/]*config[^/]*|[^/]*\.ya?ml|Dockerfile[^/]*|\.[^/]*rc|[^/]*\.gradle(?:\.kts)?|gradle\.properties|requirements[^/]*\.txt|Cargo\.toml|Gemfile)$/.test(path)) {
      uncertain = true; categories.infra = true; categories.config = true;
      if (/(?:package\.json|lock|pnpm-workspace|\.gradle|requirements|Cargo\.toml|Gemfile)/.test(path)) categories.dependencies = true;
      reasons.push(`Policy/config/tooling: ${path}`); continue;
    }
    if (/\.(?:md|txt|rst)$/.test(path)) { categories.docs = true; continue; }
    if (path.startsWith('packages/shared/')) {
      categories.shared = true; apps.forEach(app => { selected[app] = true; });
      reasons.push('Shared package reaches all apps, including backend vendored runtime');
    } else if (path.startsWith('packages/service-record-ui/')) {
      selected.frontend = selected.mobile = true; categories.shared = true; ui = true;
      reasons.push('Service-record UI reaches frontend and mobile');
    } else if (apps.some(app => path.startsWith(`${app}/`))) {
      const app = path.split('/')[0]; categories[app] = selected[app] = true;
      if (app !== 'backend') ui = true;
      reasons.push(`${app} change requires its complete existing checks`);
    } else {
      uncertain = true; categories.uncertain = true;
      if (path.startsWith('native/')) categories.native = true;
      categories.infra = true; reasons.push(`Uncertain impact: ${path}`);
    }
  }
  if (uncertain) apps.forEach(app => { selected[app] = true; });
  if (fullReason) reasons.unshift(fullReason);
  if (!paths.length && !fullReason) reasons.push('Empty comparison: no changed paths');
  for (const app of apps) categories[app] ||= selected[app];
  const active = apps.some(app => selected[app]);
  const status = ui ? 'interaction-visual-responsive-required' : active ? 'assessment-required' : 'not-applicable';
  return { schemaVersion: 1, paths, categories, selected, reasons: [...new Set(reasons)], qa: {
    status, reasons: [ui ? 'UI consumers require interaction, visual and responsive QA' : active
      ? 'Paths cannot prove user-flow semantics; Main must assess browser impact, including backend maintenance'
      : paths.length ? 'Only non-executable documentation changed' : 'No changed paths'],
  } };
}
export function compareEvent(cwd, eventName, event, candidateSha) {
  if (!['pull_request', 'merge_group'].includes(eventName)) {
    return { ...classifyPaths([], `${eventName}: full checks; no exemptions`),
      candidate: { event: eventName, sha: commit(cwd, candidateSha), base: null, head: candidateSha, mergeBase: null },
      comparison: { kind: 'full', reason: 'Push/manual/unknown events cannot authorize skips' } };
  }
  const base = commit(cwd, eventName === 'pull_request' ? event.pull_request?.base?.sha : event.merge_group?.base_sha);
  const head = commit(cwd, eventName === 'pull_request' ? event.pull_request?.head?.sha : event.merge_group?.head_sha);
  const mergeBase = commit(cwd, git(cwd, 'merge-base', base, head).trim());
  const tokens = git(cwd, 'diff', '--name-status', '-z', '--find-renames', mergeBase, head, '--').split('\0');
  const paths = [];
  for (let i = 0; i < tokens.length && tokens[i];) {
    const status = tokens[i++];
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count; n++) {
      if (!tokens[i]) throw new Error('Malformed git path result');
      paths.push(tokens[i++]);
    }
  }
  const unique = [...new Set(paths)].sort();
  const special = [mergeBase, head].flatMap(ref => git(cwd, 'ls-tree', '-r', '-z', ref).split('\0'))
    .filter(entry => entry && !entry.startsWith('100644 ') && unique.includes(entry.slice(entry.indexOf('\t') + 1)));
  return { ...classifyPaths(unique, special.length ? 'Executable/symlink/submodule change requires full checks' : null),
    candidate: { event: eventName, sha: commit(cwd, candidateSha), base, head, mergeBase },
    comparison: { kind: 'merge-base', reason: 'Actual event base/head, including both rename paths' } };
}
export function complete(routing, component, impactResult, checksResult, reportedSelection) {
  if (!apps.includes(component) || routing?.schemaVersion !== 1 || typeof routing?.selected?.[component] !== 'boolean') throw new Error('Invalid routing');
  if (impactResult !== 'success' || reportedSelection !== String(routing.selected[component])) throw new Error('Missing/failed/inconsistent impact');
  if (routing.selected[component] ? checksResult !== 'success' : !['success', 'skipped'].includes(checksResult)) throw new Error('Checks did not complete as selected');
  return true;
}
export function run(env = process.env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const routing = compareEvent(process.cwd(), env.GITHUB_EVENT_NAME, event, env.GITHUB_SHA);
  if (env.IMPACT_MODE === 'gate') {
    complete(routing, env.COMPONENT, env.IMPACT_RESULT, env.CHECKS_RESULT, env.REPORTED_SELECTION);
    writeFileSync(env.IMPACT_COMPLETION_PROOF, 'protected-complete\n');
    return;
  }
  writeFileSync(env.IMPACT_ARTIFACT, JSON.stringify(routing, null, 2) + '\n');
  for (const app of apps) appendFileSync(env.GITHUB_OUTPUT, `${app}=${routing.selected[app]}\n`);
  appendFileSync(env.GITHUB_STEP_SUMMARY, `## CI impact\n\n\`\`\`json\n${JSON.stringify(routing, null, 2)}\n\`\`\`\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
