import nextJest from "next/jest.js";

// Date logic (dashboard analytics windows) is KST business-time; pin the test
// runtime so suites are deterministic on UTC CI runners and non-KST machines.
process.env.TZ = "Asia/Seoul";

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/", "<rootDir>/tests/"],
};

export default createJestConfig(customJestConfig);
