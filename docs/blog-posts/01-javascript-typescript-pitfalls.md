# JavaScript/TypeScript에서 흔히 마주치는 함정들

> 실제 프로덕션 코드에서 발생한 버그들과 해결 방법을 공유합니다.

## 목차
1. [Falsy 값의 함정: `0`은 유효한 값이다](#1-falsy-값의-함정-0은-유효한-값이다)
2. [타입 불일치: 백엔드와 프론트엔드 사이](#2-타입-불일치-백엔드와-프론트엔드-사이)
3. [안전한 객체 속성 접근](#3-안전한-객체-속성-접근)

---

## 1. Falsy 값의 함정: `0`은 유효한 값이다

### 문제 상황

직원 관리 시스템에서 직원 ID가 `0`인 경우, 선택한 직원이 `null`로 처리되어 "담당 인력을 선택해주세요"라는 오류가 발생했습니다.

```typescript
// 🐛 문제가 있는 코드
if (!formData.primaryEmployeeId) {
    setError("담당 인력을 선택해주세요");
    return;
}

// ID가 0인 직원을 선택해도 오류 발생!
```

### 원인 분석

JavaScript에서 `0`은 **falsy 값**입니다. `!0`은 `true`로 평가됩니다.

```javascript
// JavaScript의 Falsy 값들
false, 0, -0, 0n, "", null, undefined, NaN

// 모두 falsy로 평가됨
!0          // true
!""         // true
!null       // true
!undefined  // true
```

비슷한 문제가 값 전달 시에도 발생했습니다:

```typescript
// 🐛 0이면 null로 대체됨
value={formData.primaryEmployeeId || null}

// 직원 ID가 0이면:
// 0 || null → null (의도하지 않은 동작!)
```

### 해결 방법

#### 방법 1: 명시적 null/undefined 체크

```typescript
// ✅ 수정된 코드
if (formData.primaryEmployeeId === null || formData.primaryEmployeeId === undefined) {
    setError("담당 인력을 선택해주세요");
    return;
}
```

#### 방법 2: Nullish Coalescing 연산자 (`??`)

```typescript
// ✅ ?? 사용 - null과 undefined만 체크
value={formData.primaryEmployeeId ?? null}

// 직원 ID가 0이면:
// 0 ?? null → 0 (의도한 동작!)
```

#### 방법 3: 컴포넌트 내부에서도 동일하게 처리

```typescript
// EmployeeAutocomplete.tsx

// 🐛 수정 전
if (!value || !employees) return null;

// ✅ 수정 후
if (value === null || value === undefined || !employees) return null;
```

### `||` vs `??` 비교

| 연산자 | 동작 | `0 연산자 null` 결과 |
|--------|------|---------------------|
| `\|\|` (OR) | falsy 값이면 우측 반환 | `null` |
| `??` (Nullish) | null/undefined만 우측 반환 | `0` |

```typescript
// 실제 차이점
0 || "default"     // "default" (0은 falsy)
0 ?? "default"     // 0 (0은 nullish가 아님)

"" || "default"    // "default" (빈 문자열은 falsy)
"" ?? "default"    // "" (빈 문자열은 nullish가 아님)

null || "default"  // "default"
null ?? "default"  // "default" (동일)
```

### 핵심 교훈

> **`0`, `""`, `false`가 유효한 값일 수 있다면 `??`를 사용하라.**

특히 다음과 같은 경우 주의가 필요합니다:
- ID 값 (0부터 시작하는 인덱스)
- 수량, 가격 (0원, 0개가 유효한 값)
- 빈 문자열이 의미 있는 입력인 경우

---

## 2. 타입 불일치: 백엔드와 프론트엔드 사이

### 문제 상황

바우처 유형과 서비스 기간을 선택하면 자동으로 가격 정보가 채워져야 하는데, 아무 값도 표시되지 않았습니다.

```typescript
// 프론트엔드 인터페이스 정의
interface VoucherPriceInfo {
    fullPrice: number;      // 숫자 타입으로 정의
    grant: number;
    actualPrice: number;
}

// 실제 백엔드 응답
{
    "fullPrice": "150,000",   // 실제로는 문자열 + 쉼표 포함!
    "grant": "120,000",
    "actualPrice": "30,000"
}
```

### 원인 분석

1. **타입 정의와 실제 데이터 불일치**: 백엔드는 포맷팅된 문자열을 반환하는데, 프론트엔드는 숫자를 기대
2. **parseInt의 한계**: 쉼표가 포함된 문자열은 제대로 파싱되지 않음

```typescript
parseInt("150,000")  // 150 (쉼표에서 파싱 중단!)
parseInt("30,000")   // 30
```

### 해결 방법

#### 1단계: 타입 정의 수정

```typescript
// ✅ 백엔드 응답에 맞게 타입 수정
export interface VoucherPriceInfo {
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
}
```

#### 2단계: 가격 파싱 유틸리티 함수 작성

```typescript
/**
 * 쉼표가 포함된 가격 문자열을 숫자로 변환
 * @param value - "150,000" 형태의 문자열
 * @returns 숫자 (150000)
 */
const parsePrice = (value: string | null): number => {
    if (!value) return 0;
    // 쉼표 제거 후 파싱
    return parseInt(value.replace(/,/g, ''), 10) || 0;
};

// 사용 예시
const price = parsePrice("150,000");  // 150000
const grant = parsePrice(null);        // 0
const invalid = parsePrice("abc");     // 0
```

#### 3단계: 포맷팅 함수도 함께 작성

```typescript
/**
 * 숫자를 한국식 가격 문자열로 변환
 * @param value - 숫자
 * @returns "150,000" 형태의 문자열
 */
const formatPrice = (value: number): string => {
    return value.toLocaleString('ko-KR');
};

// 사용 예시
formatPrice(150000)  // "150,000"
formatPrice(0)       // "0"
```

### 타입 동기화 전략

백엔드와 프론트엔드 간 타입 불일치를 방지하기 위한 전략들:

#### 방법 1: 공유 타입 패키지
```
project/
├── packages/
│   └── shared-types/      # 공유 타입 정의
│       └── src/
│           └── voucher.ts
├── backend/
└── frontend/
```

#### 방법 2: OpenAPI/Swagger 자동 생성
```bash
# NestJS에서 Swagger 데코레이터 사용
# → openapi.json 자동 생성
# → 프론트엔드 타입 자동 생성
npx openapi-typescript ./openapi.json -o ./types/api.ts
```

#### 방법 3: Zod 스키마 공유
```typescript
// shared/schemas/voucher.schema.ts
import { z } from 'zod';

export const VoucherPriceInfoSchema = z.object({
    fullPrice: z.string().nullable(),
    grant: z.string().nullable(),
    actualPrice: z.string().nullable(),
});

export type VoucherPriceInfo = z.infer<typeof VoucherPriceInfoSchema>;
```

### 핵심 교훈

> **API 응답 타입은 추측하지 말고 실제 데이터를 확인하라.**

1. Network 탭에서 실제 응답 확인
2. 타입과 실제 데이터가 일치하는지 검증
3. 데이터 변환이 필요하면 유틸리티 함수로 추상화

---

## 3. 안전한 객체 속성 접근

### 문제 상황

다국어 지원을 위한 번역 함수에서 존재하지 않는 키에 접근할 때 런타임 에러 또는 TypeScript 경고가 발생했습니다.

```typescript
// 번역 데이터 구조
const translations = {
    ko: {
        common: {
            save: "저장",
            cancel: "취소"
        },
        clients: {
            title: "고객 관리"
        }
    },
    en: {
        common: {
            save: "Save",
            cancel: "Cancel"
        }
        // clients 카테고리가 없음!
    }
};

// 🐛 문제 코드
function t(locale: string, key: string): string {
    const [category, field] = key.split('.');
    return translations[locale][category][field];  
    // TypeError: Cannot read property 'title' of undefined
}
```

### 해결 방법

#### 방법 1: Optional Chaining + Nullish Coalescing

```typescript
// ✅ 안전한 접근
function t(locale: string, key: string): string {
    const [category, field] = key.split('.');
    return translations[locale]?.[category]?.[field] ?? key;
}

// 키가 없으면 키 자체를 반환
t('en', 'clients.title')  // "clients.title" (fallback)
t('ko', 'clients.title')  // "고객 관리"
```

#### 방법 2: 타입 가드 함수 사용

```typescript
// 타입 안전한 접근을 위한 헬퍼
function hasKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
    return key in obj;
}

function t(locale: string, key: string): string {
    const [category, field] = key.split('.');
    
    const localeData = translations[locale];
    if (!localeData || !hasKey(localeData, category)) {
        return key;
    }
    
    const categoryData = localeData[category];
    if (!categoryData || !hasKey(categoryData, field)) {
        return key;
    }
    
    return categoryData[field];
}
```

#### 방법 3: Proxy를 활용한 안전한 객체

```typescript
// 존재하지 않는 키 접근 시 자동으로 fallback 반환
function createSafeTranslations(translations: any, fallback: string = '') {
    return new Proxy(translations, {
        get(target, prop) {
            if (prop in target) {
                const value = target[prop];
                if (typeof value === 'object' && value !== null) {
                    return createSafeTranslations(value, fallback);
                }
                return value;
            }
            return fallback;
        }
    });
}

const safeT = createSafeTranslations(translations);
safeT.en.clients.title  // "" (에러 대신 빈 문자열)
```

### 핵심 교훈

> **외부 데이터나 동적 키 접근 시 항상 존재 여부를 확인하라.**

```typescript
// ❌ 위험
obj[dynamicKey].property

// ✅ 안전
obj[dynamicKey]?.property ?? defaultValue
```

---

## 정리: TypeScript/JavaScript 안전 코딩 체크리스트

### 1. Falsy 값 처리
- [ ] `0`, `""`, `false`가 유효한 값인지 확인
- [ ] 유효하다면 `??` 사용, 아니면 `||` 사용
- [ ] 명시적 null/undefined 체크 고려

### 2. 타입 안전성
- [ ] API 응답의 실제 타입 확인
- [ ] 백엔드/프론트엔드 타입 동기화 전략 수립
- [ ] 런타임 데이터 변환 함수 작성

### 3. 객체 접근
- [ ] 동적 키 접근 시 Optional Chaining 사용
- [ ] Fallback 값 제공 (Nullish Coalescing)
- [ ] 타입 가드로 TypeScript 지원

---

## 참고 자료

- [MDN - Nullish Coalescing Operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing_operator)
- [MDN - Optional Chaining](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining)
- [TypeScript Handbook - Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
