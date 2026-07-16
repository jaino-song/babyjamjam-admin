/** @type {import('jest').Config} */

// Date/business-day logic is KST-aware; pin the test runtime TZ so suites
// are deterministic on UTC CI runners and non-KST machines (mirrors
// frontend/jest.config.js and mobile/jest.config.mjs).
process.env.TZ = "Asia/Seoul";

module.exports = {
    rootDir: "./",
    testEnvironment: "node",
    transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
    },
    testMatch: ["<rootDir>/src/**/*.test.ts"],
    testPathIgnorePatterns: ["/node_modules/"],
};
