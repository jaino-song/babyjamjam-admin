/**
 * Formats a 6-digit `YYMMDD` client birthday as `YYYY.MM.DD`.
 *
 * Returns `raw` unchanged when it is not exactly 6 digits or does not
 * resolve to a real calendar date (e.g. `"991332"` or non-numeric input).
 */
export declare function formatBirthdayYYMMDD(raw: string): string;
/**
 * 계약서의 연-월-일 순서 생년월일을 검증하여 YYMMDD로 정규화한다.
 * 한글·공백·전각 표기를 지원하고, 주민번호·혼합 구분자·임의 문자는 거절한다.
 * 두 자리 연도는 현재 연도 끝자리 이하이면 2000년대, 나머지는 1900년대로 읽는다.
 * 한국 날짜 기준 오늘 이후이거나 1900년 이전인 날짜는 추측하지 않고 null을 반환한다.
 */
export declare function normalizeContractBirthday(raw: string | null | undefined, now?: Date): string | null;
