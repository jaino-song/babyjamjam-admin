export const AUTH_ERROR_CODES = {
    ACCOUNT_REJECTED: "ACCOUNT_REJECTED",
    INVALID_OAUTH_STATE: "INVALID_OAUTH_STATE",
    NO_ACCESSIBLE_BRANCH: "NO_ACCESSIBLE_BRANCH",
    OAUTH_CANCELLED: "OAUTH_CANCELLED",
    OAUTH_PROVIDER_ERROR: "OAUTH_PROVIDER_ERROR",
    PENDING_APPROVAL: "PENDING_APPROVAL",
} as const;

export type AuthErrorCode = typeof AUTH_ERROR_CODES[keyof typeof AUTH_ERROR_CODES];

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
    ACCOUNT_REJECTED: "가입이 거부되었습니다.",
    INVALID_OAUTH_STATE: "로그인 요청이 만료되었거나 올바르지 않습니다.",
    NO_ACCESSIBLE_BRANCH: "접근 가능한 지점이 없습니다. 관리자에게 문의해 주세요.",
    OAUTH_CANCELLED: "카카오 로그인이 취소되었습니다.",
    OAUTH_PROVIDER_ERROR: "카카오 로그인 중 오류가 발생했습니다. 다시 시도해 주세요.",
    PENDING_APPROVAL: "관리자 승인 대기 중입니다.",
};

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
    return typeof value === "string"
        && Object.values(AUTH_ERROR_CODES).includes(value as AuthErrorCode);
}
