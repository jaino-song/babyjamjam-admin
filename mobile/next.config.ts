import path from "path";
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

export default nextConfig;
