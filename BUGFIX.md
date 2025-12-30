# Bug Fixes Documentation

이 문서는 개발 과정에서 발생한 주요 버그와 해결 방법을 기록합니다.

---

## 2025-12-26

### 1. 고객 생성 시 외래 키 제약 조건 위반 (Foreign Key Constraint Violation)

**증상:**
```
Foreign key constraint violated on the constraint: `client_primary_employee_id_fkey`
```
고객 등록 시 "생성" 버튼을 클릭하면 외래 키 제약 조건 오류가 발생하여 고객이 생성되지 않음.

**원인:**
원래 스키마 설계에서 `client.primary_employee_id`가 `employee_schedule.id`를 참조하도록 되어 있었으나, 프론트엔드에서 `employee.id`를 직접 전송하고 있었음.

**해결 방법:**

스키마를 원래 설계대로 유지하고 (`client` → `employee_schedule` → `employee`), 백엔드 `ClientService`에서 `employee_schedule`을 자동 생성하는 로직 추가:

1. **Prisma 스키마** (`backend/prisma/schema.prisma`):
```prisma
model client {
  primary_schedule_id    Int?
  secondary_schedule_id  Int?
  primary_schedule       employee_schedule? @relation("client_primary_employee_schedule", fields: [primary_schedule_id], references: [id])
  secondary_schedule     employee_schedule? @relation("client_secondary_employee_schedule", fields: [secondary_schedule_id], references: [id])
}

model employee_schedule {
  id                   Int      @id @default(autoincrement())
  employee_id          Int      @db.SmallInt
  work_address         String
  start_date           DateTime @db.Date
  end_date             DateTime @db.Date
  replaced             Boolean  @default(false)
  employee             employee @relation(fields: [employee_id], references: [id], onDelete: Cascade)
  clients_as_primary   client[] @relation("client_primary_employee_schedule")
  clients_as_secondary client[] @relation("client_secondary_employee_schedule")
}
```

2. **ClientService에서 employee_schedule 자동 생성** (`backend/application/services/client.service.ts`):
```typescript
async create(params: { primaryEmployeeId: number; ... }): Promise<ClientEntity> {
    // 1. employee_schedule 생성
    const primarySchedule = await this.prismaService.employee_schedule.create({
        data: {
            employee_id: params.primaryEmployeeId,
            work_address: params.address ?? "",
            start_date: startDate,
            end_date: endDate,
            replaced: false,
        },
    });
    
    // 2. schedule ID로 client 생성
    return this.createClientUsecase.execute({
        ...params,
        primaryScheduleId: primarySchedule.id,
    });
}
```

3. **데이터베이스 외래 키 변경** (SQL):
```sql
-- 기존 외래 키 삭제 및 컬럼 이름 변경
ALTER TABLE "client" DROP CONSTRAINT IF EXISTS "client_primary_employee_id_fkey";
ALTER TABLE "client" RENAME COLUMN "primary_employee_id" TO "primary_schedule_id";
ALTER TABLE "client" ALTER COLUMN "primary_schedule_id" TYPE INT;
ALTER TABLE "client" ALTER COLUMN "primary_schedule_id" DROP NOT NULL;

-- 새로운 외래 키 추가 (employee_schedule 참조)
ALTER TABLE "client" ADD CONSTRAINT "client_primary_schedule_id_fkey" 
  FOREIGN KEY ("primary_schedule_id") REFERENCES "employee_schedule"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
```

**설계 이점:**
- 직원 배당 변경 시 히스토리 추적 가능
- `employee_schedule.replaced = true`로 이전 배당 기록 유지
- 향후 직원 스케줄 관리 기능 확장 용이

---

### 2. 프론트엔드 API 라우트에서 Authorization 헤더 누락

**증상:**
고객 생성 요청이 백엔드에서 401 Unauthorized 또는 데이터가 조회되지 않는 문제.

**원인:**
프론트엔드 API 라우트 (`/api/clients/route.ts`, `/api/clients/[id]/route.ts`)에서 백엔드로 요청을 프록시할 때 `Authorization` 헤더를 포함하지 않았음. 백엔드의 `ClientController`는 `@UseGuards(JwtGuard)`로 보호되어 있어 인증이 필요함.

**해결 방법:**

`frontend/app/api/clients/route.ts`:
```typescript
const response = await serverAPIClient.get("/clients", { 
    params,
    headers: {
        Authorization: `Bearer ${accessToken}`,
    },
});
```

`frontend/app/api/clients/[id]/route.ts`:
```typescript
const response = await serverAPIClient.get(`/clients/${id}`, {
    headers: {
        Authorization: `Bearer ${accessToken}`,
    },
});
```

---

### 3. Employee ID `0`이 falsy 값으로 처리되는 문제

**증상:**
직원 ID가 `0`인 경우 `primaryEmployeeId` 검증에서 "주 담당 인력을 선택해주세요" 오류가 발생하거나, 선택한 직원이 `null`로 전송됨.

**원인:**
JavaScript에서 `0`은 falsy 값이므로, 다음과 같은 코드에서 문제가 발생:
```typescript
// 문제가 있는 코드
if (!formData.primaryEmployeeId) { ... }  // 0도 falsy로 처리됨
value={formData.primaryEmployeeId || null}  // 0이면 null로 대체됨
```

**해결 방법:**

1. **검증 로직 수정** (`ClientFormDialog.tsx`):
```typescript
// 수정 전
if (!formData.primaryEmployeeId) {
    setError(t(locale, "clients.form.error-employee-required"));
    return;
}

// 수정 후
if (formData.primaryEmployeeId === null || formData.primaryEmployeeId === undefined) {
    setError(t(locale, "clients.form.error-employee-required"));
    return;
}
```

2. **값 전달 시 nullish coalescing 사용**:
```typescript
// 수정 전
value={formData.primaryEmployeeId || null}

// 수정 후
value={formData.primaryEmployeeId ?? null}
```

3. **EmployeeAutocomplete 컴포넌트 수정**:
```typescript
// 수정 전
if (!value || !employees) return null;

// 수정 후
if (value === null || value === undefined || !employees) return null;
```

---

### 4. 제공인력 생성 시 405 Method Not Allowed

**증상:**
```
POST http://localhost:3000/api/employees 405 (Method Not Allowed)
```

**원인:**
프론트엔드 `/api/employees/route.ts`에 GET 메서드만 구현되어 있고, POST, PATCH, DELETE 메서드가 없었음.

**해결 방법:**

`frontend/app/api/employees/route.ts`에 누락된 메서드 추가:
```typescript
export async function POST(request: NextRequest) {
    const accessToken = getAccessToken(request);
    const body = await request.json();
    const response = await serverAPIClient.post("/employees", body, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    return NextResponse.json(response.data, { status: 201 });
}

export async function PATCH(request: NextRequest) { ... }
export async function DELETE(request: NextRequest) { ... }
```

---

### 5. 제공인력 등록 시 registeredDate 필수 필드 오류

**증상:**
제공인력 생성 요청이 백엔드에서 Validation 오류로 실패.

**원인:**
`CreateEmployeeDto`에서 `registeredDate`가 필수 필드로 설정되어 있었으나, 프론트엔드에서 전송하지 않음.

**해결 방법:**

`backend/interface/dto/employee.dto.ts`:
```typescript
// 수정 전
@IsDateString()
registeredDate!: string;

// 수정 후
@IsOptional()
@IsDateString()
registeredDate?: string;
```

---

### 6. HTML 중첩 오류 (Hydration Error)

**증상:**
```
In HTML, <h6> cannot be a child of <h2>.
<p> cannot contain a nested <div>.
```

**원인:**
MUI `DialogTitle`은 `<h2>`를 렌더링하는데, 내부에 `Typography variant="h6"` (`<h6>`)를 사용하면 HTML 규칙 위반.
또한 `Typography variant="body2"` (`<p>`) 내부에 `Chip` (`<div>`)을 사용하면 위반.

**해결 방법:**

1. **DialogTitle 내부 수정**:
```typescript
// 수정 전
<DialogTitle>
    <Typography variant="h6">{employee.name}</Typography>
</DialogTitle>

// 수정 후
<DialogTitle>
    <Box component="span" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
        {employee.name}
    </Box>
</DialogTitle>
```

2. **Chip을 포함하는 경우**:
```typescript
// 수정 전
<Typography variant="body2">
    <Chip label={value} />
</Typography>

// 수정 후
<Box>
    <Chip label={value} />
</Box>
```

---

### 7. React Query 캐시 무효화 문제

**증상:**
고객 생성/수정/삭제 후 테이블이 자동으로 갱신되지 않음.

**원인:**
Mutation의 `onSuccess`에서 `["clients"]` 키만 무효화했지만, 실제 쿼리는 `["clients", "list", { page, limit, search }]` 형태로 더 구체적인 키를 사용.

**해결 방법:**

Query Key Factory 패턴 적용:
```typescript
export const clientQueryKeys = {
    all: ["clients"] as const,
    lists: () => [...clientQueryKeys.all, "list"] as const,
    list: (params: { page: number; limit: number; search: string }) => 
        [...clientQueryKeys.lists(), params] as const,
    details: () => [...clientQueryKeys.all, "detail"] as const,
    detail: (id: number) => [...clientQueryKeys.details(), id] as const,
};

// Mutation에서 사용
onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
},
```

---

### 8. 가격 정보 자동 반영 실패

**증상:**
바우처 유형과 서비스 기간 선택 시 요금 정보가 자동으로 채워지지 않음.

**원인:**
1. `VoucherPriceInfo` 인터페이스의 타입이 백엔드 반환값과 불일치 (`number` vs `string | null`)
2. 가격 문자열에 쉼표가 포함되어 있어 `parseInt` 실패

**해결 방법:**

1. **타입 수정** (`useVoucherData.ts`):
```typescript
export interface VoucherPriceInfo {
    fullPrice: string | null;  // number에서 변경
    grant: string | null;
    actualPrice: string | null;
}
```

2. **가격 파싱 함수 추가**:
```typescript
const parsePrice = (value: string | null): number => {
    if (!value) return 0;
    return parseInt(value.replace(/,/g, ''), 10) || 0;
};
```

---

## 예방 조치

1. **TypeScript Strict Mode 활용**: 타입 불일치를 컴파일 시점에 발견
2. **API 응답 타입 공유**: 백엔드와 프론트엔드 간 DTO 타입 동기화
3. **E2E 테스트**: 주요 CRUD 플로우에 대한 통합 테스트 작성
4. **코드 리뷰**: 외래 키 관계 및 falsy 값 처리 주의
5. **데이터베이스 설계 문서화**: 테이블 간 관계 및 외래 키 참조 명확히 기록
