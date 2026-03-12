import path from "path";
import type { NextConfig } from "next";

function readPositiveInt(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const localBuildCpus = readPositiveInt(process.env.NEXT_BUILD_CPUS) ?? (process.env.CI ? undefined : 2);
const localStaticGenerationMaxConcurrency =
    readPositiveInt(process.env.NEXT_STATIC_GENERATION_MAX_CONCURRENCY) ?? (process.env.CI ? undefined : 1);

const nextConfig: NextConfig = {
    turbopack: {
        root: path.resolve(__dirname, ".."),
    },
    experimental: {
        ...(localBuildCpus ? { cpus: localBuildCpus } : {}),
        ...(localStaticGenerationMaxConcurrency
            ? { staticGenerationMaxConcurrency: localStaticGenerationMaxConcurrency }
            : {}),
    },
};

export default nextConfig;
