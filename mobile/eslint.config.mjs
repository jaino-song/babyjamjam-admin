import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import dataComponentPlugin from "@babyjamjam/shared/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/app/**/*.tsx", "src/app/**/*.ts"],
    ignores: ["src/components/ui/**"],
    plugins: {
      "data-component": dataComponentPlugin,
    },
    rules: {
      "data-component/require-data-component": "warn",
    },
  },
]);

export default eslintConfig;
