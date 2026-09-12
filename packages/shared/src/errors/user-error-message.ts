import { normalizeApiError } from "./problem-details";
import { KOREAN_ERROR_MESSAGES } from './korean-error-messages';
import { getSafeApiDisplayMessage, sanitizeApiDisplayMessage } from './safe-api-error-message';

export const UNKNOWN_ERROR_MESSAGE = '요청을 처리하지 못했어요. 정확한 원인은 확인되지 않았어요.';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  phone: '연락처', email: '이메일', name: '이름', address: '주소', birthday: '생년월일',
  startDate: '시작일', endDate: '종료일', serviceDate: '서비스 날짜',
  start_date: '시작일', end_date: '종료일', service_date: '서비스 날짜',
  clientId: '고객', client_id: '고객', employeeId: '직원', employee_id: '직원',
  branchId: '지점', branch_id: '지점', document_id: '문서', work_area: '근무 지역',
  password: '비밀번호', title: '제목', content: '내용', amount: '금액',
  limit: '조회 개수', offset: '목록 시작 위치', page: '페이지', duration: '서비스 기간',
  year_type_duration: '연도·유형·기간', endpoint: '알림 주소', kakao_id: '카카오 계정',
};

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: '입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.',
  401: '로그인 인증을 확인할 수 없어요. 다시 로그인해 주세요.',
  403: '이 작업을 할 권한이 없어요.',
  404: '요청한 정보를 찾을 수 없어요.',
  405: '이 작업은 지원하지 않는 요청 방식이에요.',
  408: '요청 시간이 초과됐어요.',
  409: '현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.',
  410: '요청한 정보의 이용 기간이 끝났어요.',
  413: '전송할 파일이나 입력 정보의 크기가 너무 커요.',
  415: '지원하지 않는 파일이나 입력 형식이에요.',
  422: '입력 정보가 처리 조건에 맞지 않아요.',
  429: '요청 횟수 제한을 초과했어요. 잠시 후 다시 시도해 주세요.',
  500: '서버 내부 오류로 요청을 처리하지 못했어요.',
  502: '연결된 서버에서 정상적인 응답을 받지 못했어요.',
  503: '서버가 현재 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.',
  504: '연결된 서버의 응답을 기다리다 시간이 초과됐어요.',
};

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  P2002: '같은 정보가 이미 등록돼 있어요.',
  P2003: '연결할 정보가 없거나 다른 기록에서 사용 중이라 처리할 수 없어요.',
  P2025: '처리할 기록을 찾을 수 없어요.',
  P2011: '필수 입력 항목이 빠져 있어요.',
  P2006: '입력값의 형식이 올바르지 않아요.',
  P1001: '데이터 저장소에 연결하지 못했어요.',
  P1017: '데이터 저장소와의 연결이 끊어졌어요.',
  P2024: '데이터 연결을 기다리다 시간이 초과됐어요.',
  ERR_NETWORK: KOREAN_ERROR_MESSAGES['Network Error'],
  ECONNABORTED: '서버의 응답을 기다리다 시간이 초과됐어요.',
  ETIMEDOUT: '서버의 응답을 기다리다 시간이 초과됐어요.',
  ERR_CANCELED: '요청이 취소됐어요.',
  EMAIL_EXISTS: '이미 등록된 이메일이에요.',
  AUTH_REQUIRED: '로그인이 필요해요. 다시 로그인해 주세요.',
};

/** 오류 안내의 종결어미만 바꾸며 원인이나 처리 결과를 추측하지 않아요. */
export function toKoreanErrorCopy(message: string): string | null {
  const missing = /^Invalid input: expected \w+, received (?:undefined|null)$/.test(message);
  if (missing) return '필수 입력 항목이 빠져 있어요.';
  const size = /^Too (small|big): expected string to have (?:>=|<=)(\d+) characters$/.exec(message);
  if (size) return `${size[2]}자 ${size[1] === 'small' ? '이상' : '이하'}으로 입력해 주세요.`;
  if (/^Invalid email (?:address)?$/i.test(message)) return '이메일 주소 형식이 올바르지 않아요.';
  const password = /^Password must contain at least (\d+) characters\.$/.exec(message);
  if (password) return `비밀번호는 ${password[1]}자 이상으로 입력해 주세요.`;
  const known = (Object.hasOwn(KOREAN_ERROR_MESSAGES, message.trim()) ? KOREAN_ERROR_MESSAGES[message.trim()] : undefined);
  if (known) return known;
  if (!/[가-힣]/.test(message)) return null;
  return sanitizeApiDisplayMessage(message)
    .replace(/하십시오/g, '해 주세요')
    .replace(/해주세요/g, '해 주세요')
    .replace(/되었습니다/g, '됐어요')
    .replace(/하였습니다/g, '했어요')
    .replace(/했습니다/g, '했어요')
    .replace(/하겠습니다/g, '할게요')
    .replace(/합니다/g, '해요')
    .replace(/됩니다/g, '돼요')
    .replace(/([가-힣])입니다/g, (_, last: string) => `${last}${(last.charCodeAt(0) - 0xac00) % 28 === 0 ? '예요' : '이에요'}`)
    .replace(/없습니다/g, '없어요')
    .replace(/있습니다/g, '있어요')
    .replace(/않습니다/g, '않아요')
    .replace(/바랍니다/g, '주세요');
}

function translateValidationMessage(message: string): string | null {
  const duration = /^duration must equal the Korean business-day count \((\d+)\) for the submitted service period$/.exec(message);
  if (duration) return `서비스 기간의 실제 이용일 수는 ${duration[1]}일이에요. 입력한 이용일 수를 확인해 주세요.`;
  const match = /^([a-zA-Z][\w.]*) (.+)$/.exec(message);
  if (!match) return null;
  const field = Object.hasOwn(FIELD_LABELS, match[1]) ? FIELD_LABELS[match[1]] : '입력 항목';
  const rule = match[2];
  if (rule === 'must be a valid Korean phone number') return `${field} 항목에 올바른 국내 전화번호를 입력해 주세요.`;
  if (rule === 'should not be empty') return `${field} 항목을 입력해 주세요.`;
  if (rule === 'must be an email') return `${field} 항목에 올바른 이메일 주소를 입력해 주세요.`;
  if (rule === 'must be an integer number') return `${field} 항목은 정수로 입력해 주세요.`;
  if (rule === 'must be a number conforming to the specified constraints') return `${field} 항목은 숫자로 입력해 주세요.`;
  if (rule === 'must be a string') return `${field} 항목은 문자로 입력해 주세요.`;
  if (rule === 'must be a boolean value') return `${field} 항목은 켜짐 또는 꺼짐으로 선택해 주세요.`;
  if (rule === 'must be an array') return `${field} 항목은 목록으로 입력해 주세요.`;
  if (rule === 'must be a valid ISO 8601 date string') return `${field} 항목에 올바른 날짜를 입력해 주세요.`;
  const min = /^must not be less than (-?\d+(?:\.\d+)?)$/.exec(rule);
  if (min) return `${field} 항목은 ${min[1]} 이상으로 입력해 주세요.`;
  const max = /^must not be greater than (-?\d+(?:\.\d+)?)$/.exec(rule);
  if (max) return `${field} 항목은 ${max[1]} 이하로 입력해 주세요.`;
  const length = /^must be (longer|shorter) than or equal to (\d+) characters$/.exec(rule);
  if (length) return `${field} 항목은 ${length[2]}자 ${length[1] === 'longer' ? '이상' : '이하'}으로 입력해 주세요.`;
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** 실패 응답과 상태·코드만 읽고, 원본 오류와 재시도 판단은 변경하지 않아요. */
export function getUserErrorMessage(error: unknown, fallback?: string): string {
  const outer = record(error);
  const response = record(outer?.response);
  const payload = record(response?.data) ?? record(outer?.data) ?? outer;
  // 새 계약은 문자열 기반 이행 어댑터보다 먼저 검증해요.
  if (payload && ('type' in payload || 'requestId' in payload)) {
    return normalizeApiError(error, { locale: 'ko-KR' }).message;
  }
  const statusValue = response?.status ?? outer?.status ?? payload?.statusCode;
  const status = typeof statusValue === 'number' ? statusValue : undefined;
  const code = typeof payload?.code === 'string' ? payload.code : outer?.code;
  const field = typeof payload?.field === 'string' && Object.hasOwn(FIELD_LABELS, payload.field) ? FIELD_LABELS[payload.field] : undefined;
  if (typeof code === 'string' && Object.hasOwn(CODE_MESSAGES, code)) {
    if (field && code === 'P2002') return `${field} 정보가 이미 등록돼 있어요.`;
    if (field && code === 'P2011') return `${field} 항목을 입력해 주세요.`;
    if (field && code === 'P2006') return `${field} 항목의 입력값이 올바르지 않아요.`;
    return CODE_MESSAGES[code];
  }

  const details = Array.isArray(payload?.message) ? payload.message : Array.isArray(payload?.issues) ? payload.issues : null;
  if (details && (status === undefined || status < 500)) {
    const messages = details.flatMap((entry) => {
      const safeEntry = getSafeApiDisplayMessage({ response: { status, data: { message: entry } } });
      const translated = safeEntry && (toKoreanErrorCopy(safeEntry) ?? translateValidationMessage(safeEntry));
      return translated ? [translated] : [];
    });
    if (messages.length) return [...new Set(messages)].slice(0, 3).join(' ');
  }
  const safe = getSafeApiDisplayMessage({ response: { status, data: payload } });
  if (safe) {
    const translated = toKoreanErrorCopy(safe) ?? translateValidationMessage(safe);
    if (translated) return translated;
  }
  if (status !== undefined && STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (error instanceof Error) {
    const known = Object.hasOwn(KOREAN_ERROR_MESSAGES, error.message) ? KOREAN_ERROR_MESSAGES[error.message] : undefined;
    if (known) return known;
    // Locally authored Korean errors still pass the same diagnostic filter.
    const local = getSafeApiDisplayMessage({ data: { message: error.message } });
    if (local) {
      const translated = toKoreanErrorCopy(local);
      if (translated) return translated;
    }
  }
  if (typeof error === 'string') {
    const known = Object.hasOwn(KOREAN_ERROR_MESSAGES, error.trim()) ? KOREAN_ERROR_MESSAGES[error.trim()] : undefined;
    if (known) return known;
    const safeText = getSafeApiDisplayMessage({ data: { message: error } });
    if (safeText) {
      const translated = toKoreanErrorCopy(safeText);
      if (translated) return translated;
    }
  }
  const safeFallback = fallback && getSafeApiDisplayMessage({ data: { message: fallback } });
  return (safeFallback && toKoreanErrorCopy(safeFallback)) || UNKNOWN_ERROR_MESSAGE;
}
