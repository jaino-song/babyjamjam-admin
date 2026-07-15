export const ROLES = {
    owner: "owner",
    admin: "admin",
    manager: "manager",
    user: "user",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<Role, string> = {
    owner: "오너",
    admin: "지점장",
    manager: "매니저",
    user: "직원",
};

export const REGISTERABLE_ROLES = [
    ROLES.admin,
    ROLES.manager,
    ROLES.user,
] as const;

export const REGISTERABLE_ROLE_OPTIONS = REGISTERABLE_ROLES.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
}));

export function getRoleLabel(role: string): string {
    return ROLE_LABELS[role as Role] ?? ROLE_LABELS.user;
}
