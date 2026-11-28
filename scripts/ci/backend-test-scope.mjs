import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const full = { mode: 'full', files: [], realDatabase: true };
const lockfile = /(?:^|[.-])lock(?:file|b)?(?:\.[^.]+)?$|^(?:npm-shrinkwrap\.json|go\.sum|Package\.resolved)$/i;
const backendConfig = /^backend\/(?:package\.json|jest[^/]*\.config\.[^/]+|tsconfig[^/]*\.json|prisma\/schema\.prisma)$/;
const fullDirectory = /^(?:backend\/prisma\/migrations|packages\/shared|\.github|scripts\/ci)\//;
const jestSetup = /(?:^|\/)(?:(?:jest|test)[.-]setup|setup[.-]?(?:jest|tests))\.[^/]+$/i;
const databasePath = /^backend\/(?:prisma|test\/(?:prisma|integrity)|infrastructure\/database)\//;
const persistencePath = /(?:^|[/.\-])(?:repositor(?:y|ies)|persistence)(?:[/.\-]|$)/i;
const sourceFile = /\.(?:[cm]?[jt]sx?|json)$/;
const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

/** Classify the changes from an exact PR merge base to an exact PR head. */
export function backendTestScope(mergeBase, head, cwd = process.cwd()) {
  try {
    for (const sha of [mergeBase, head]) {
      if (!/^[0-9a-f]{40}$/.test(sha ?? '') || git(cwd, 'rev-parse', '--verify', `${sha}^{commit}`).trim() !== sha) return full;
    }

    // A rename appears as a deletion and an addition. NUL delimiters preserve
    // whitespace and prevent path text from being mistaken for a status.
    const diff = git(cwd, 'diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', mergeBase, head, '--');
    const entries = diff.split('\0');
    if (entries.pop() !== '' || entries.length % 2 !== 0) return full;

    const files = [];
    let realDatabase = false;
    for (let index = 0; index < entries.length; index += 2) {
      const [status, path] = [entries[index], entries[index + 1]];
      // Deletions, non-regular files and undecodable paths cannot be passed to Jest safely.
      if (!/^:(?:000000|100644|100755) (?:100644|100755) [0-9a-f]{40} [0-9a-f]{40} [AM]$/.test(status)
        || !path || /[\r\n\uFFFD]/.test(path)) return full;
      if (lockfile.test(basename(path)) || backendConfig.test(path) || fullDirectory.test(path)) return full;
      if (!path.startsWith('backend/')) continue;
      if (jestSetup.test(path) || (path.startsWith('backend/test/') && !path.endsWith('.spec.ts'))) return full;

      if (databasePath.test(path) || persistencePath.test(path)) realDatabase = true;
      if (sourceFile.test(path)) files.push(path);
    }

    // Keep the serialized list below the runner OS's per-environment-entry limit.
    if (Buffer.byteLength(JSON.stringify(files)) > 64 * 1024) return full;
    return { mode: 'related', files, realDatabase };
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
