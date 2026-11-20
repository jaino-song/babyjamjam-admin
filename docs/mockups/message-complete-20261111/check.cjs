const fs = require('node:fs');
const path = require('node:path');
const { installed, root } = require('./installed.cjs');
const ts = installed('typescript');
const dir = __dirname;
const mobile = path.join(root, 'mobile');
async function check() {
  const config = ts.readConfigFile(path.join(mobile, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, mobile);
  const files = fs.readdirSync(dir).filter(file => /\.tsx?$/.test(file)).map(file => path.join(dir, file));
  const paths = {
    ...parsed.options.paths,
    react: [path.join(mobile, 'node_modules/@types/react/index.d.ts')],
    'react/*': [path.join(mobile, 'node_modules/@types/react/*')],
    'react-dom/*': [path.join(mobile, 'node_modules/@types/react-dom/*')],
    'lucide-react': [path.join(mobile, 'node_modules/lucide-react')],
    'next/navigation': [path.join(dir, 'navigation.ts')],
    'next/link': [path.join(dir, 'link.tsx')],
    '@/providers/UserProvider': [path.join(dir, 'identity.ts')],
    '@/components/app/notifications/NotificationBell': [path.join(dir, 'notification.tsx')],
  };
  const program = ts.createProgram(files, {
    ...parsed.options, incremental: false, noEmit: true, noUnusedLocals: true, noUnusedParameters: true, paths,
    typeRoots: [path.join(mobile, 'node_modules/@types')],
    types: ['react', 'react-dom', 'node'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
    process.exitCode = 1;
  } else process.stdout.write(`Scoped strict TypeScript: ${files.length} preview files + imported component types passed\n`);

  const { ESLint } = installed('eslint');
  // The filtered workspace install does not include the TypeScript ESLint
  // parser. TypeScript checks types/unused symbols; ESLint checks SWC output.
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{ rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-debugger': 'error', 'no-unreachable': 'error', 'no-constant-condition': 'error',
      'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'valid-typeof': 'error',
    } }],
  });
  const results = [];
  for (const file of files.filter(file => !file.endsWith('.d.ts'))) {
    const code = installed('@swc/core').transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file,
      jsc: { parser: { syntax: 'typescript', tsx: file.endsWith('.tsx') },
        target: 'es2020', transform: { react: { runtime: 'automatic' } } },
      module: { type: 'es6' },
    }).code;
    results.push(...await eslint.lintText(code, { filePath: `${file}.js` }));
  }
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) process.stdout.write(output);
  if (results.some(result => result.errorCount || result.warningCount)) process.exitCode = 1;
  else process.stdout.write('Scoped ESLint runtime checks on SWC-transpiled preview source passed\n');
}
check().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
