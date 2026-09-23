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
    "^@babyjamjam/service-record-ui$": "<rootDir>/../packages/service-record-ui/src/index.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/", "<rootDir>/tests/"],
};

export default async () => {
  const config = await createJestConfig(customJestConfig)();
  // react-markdown@10 (and its remark/unified/hast/mdast toolchain) ships
  // ESM-only. next/jest's default transformIgnorePatterns blocks all of
  // node_modules, which breaks any suite that renders it unmocked (e.g.
  // AgentMobileShell.test.tsx renders the real MobileAgentPartRegistry).
  config.transformIgnorePatterns = [
    "/node_modules/\\.pnpm/(?!(react-markdown|remark-|mdast-|micromark|unist-|hast-|vfile|unified|bail|is-plain-obj|trough|devlop|decode-named|character-|property-information|space-separated|comma-separated|html-url-attributes|estree-util|ccount|escape-string-regexp|markdown-table|longest-streak|zwitch|trim-lines|stringify-entities|@ungap))",
  ];
  return config;
};
