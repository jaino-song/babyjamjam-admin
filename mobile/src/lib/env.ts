import { z } from "zod";

const LOCAL_BACKEND_BASE_URL = "http://localhost:3001";
const NODE_ENV_VALUES = ["development", "production", "test"] as const;
const VERCEL_ENV_VALUES = ["development", "preview", "production"] as const;

const trimmedOptionalEnum = <TValues extends readonly [string, ...string[]]>(values: TValues) => (
    z.preprocess((value) => {
        if (typeof value !== "string") {
            return value;
        }

        const trimmed = value.trim();
        return trimmed || undefined;
    }, z.enum(values).optional())
);

const optionalTrimmedString = z.string().optional().transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
});

const clientEnvSchema = z.object({
    NODE_ENV: trimmedOptionalEnum(NODE_ENV_VALUES).default("development"),
    NEXT_PUBLIC_API_BASE_URL: optionalTrimmedString,
    NEXT_PUBLIC_APP_VERSION: optionalTrimmedString,
    NEXT_PUBLIC_E2E_TEST: optionalTrimmedString,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: optionalTrimmedString,
});

const serverEnvSchema = clientEnvSchema.extend({
    DEVELOPMENT_API_BASE_URL: optionalTrimmedString,
    E2E_TEST: optionalTrimmedString,
    VERCEL_ENV: trimmedOptionalEnum(VERCEL_ENV_VALUES),
});

export type ClientEnv = z.output<typeof clientEnvSchema>;
export type ServerEnv = z.output<typeof serverEnvSchema>;
export type BackendUrlEnv = Pick<
    ServerEnv,
    "NODE_ENV" | "VERCEL_ENV" | "NEXT_PUBLIC_API_BASE_URL" | "DEVELOPMENT_API_BASE_URL"
>;

export interface ServerRuntimeConfig {
    backendBaseUrl: string;
    env: ServerEnv;
    isPreviewVercelEnv: boolean;
    isProductionLike: boolean;
    isProductionNodeEnv: boolean;
    isSecureCookieEnv: boolean;
}

export class EnvValidationError extends Error {
    readonly issues: string[];

    constructor(issues: string[]) {
        super(
            `Invalid environment configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
        );
        this.name = "EnvValidationError";
        this.issues = issues;
    }
}

function formatZodIssues(error: z.ZodError): string[] {
    return error.issues.map((issue) => {
        const key = issue.path.join(".") || "environment";
        return `${key}: ${issue.message}`;
    });
}

function parseEnv<T extends z.ZodTypeAny>(schema: T, values: z.input<T>): z.output<T> {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
        throw new EnvValidationError(formatZodIssues(parsed.error));
    }

    return parsed.data;
}

function normalizeBackendBaseUrl(key: string, value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new EnvValidationError([`${key} must use http:// or https://`]);
        }

        return url.toString().replace(/\/$/, "");
    } catch (error) {
        if (error instanceof EnvValidationError) {
            throw error;
        }

        throw new EnvValidationError([`${key} must be a valid URL`]);
    }
}

function requireBackendBaseUrl(
    key: string,
    value: string | undefined,
    requirement: string,
): string {
    if (!value) {
        throw new EnvValidationError([`${key} is required ${requirement}`]);
    }

    return normalizeBackendBaseUrl(key, value);
}

function resolveOptionalBackendBaseUrl(key: string, value: string | undefined): string | null {
    if (!value) {
        return null;
    }

    return normalizeBackendBaseUrl(key, value);
}

function isProductionLike(env: Pick<ServerEnv, "NODE_ENV" | "VERCEL_ENV">): boolean {
    return env.NODE_ENV === "production" || env.VERCEL_ENV === "preview";
}

export function resolveClientBackendBaseUrl(env: ClientEnv = clientEnv): string {
    if (env.NODE_ENV === "production") {
        return requireBackendBaseUrl(
            "NEXT_PUBLIC_API_BASE_URL",
            env.NEXT_PUBLIC_API_BASE_URL,
            "when NODE_ENV=production",
        );
    }

    return resolveOptionalBackendBaseUrl("NEXT_PUBLIC_API_BASE_URL", env.NEXT_PUBLIC_API_BASE_URL)
        ?? LOCAL_BACKEND_BASE_URL;
}

export function resolveServerBackendBaseUrl(env: BackendUrlEnv): string {
    if (isProductionLike(env)) {
        return requireBackendBaseUrl(
            "NEXT_PUBLIC_API_BASE_URL",
            env.NEXT_PUBLIC_API_BASE_URL,
            "when NODE_ENV=production or VERCEL_ENV=preview",
        );
    }

    if (env.DEVELOPMENT_API_BASE_URL) {
        return normalizeBackendBaseUrl("DEVELOPMENT_API_BASE_URL", env.DEVELOPMENT_API_BASE_URL);
    }

    if (env.NEXT_PUBLIC_API_BASE_URL) {
        return normalizeBackendBaseUrl("NEXT_PUBLIC_API_BASE_URL", env.NEXT_PUBLIC_API_BASE_URL);
    }

    return LOCAL_BACKEND_BASE_URL;
}

function createServerRuntimeConfig(env: ServerEnv): ServerRuntimeConfig {
    const isProductionNodeEnv = env.NODE_ENV === "production";
    const isPreviewVercelEnv = env.VERCEL_ENV === "preview";

    return {
        backendBaseUrl: resolveServerBackendBaseUrl(env),
        env,
        isPreviewVercelEnv,
        isProductionLike: isProductionLike(env),
        isProductionNodeEnv,
        isSecureCookieEnv: isProductionNodeEnv || isPreviewVercelEnv,
    };
}

export const clientEnv = parseEnv(clientEnvSchema, {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PUBLIC_E2E_TEST: process.env.NEXT_PUBLIC_E2E_TEST,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
});

const serverRuntimeConfig = typeof window === "undefined"
    ? createServerRuntimeConfig(parseEnv(serverEnvSchema, {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL_ENV: process.env.VERCEL_ENV,
        NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
        DEVELOPMENT_API_BASE_URL: process.env.DEVELOPMENT_API_BASE_URL,
        NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
        NEXT_PUBLIC_E2E_TEST: process.env.NEXT_PUBLIC_E2E_TEST,
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
        E2E_TEST: process.env.E2E_TEST,
    }))
    : null;

export const APP_VERSION = clientEnv.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const IS_DEVELOPMENT = clientEnv.NODE_ENV === "development";
export const IS_DEV_DEPLOYMENT = IS_DEVELOPMENT
    || clientEnv.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF === "dev";
export const IS_E2E_TEST = clientEnv.NEXT_PUBLIC_E2E_TEST === "true"
    || (typeof window === "undefined" && serverRuntimeConfig?.env.E2E_TEST === "true");
export const PUBLIC_BACKEND_BASE_URL = resolveClientBackendBaseUrl();

export function getServerRuntimeConfig(): ServerRuntimeConfig {
    if (!serverRuntimeConfig) {
        throw new Error("Server runtime config is not available in the browser");
    }

    return serverRuntimeConfig;
}
