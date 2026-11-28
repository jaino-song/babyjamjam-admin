import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const full = { mode: 'full', files: [], realDatabase: true };
const lockfiles = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb', 'deno.lock',
  'cargo.lock', 'composer.lock', 'gemfile.lock', 'gradle.lockfile', 'podfile.lock', 'package.resolved', 'go.sum',
  'pipfile.lock', 'poetry.lock', 'uv.lock', 'flake.lock', 'pubspec.lock', 'mix.lock', 'packages.lock.json',
]);
const backendConfig = /^backend\/(?:package\.json|jest[^/]*\.config\.[^/]+|tsconfig[^/]*\.json|prisma\/schema\.prisma)$/;
const fullDirectory = /^(?:backend\/prisma\/migrations|packages\/shared|\.github|scripts\/ci)\//;
const jestSetup = /(?:^|\/)(?:(?:jest|test)[.-]setup|setup[.-]?(?:jest|tests))\.[^/]+$/i;
const databasePath = /^backend\/(?:prisma|test\/(?:prisma|integrity)|infrastructure\/database)\//;
const persistencePath = /(?:^|[/.\-])(?:repositor(?:y|ies)|persistence)(?:[/.\-]|$)/i;
const sourceFile = /\.(?:ts|js|json)$/; // backend/jest.config.ts moduleFileExtensions
const otherApp = /^(?:frontend|mobile|packages\/service-record-ui)\//;
const externalDocs = /^docs\/.+\.(?:md|txt|rst)$/;
// impact.mjs checks these policy and configuration paths before exempting docs.
const docsPolicy = /\/(?:policies|rules)\/|\/(?:AGENTS|CLAUDE|SKILL)\.md$|\/[^/]*(?:lock|config)[^/]*$|\/(?:Dockerfile[^/]*|requirements[^/]*\.txt)$/;
const unsafePath = /[\r\n\uFFFD]/;
const git = (cwd, args, input) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  input,
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'],
});

function specsReadingSources(cwd, head, files) {
  if (!files.length) return [];
  // Directory scans can cover newly added files without naming them.
  const patterns = new Set([...files, 'readdirSync', 'readdir(', 'globSync', 'glob(', 'opendirSync']);
  for (const path of files) {
    const name = basename(path, extname(path));
    patterns.add(name.length >= 6 ? name : `${basename(dirname(path))}/${name}`);
  }

  try {
    // Scan regular spec blobs from the exact PR head in one fixed-string search.
    const matches = git(cwd, ['grep', '-a', '-l', '-z', '-F', '--no-textconv', '-f', '-', head, '--', ':(top,glob)backend/**/*.spec.ts'],
      [...patterns].join('\n'));
    return matches.split('\0').slice(0, -1).map(match => match.slice(head.length + 1));
  } catch (error) {
    if (error.status === 1 && !error.stderr) return []; // git grep found no matches
    throw error;
  }
}

/** Classify the changes from an exact PR merge base to an exact PR head. */
export function backendTestScope(mergeBase, head, cwd = process.cwd()) {
  try {
    for (const sha of [mergeBase, head]) {
      if (!/^[0-9a-f]{40}$/.test(sha ?? '') || git(cwd, ['rev-parse', '--verify', `${sha}^{commit}`]).trim() !== sha) return full;
    }

    // A rename appears as a deletion and an addition. NUL delimiters preserve
    // whitespace and prevent path text from being mistaken for a status.
    const diff = git(cwd, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', mergeBase, head, '--']);
    const entries = diff.split('\0');
    if (entries.pop() !== '' || entries.length % 2 !== 0) return full;

    const files = [];
    let realDatabase = false;
    for (let index = 0; index < entries.length; index += 2) {
      const [status, path] = [entries[index], entries[index + 1]];
      // Deletions, non-regular files and undecodable paths cannot be passed to Jest safely.
      if (!/^:(?:000000|100644|100755) (?:100644|100755) [0-9a-f]{40} [0-9a-f]{40} [AM]$/.test(status)
        || !path || unsafePath.test(path)) return full;
      if (lockfiles.has(basename(path).toLowerCase()) || backendConfig.test(path) || fullDirectory.test(path)) return full;
      if (!path.startsWith('backend/')) {
        // impact.mjs routes the root README and otherwise unknown inputs to backend.
        if (otherApp.test(path) || (externalDocs.test(path) && !docsPolicy.test(path))) continue;
        return full;
      }
      if (jestSetup.test(path) || (path.startsWith('backend/test/') && !path.endsWith('.spec.ts'))) return full;

      if (databasePath.test(path) || persistencePath.test(path)) realDatabase = true;
      if (path.endsWith('.md')) continue;
      if (!sourceFile.test(path)) return full;
      files.push(path);
    }

    // Jest also selects test-file arguments to --findRelatedTests directly.
    const specs = specsReadingSources(cwd, head, files);
    if (specs.some(path => unsafePath.test(path))) return full;
    const selection = [...new Set([...files, ...specs])];
    // Keep the serialized list below the runner OS's per-environment-entry limit.
    if (Buffer.byteLength(JSON.stringify(selection)) > 64 * 1024) return full;
    return { mode: 'related', files: selection, realDatabase };
  } catch {
    return full;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mergeBase, head, output] = process.argv;
  const scope = backendTestScope(mergeBase, head);
  if (output) {
    appendFileSync(output, `mode=${scope.mode}\nreal-database=${scope.realDatabase}\nfiles=${JSON.stringify(scope.files)}\n`);
  } else if (scope.mode === 'full') {
    console.log('full');
  } else if (scope.files.length) {
    console.log(scope.files.join('\n'));
  }
}
