/**
 * PhoneNumber Value Object
 * 한국 전화번호 형식을 검증하고 관리하는 값 객체
 *
 * 지원 형식:
 * - 휴대폰: 010-XXXX-XXXX, 01X-XXX-XXXX
 * - 지역번호: 02-XXX-XXXX, 0XX-XXX-XXXX
 * - 하이픈 없는 형식도 지원
 */
export class PhoneNumber {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    /**
     * 전화번호를 생성합니다.
     * @param value 원본 전화번호 문자열
     * @returns PhoneNumber 인스턴스 또는 null (유효하지 않은 경우)
     */
    static create(value: string | null | undefined): PhoneNumber | null {
        if (!value) return null;

        const normalized = PhoneNumber.normalize(value);
        if (!PhoneNumber.isValid(normalized)) {
            return null;
        }

        return new PhoneNumber(normalized);
    }

    /**
     * 전화번호를 생성합니다. 유효하지 않으면 예외를 던집니다.
     * @param value 원본 전화번호 문자열
     * @throws Error 유효하지 않은 전화번호인 경우
     */
    static createOrThrow(value: string): PhoneNumber {
        const phone = PhoneNumber.create(value);
        if (!phone) {
            throw new Error(`Invalid phone number: ${value}`);
        }
        return phone;
    }

    /**
     * 전화번호 문자열을 정규화합니다 (숫자만 추출)
     */
    private static normalize(value: string): string {
        return value.replace(/[^0-9]/g, '');
    }

    /**
     * 정규화된 전화번호가 유효한지 검증합니다
     */
    private static isValid(normalized: string): boolean {
        // 휴대폰: 010, 011, 016, 017, 018, 019로 시작, 10-11자리
        const mobilePattern = /^01[016789]\d{7,8}$/;

        // 서울 지역번호: 02로 시작, 9-10자리
        const seoulPattern = /^02\d{7,8}$/;

        // 기타 지역번호: 0XX로 시작, 10-11자리
        const regionalPattern = /^0[3-6][1-5]\d{7,8}$/;

        return mobilePattern.test(normalized) ||
               seoulPattern.test(normalized) ||
               regionalPattern.test(normalized);
    }

    /**
     * 하이픈 없는 형식으로 반환 (DB 저장용)
     */
    toString(): string {
        return this.value;
    }

    /**
     * 하이픈이 포함된 형식으로 반환 (화면 표시용)
     */
    toFormattedString(): string {
        const v = this.value;

        // 휴대폰 (11자리)
        if (v.length === 11 && v.startsWith('01')) {
            return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
        }

        // 휴대폰 (10자리, 구형)
        if (v.length === 10 && v.startsWith('01')) {
            return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
        }

        // 서울 (9자리)
        if (v.length === 9 && v.startsWith('02')) {
            return `${v.slice(0, 2)}-${v.slice(2, 5)}-${v.slice(5)}`;
        }

        // 서울 (10자리)
        if (v.length === 10 && v.startsWith('02')) {
            return `${v.slice(0, 2)}-${v.slice(2, 6)}-${v.slice(6)}`;
        }

        // 기타 지역 (10자리)
        if (v.length === 10) {
            return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
        }

        // 기타 지역 (11자리)
        if (v.length === 11) {
            return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
        }

        return v;
    }

    /**
     * 값 동등성 비교
     */
    equals(other: PhoneNumber | null | undefined): boolean {
        if (!other) return false;
        return this.value === other.value;
    }
}
