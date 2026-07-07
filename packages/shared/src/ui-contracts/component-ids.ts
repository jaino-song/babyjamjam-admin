const DATA_COMPONENT_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const DATA_COMPONENT_PAGE_PREFIXES = {
    home: "home",
    dashboard: "dashboard",
    clients: "clients",
    "clients-filtered": "clients-filtered",
    employees: "employees",
    contracts: "contracts",
    "contracts-creation": "contracts-creation",
    messages: "messages",
    "messages-templates": "messages-templates",
    "messages-templates-new": "messages-templates-new",
    "messages-template-edit": "messages-template-edit",
    "messages-system-templates": "messages-system-templates",
    "messages-system-template-detail": "messages-system-template-detail",
    settings: "settings",
    "settings-general": "settings-general",
    "settings-voucher-price": "settings-voucher-price",
    admin: "admin",
    "admin-feedback-detail": "admin-feedback-detail",
    "auth-register": "auth-register",
    "auth-forgot-password": "auth-forgot-password",
    "auth-reset-password": "auth-reset-password",
    "auth-verify-email": "auth-verify-email",
    "auth-callback": "auth-callback",
    chat: "chat",
    files: "files",
    "select-org": "select-org",
    login: "login",
    logout: "logout",
    test: "test",
} as const;

export type DataComponentPagePrefix =
    (typeof DATA_COMPONENT_PAGE_PREFIXES)[keyof typeof DATA_COMPONENT_PAGE_PREFIXES];

export function makeDataComponentId(page: DataComponentPagePrefix, ...parts: string[]): string {
    return [page, ...parts].join("-");
}

export function isValidDataComponentId(id: string): boolean {
    return DATA_COMPONENT_ID_PATTERN.test(id);
}
