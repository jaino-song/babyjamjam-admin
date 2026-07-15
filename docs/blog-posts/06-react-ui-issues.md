# React와 MUI에서 마주친 UI 이슈들

> Hydration Error, React Query 캐시, 가격 포맷팅 등 프론트엔드 개발에서 흔히 발생하는 문제들과 해결 방법을 공유합니다.

## 목차
1. [HTML 중첩 오류와 Hydration Error](#1-html-중첩-오류와-hydration-error)
2. [React Query 캐시 무효화 전략](#2-react-query-캐시-무효화-전략)
3. [가격 입력 필드의 포맷팅과 상태 관리](#3-가격-입력-필드의-포맷팅과-상태-관리)

---

## 1. HTML 중첩 오류와 Hydration Error

### 문제 상황

브라우저 콘솔에 다음과 같은 경고가 나타났습니다:

```
Warning: In HTML, <h6> cannot be a child of <h2>.
Warning: <p> cannot contain a nested <div>.
```

그리고 때때로 Hydration Error가 발생:

```
Error: Hydration failed because the initial UI does not match what was rendered on the server.
```

### 원인 분석

MUI 컴포넌트는 내부적으로 특정 HTML 요소를 렌더링합니다:

| MUI 컴포넌트 | 기본 HTML 요소 |
|-------------|---------------|
| `DialogTitle` | `<h2>` |
| `Typography variant="h6"` | `<h6>` |
| `Typography variant="body1"` | `<p>` |
| `Typography variant="body2"` | `<p>` |
| `Chip` | `<div>` |
| `Box` | `<div>` |

#### 문제 코드 1: 제목 중첩

```tsx
// 🐛 <h2> 안에 <h6> - HTML 규칙 위반
<DialogTitle>
    <Typography variant="h6">{employee.name}</Typography>
</DialogTitle>

// 렌더링 결과:
// <h2 class="MuiDialogTitle-root">
//     <h6 class="MuiTypography-h6">홍길동</h6>  ← 위반!
// </h2>
```

#### 문제 코드 2: p 태그 안에 div

```tsx
// 🐛 <p> 안에 <div> - HTML 규칙 위반
<Typography variant="body2">
    상태: <Chip label="활성" size="small" />
</Typography>

// 렌더링 결과:
// <p class="MuiTypography-body2">
//     상태: <div class="MuiChip-root">활성</div>  ← 위반!
// </p>
```

### 해결 방법

#### 방법 1: Box component="span" 사용

```tsx
// ✅ DialogTitle 내부에서 스타일링
<DialogTitle>
    <Box component="span" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
        {employee.name}
    </Box>
</DialogTitle>

// 렌더링 결과:
// <h2 class="MuiDialogTitle-root">
//     <span style="font-weight: 600; font-size: 1.1rem;">홍길동</span>
// </h2>
```

#### 방법 2: Typography component prop 사용

```tsx
// ✅ Typography가 span으로 렌더링되도록
<DialogTitle>
    <Typography variant="h6" component="span">
        {employee.name}
    </Typography>
</DialogTitle>
```

#### 방법 3: Chip을 포함할 때는 Box 사용

```tsx
// 🐛 수정 전
<Typography variant="body2">
    상태: <Chip label="활성" />
</Typography>

// ✅ 수정 후 - Box는 div를 포함할 수 있음
<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <Typography variant="body2" component="span">상태:</Typography>
    <Chip label="활성" size="small" />
</Box>
```

### HTML 중첩 규칙 요약

| 컨테이너 | 포함 가능 | 포함 불가 |
|----------|----------|----------|
| `<p>` | inline 요소 (`span`, `a`, `strong`) | block 요소 (`div`, `p`, `h1-h6`) |
| `<h1-h6>` | inline 요소 | 다른 heading, block 요소 |
| `<span>` | inline 요소 | block 요소 |
| `<div>` | 모든 요소 | - |

### 디버깅 팁

React DevTools에서 실제 렌더링된 HTML 확인:

```tsx
// 컴포넌트가 어떤 HTML을 렌더링하는지 확인
<Typography variant="body2">
    {/* 이게 <p>가 될지 <span>이 될지 확인 필요 */}
</Typography>
```

---

## 2. React Query 캐시 무효화 전략

### 문제 상황

고객을 생성/수정/삭제한 후 테이블이 자동으로 갱신되지 않았습니다.

새로고침하면 데이터가 반영됨 → 캐시 무효화 문제

### 원인 분석

```tsx
// 🐛 문제 코드
const useCreateClient = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: createClient,
        onSuccess: () => {
            // "clients" 키만 무효화
            queryClient.invalidateQueries({ queryKey: ['clients'] });
        },
    });
};

// 하지만 실제 쿼리는 더 구체적인 키 사용
const useClients = (params: { page: number; limit: number; search: string }) => {
    return useQuery({
        // 실제 쿼리 키
        queryKey: ['clients', 'list', params],  // ← 이 키가 무효화 안 됨!
        queryFn: () => fetchClients(params),
    });
};
```

**문제:** `invalidateQueries({ queryKey: ['clients'] })`는 정확히 `['clients']` 키만 무효화합니다.
`['clients', 'list', { page: 1, ... }]`는 다른 키로 취급되어 무효화되지 않습니다.

### 해결 방법: Query Key Factory 패턴

```tsx
// queryKeys.ts - 중앙 집중식 쿼리 키 관리
export const clientQueryKeys = {
    // 최상위 키 - 모든 client 관련 쿼리의 공통 접두사
    all: ['clients'] as const,
    
    // 목록 관련 키
    lists: () => [...clientQueryKeys.all, 'list'] as const,
    list: (params: { page: number; limit: number; search: string }) => 
        [...clientQueryKeys.lists(), params] as const,
    
    // 상세 관련 키
    details: () => [...clientQueryKeys.all, 'detail'] as const,
    detail: (id: number) => [...clientQueryKeys.details(), id] as const,
};
```

#### 쿼리에서 사용

```tsx
// useClients.ts
export const useClients = (params: { page: number; limit: number; search: string }) => {
    return useQuery({
        queryKey: clientQueryKeys.list(params),  // ['clients', 'list', { page, limit, search }]
        queryFn: () => fetchClients(params),
    });
};

export const useClient = (id: number) => {
    return useQuery({
        queryKey: clientQueryKeys.detail(id),  // ['clients', 'detail', 123]
        queryFn: () => fetchClient(id),
    });
};
```

#### Mutation에서 사용

```tsx
// useCreateClient.ts
export const useCreateClient = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: createClient,
        onSuccess: () => {
            // ✅ 'clients'로 시작하는 모든 쿼리 무효화
            queryClient.invalidateQueries({ 
                queryKey: clientQueryKeys.all 
            });
        },
    });
};
```

### invalidateQueries의 매칭 동작

```tsx
// 키 계층 구조
['clients']
['clients', 'list']
['clients', 'list', { page: 1, limit: 10, search: '' }]
['clients', 'detail']
['clients', 'detail', 123]

// invalidateQueries 매칭
queryClient.invalidateQueries({ queryKey: ['clients'] });
// → 위의 모든 키가 무효화됨 (접두사 매칭)

queryClient.invalidateQueries({ queryKey: ['clients', 'list'] });
// → ['clients', 'list']와 그 하위만 무효화

queryClient.invalidateQueries({ queryKey: ['clients', 'detail', 123] });
// → 정확히 해당 키만 무효화
```

### Optimistic Update (선택적 고급 기법)

사용자 경험 향상을 위해 서버 응답 전에 UI 먼저 업데이트:

```tsx
export const useDeleteClient = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: deleteClient,
        
        // 1. 요청 전: 낙관적 업데이트
        onMutate: async (deletedId) => {
            // 진행 중인 쿼리 취소
            await queryClient.cancelQueries({ queryKey: clientQueryKeys.lists() });
            
            // 이전 값 저장 (롤백용)
            const previousClients = queryClient.getQueryData(clientQueryKeys.lists());
            
            // 낙관적으로 캐시 업데이트
            queryClient.setQueriesData(
                { queryKey: clientQueryKeys.lists() },
                (old: any) => ({
                    ...old,
                    data: old.data.filter((client: any) => client.id !== deletedId),
                })
            );
            
            return { previousClients };
        },
        
        // 2. 에러 시: 롤백
        onError: (err, deletedId, context) => {
            queryClient.setQueriesData(
                { queryKey: clientQueryKeys.lists() },
                context?.previousClients
            );
        },
        
        // 3. 완료 시: 서버 데이터로 동기화
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
        },
    });
};
```

---

## 3. 가격 입력 필드의 포맷팅과 상태 관리

### 문제 상황

계약 생성 폼에서:
1. 가격이 `150000` 형태로 표시됨 (쉼표 없음)
2. 바우처 연도를 변경해도 관련 필드가 리셋되지 않음
3. 입력과 표시 형식이 불일치

### 해결 방법

#### 1단계: 포맷팅/파싱 유틸리티 함수

```typescript
// utils/price.ts

/**
 * 숫자를 한국식 가격 문자열로 변환
 * @example formatPrice(150000) → "150,000"
 */
export const formatPrice = (value: number): string => {
    return value.toLocaleString('ko-KR');
};

/**
 * 가격 문자열을 숫자로 변환
 * @example parsePrice("150,000") → 150000
 */
export const parsePrice = (value: string): number => {
    if (!value) return 0;
    // 숫자가 아닌 문자 모두 제거
    const numericString = value.replace(/[^\d]/g, '');
    return parseInt(numericString, 10) || 0;
};

/**
 * 입력값을 실시간으로 포맷팅 (타이핑 중)
 * @example formatPriceInput("150000") → "150,000"
 */
export const formatPriceInput = (value: string): string => {
    const number = parsePrice(value);
    return number === 0 ? '' : formatPrice(number);
};
```

#### 2단계: 가격 입력 컴포넌트

```tsx
// components/PriceInput.tsx
import { TextField, InputAdornment } from '@mui/material';
import { formatPriceInput, parsePrice } from '@/utils/price';

interface PriceInputProps {
    value: number;
    onChange: (value: number) => void;
    label: string;
    disabled?: boolean;
}

export function PriceInput({ value, onChange, label, disabled }: PriceInputProps) {
    const [displayValue, setDisplayValue] = useState(
        value ? formatPrice(value) : ''
    );
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value;
        
        // 숫자만 허용
        if (inputValue && !/^[\d,]*$/.test(inputValue)) {
            return;
        }
        
        // 표시값 업데이트 (포맷팅 적용)
        const formatted = formatPriceInput(inputValue);
        setDisplayValue(formatted);
        
        // 실제 숫자값을 부모에 전달
        const numericValue = parsePrice(inputValue);
        onChange(numericValue);
    };
    
    // 외부에서 value가 변경되면 displayValue도 업데이트
    useEffect(() => {
        setDisplayValue(value ? formatPrice(value) : '');
    }, [value]);
    
    return (
        <TextField
            label={label}
            value={displayValue}
            onChange={handleChange}
            disabled={disabled}
            InputProps={{
                endAdornment: <InputAdornment position="end">원</InputAdornment>,
            }}
            inputProps={{
                inputMode: 'numeric',  // 모바일에서 숫자 키패드
                style: { textAlign: 'right' },
            }}
        />
    );
}
```

#### 3단계: 폼에서 사용

```tsx
// ContractCreationForm.tsx
interface FormData {
    voucherYear: number;
    voucherType: string;
    servicePeriod: string;
    fullPrice: number;
    grant: number;
    actualPrice: number;
}

export function ContractCreationForm() {
    const [formData, setFormData] = useState<FormData>({
        voucherYear: new Date().getFullYear(),
        voucherType: '',
        servicePeriod: '',
        fullPrice: 0,
        grant: 0,
        actualPrice: 0,
    });
    
    // 바우처 연도 변경 시 관련 필드 리셋
    const handleVoucherYearChange = (year: number) => {
        setFormData(prev => ({
            ...prev,
            voucherYear: year,
            // 연도가 바뀌면 가격 정보가 달라지므로 리셋
            voucherType: '',
            servicePeriod: '',
            fullPrice: 0,
            grant: 0,
            actualPrice: 0,
        }));
    };
    
    // 바우처 유형 + 서비스 기간 선택 시 가격 자동 조회
    const { data: priceInfo } = useVoucherPrice(
        formData.voucherYear,
        formData.voucherType,
        formData.servicePeriod
    );
    
    // 가격 정보가 조회되면 자동 반영
    useEffect(() => {
        if (priceInfo) {
            setFormData(prev => ({
                ...prev,
                fullPrice: parsePrice(priceInfo.fullPrice),
                grant: parsePrice(priceInfo.grant),
                actualPrice: parsePrice(priceInfo.actualPrice),
            }));
        }
    }, [priceInfo]);
    
    return (
        <form>
            {/* 바우처 연도 선택 */}
            <FormControl>
                <InputLabel>바우처 연도</InputLabel>
                <Select
                    value={formData.voucherYear}
                    onChange={(e) => handleVoucherYearChange(Number(e.target.value))}
                >
                    {[2024, 2025, 2026].map(year => (
                        <MenuItem key={year} value={year}>{year}년</MenuItem>
                    ))}
                </Select>
            </FormControl>
            
            {/* 가격 입력 필드들 */}
            <PriceInput
                label="총 금액"
                value={formData.fullPrice}
                onChange={(value) => setFormData(prev => ({ ...prev, fullPrice: value }))}
            />
            
            <PriceInput
                label="정부 지원금"
                value={formData.grant}
                onChange={(value) => setFormData(prev => ({ ...prev, grant: value }))}
            />
            
            <PriceInput
                label="본인 부담금"
                value={formData.actualPrice}
                onChange={(value) => setFormData(prev => ({ ...prev, actualPrice: value }))}
            />
        </form>
    );
}
```

### 연관 필드 리셋 패턴

```tsx
// 계층적 의존성이 있는 폼 필드
// 상위 필드가 변경되면 하위 필드를 리셋

const fieldDependencies = {
    voucherYear: ['voucherType', 'servicePeriod', 'fullPrice', 'grant', 'actualPrice'],
    voucherType: ['servicePeriod', 'fullPrice', 'grant', 'actualPrice'],
    servicePeriod: ['fullPrice', 'grant', 'actualPrice'],
};

const handleFieldChange = (field: keyof FormData, value: any) => {
    setFormData(prev => {
        const updated = { ...prev, [field]: value };
        
        // 의존 필드들 리셋
        const dependents = fieldDependencies[field] || [];
        dependents.forEach(dep => {
            updated[dep] = getDefaultValue(dep);
        });
        
        return updated;
    });
};

const getDefaultValue = (field: string) => {
    switch (field) {
        case 'voucherType':
        case 'servicePeriod':
            return '';
        case 'fullPrice':
        case 'grant':
        case 'actualPrice':
            return 0;
        default:
            return null;
    }
};
```

---

## 정리: React/UI 체크리스트

### HTML 시맨틱
- [ ] MUI 컴포넌트의 기본 HTML 요소 확인
- [ ] heading 안에 heading 중첩 금지
- [ ] p 태그 안에 div/block 요소 금지
- [ ] 필요 시 `component` prop으로 요소 변경

### React Query 캐시
- [ ] Query Key Factory 패턴 적용
- [ ] Mutation 성공 시 적절한 범위 무효화
- [ ] Optimistic Update 고려 (UX 향상)

### 폼 상태 관리
- [ ] 표시 형식과 저장 형식 분리
- [ ] 포맷팅/파싱 유틸리티 함수 작성
- [ ] 연관 필드 의존성 처리
- [ ] 외부 데이터 변경 시 동기화

---

## 참고 자료

- [HTML Content Models](https://html.spec.whatwg.org/multipage/dom.html#content-models)
- [MUI Component API](https://mui.com/material-ui/api/)
- [TanStack Query - Query Keys](https://tanstack.com/query/latest/docs/react/guides/query-keys)
- [React Hook Form](https://react-hook-form.com/) - 복잡한 폼 관리 대안
