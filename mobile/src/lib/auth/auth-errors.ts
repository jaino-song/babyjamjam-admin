export const AUTH_ERROR_DIALOGS = {
  ACCOUNT_REJECTED: {
    title: "가입이 거부되었습니다.",
    description: "계정 상태에 대한 자세한 내용은 관리자에게 문의해 주세요.",
  },
  ACCOUNT_PROFILE_INCOMPLETE: {
    title: "가입 정보가 누락되었습니다.",
    description: "오너에게 계정 정보 확인을 요청해 주세요.",
  },
  INVALID_OAUTH_STATE: {
    title: "로그인 요청이 만료되었습니다.",
    description: "카카오 로그인을 다시 시도해 주세요.",
  },
  NO_ACCESSIBLE_BRANCH: {
    title: "접근 가능한 지점이 없습니다.",
    description: "지점 접근 권한은 관리자에게 문의해 주세요.",
  },
  OAUTH_CANCELLED: {
    title: "카카오 로그인이 취소되었습니다.",
    description: "로그인이 필요하면 카카오 로그인을 다시 시도해 주세요.",
  },
  OAUTH_PROVIDER_ERROR: {
    title: "카카오 로그인에 실패했습니다.",
    description: "잠시 후 다시 시도해 주세요.",
  },
  PENDING_APPROVAL: {
    title: "관리자 승인 대기 중입니다.",
    description: "관리자의 승인이 완료된 후 로그인할 수 있습니다.",
  },
} as const;

export function getAuthErrorDialog(code: string | null | undefined) {
  if (!code || !(code in AUTH_ERROR_DIALOGS)) return null;
  return AUTH_ERROR_DIALOGS[code as keyof typeof AUTH_ERROR_DIALOGS];
}

export function getSafeCallbackError(value: string | null): string | null {
  if (!value) return null;
  return getAuthErrorDialog(value)?.title ?? "로그인 중 오류가 발생했습니다.";
}
