export const RESET_PASSWORD_ERROR_MESSAGES = {
  AUTH_RESET_TOKEN_INVALID: "유효하지 않은 비밀번호 재설정 링크입니다.",
  AUTH_RESET_TOKEN_EXPIRED: "비밀번호 재설정 링크가 만료되었습니다. 새 링크를 요청해 주세요.",
  AUTH_RESET_TOKEN_USED: "이미 사용된 비밀번호 재설정 링크입니다. 새 링크를 요청해 주세요.",
  AUTH_RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
} as const;

export type ResetPasswordErrorCode = keyof typeof RESET_PASSWORD_ERROR_MESSAGES;

export function getResetPasswordErrorMessage(code: unknown): string | null {
  if (typeof code !== "string" || !(code in RESET_PASSWORD_ERROR_MESSAGES)) {
    return null;
  }

  return RESET_PASSWORD_ERROR_MESSAGES[code as ResetPasswordErrorCode];
}
