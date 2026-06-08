import nextJest from "next/jest.js";

// Date logic (dashboard analytics windows) is KST business-time; default the
// test runtime so suites are deterministic on UTC CI runners and non-KST
// machines. An explicit TZ wins so TZ-independence can be verified locally
// (e.g. `TZ=UTC pnpm exec jest src/lib/dashboard`).
process.env.TZ = process.env.TZ || "Asia/Seoul";

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
