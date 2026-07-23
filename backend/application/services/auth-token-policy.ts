export const AUTH_TOKEN_EXPIRES_IN_BY_ROLE = {
    owner: "30d",
    admin: "7d",
    manager: "7d",
    default: "3d",
} as const;

export const ACCESS_TOKEN_EXPIRES_IN = "15m";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const AUTH_TOKEN_MAX_AGE_MS_BY_ROLE = {
    owner: 30 * DAY_IN_MS,
    admin: 7 * DAY_IN_MS,
    manager: 7 * DAY_IN_MS,
    default: 3 * DAY_IN_MS,
} as const;

export function getAuthTokenExpiresIn(role: string | null | undefined): string {
    if (role === "owner") {
        return AUTH_TOKEN_EXPIRES_IN_BY_ROLE.owner;
    }

    if (role === "admin" || role === "manager") {
        return AUTH_TOKEN_EXPIRES_IN_BY_ROLE.admin;
    }

    return AUTH_TOKEN_EXPIRES_IN_BY_ROLE.default;
}

export function getAuthTokenMaxAgeMs(role: string | null | undefined): number {
    if (role === "owner") {
        return AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.owner;
    }

    if (role === "admin" || role === "manager") {
        return AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.admin;
    }

    return AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.default;
}
