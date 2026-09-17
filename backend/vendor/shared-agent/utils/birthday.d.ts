/** 기존 6자리와 YYYY-MM-DD 생년월일을 네 자리 연도로 표시한다. */
export declare function formatBirthdayYYMMDD(raw: string): string;
/**
 * 계약서의 연-월-일 순서 생년월일을 검증하여 YYMMDD로 정규화한다.
 * 한글·공백·전각 표기를 지원하고, 주민번호·혼합 구분자·임의 문자는 거절한다.
 * 두 자리 연도는 현재 연도 끝자리 이하이면 2000년대, 나머지는 1900년대로 읽는다.
 * 한국 날짜 기준 오늘 이후이거나 1900년 이전인 날짜는 추측하지 않고 null을 반환한다.
 */
export declare function normalizeContractBirthday(raw: string | null | undefined, now?: Date): string | null;
/** 기존 생년월일을 읽되 명시된 네 자리 연도를 보존한다. 신규 입력 검증과는 구분한다. */
export declare function normalizeBirthdayIsoDate(raw: string | null | undefined, now?: Date): string | null;
/** 신규 생년월일은 세기를 추측하지 않는 YYYY-MM-DD 형식만 허용한다. */
export declare function isValidBirthdayIsoDate(raw: string, now?: Date): boolean;
/** 입력 중에는 일부 값도 유지하고, 여덟 자리 숫자에 날짜 구분자를 붙인다. */
export declare function formatBirthdayInput(value: string): string;
