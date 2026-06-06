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

module.exports = createJestConfig(customJestConfig);
