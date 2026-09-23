/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest');

// Date logic is KST business-time; pin the test runtime so suites are
// deterministic on UTC CI runners and non-KST machines (mirrors mobile).
process.env.TZ = 'Asia/Seoul';

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  maxWorkers: process.env.CI ? '50%' : 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/', '<rootDir>/tests/'],
};

// react-markdown@10 (and its remark/unist/etc. dependency chain) ships
// ESM-only. next/jest's default transformIgnorePatterns excludes all of
// node_modules from transformation, so importing react-markdown unmocked
// breaks with `SyntaxError: Unexpected token 'export'`. next/jest resolves
// its own ignore pattern internally and applying a custom
// transformIgnorePatterns on customJestConfig gets clobbered by that
// resolution, so we override it on the config next/jest already produced.
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  config.transformIgnorePatterns = [
    "/node_modules/\\.pnpm/(?!(react-markdown|remark-|mdast-|micromark|unist-|hast-|vfile|unified|bail|is-plain-obj|trough|devlop|decode-named|character-|property-information|space-separated|comma-separated|html-url-attributes|estree-util|ccount|escape-string-regexp|markdown-table|longest-streak|zwitch|trim-lines|stringify-entities|@ungap))",
  ];
  return config;
};
