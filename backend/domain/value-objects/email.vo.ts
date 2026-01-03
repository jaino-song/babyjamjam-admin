/**
 * Email Value Object
 * 이메일 주소를 검증하고 관리하는 값 객체
 */
export class Email {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value.toLowerCase().trim();
    }

    /**
     * 이메일 주소 생성
     * @param value 이메일 문자열
     * @returns Email 인스턴스 또는 null (유효하지 않은 경우)
     */
    static create(value: string | null | undefined): Email | null {
        if (!value) return null;

        const trimmed = value.trim().toLowerCase();
        if (!Email.isValid(trimmed)) {
            return null;
        }

        return new Email(trimmed);
    }

    /**
     * 이메일 주소 생성. 유효하지 않으면 예외를 던집니다.
     * @param value 이메일 문자열
     * @throws Error 유효하지 않은 이메일인 경우
     */
    static createOrThrow(value: string): Email {
        const email = Email.create(value);
        if (!email) {
            throw new Error(`Invalid email address: ${value}`);
        }
        return email;
    }

    /**
     * 이메일 유효성 검사
     */
    private static isValid(value: string): boolean {
        // RFC 5322에 기반한 간소화된 이메일 검증
        const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return emailPattern.test(value);
    }

    /**
     * 이메일 주소 반환
     */
    toString(): string {
        return this.value;
    }

    /**
     * 도메인 부분 반환
     */
    getDomain(): string {
        return this.value.split('@')[1] ?? '';
    }

    /**
     * 로컬 파트 반환 (@ 앞부분)
     */
    getLocalPart(): string {
        return this.value.split('@')[0] ?? '';
    }

    /**
     * 값 동등성 비교
     */
    equals(other: Email | null | undefined): boolean {
        if (!other) return false;
        return this.value === other.value;
    }
}
