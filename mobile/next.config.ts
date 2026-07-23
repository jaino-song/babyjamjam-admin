import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
    env: {
        NEXT_PUBLIC_APP_VERSION: packageJson.version,
    },
    // Workspace package ships TS source; Next transpiles it in-app.
    transpilePackages: ["@babyjamjam/shared"],
    turbopack: {
        root: path.resolve(__dirname, ".."),
    },
};

const hasSentryBuildCredentials = Boolean(
    process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI || !hasSentryBuildCredentials,
    widenClientFileUpload: true,
    sourcemaps: {
        deleteSourcemapsAfterUpload: true,
    },
    tunnelRoute: "/monitoring",
    telemetry: false,
});
