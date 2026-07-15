const LOCAL_NODE_ENVS = new Set(["development", "test"]);

function normalizeRuntimeEnv(value: string | undefined): string | undefined {
    const trimmed = value?.trim().toLowerCase();
    return trimmed ? trimmed : undefined;
}

export function isProductionLikeEnvironment(): boolean {
    const nodeEnv = normalizeRuntimeEnv(process.env["NODE_ENV"]);
    const vercelEnv = normalizeRuntimeEnv(process.env["VERCEL_ENV"]);

    if (vercelEnv && vercelEnv !== "development") {
        return true;
    }

    if (!nodeEnv) {
        return false;
    }

    return !LOCAL_NODE_ENVS.has(nodeEnv);
}

export function isDevelopmentJwtSecretAllowed(): boolean {
    const nodeEnv = normalizeRuntimeEnv(process.env["NODE_ENV"]);
    return nodeEnv === "test" || process.env["ALLOW_DEV_JWT_SECRET"]?.trim() === "1";
}
