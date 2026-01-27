# 데이터베이스 설계와 ORM: 외래 키 제약 조건과 히스토리 추적

> 실제 프로젝트에서 마주친 데이터베이스 설계 문제와 Prisma ORM을 활용한 해결 방법을 공유합니다.

## 목차
1. [문제 상황: 외래 키 제약 조건 위반](#문제-상황-외래-키-제약-조건-위반)
2. [원인 분석: 스키마 설계와 실제 사용의 불일치](#원인-분석-스키마-설계와-실제-사용의-불일치)
3. [해결 방법: 중간 테이블을 통한 히스토리 추적](#해결-방법-중간-테이블을-통한-히스토리-추적)
4. [구현 상세](#구현-상세)
5. [설계 패턴과 베스트 프랙티스](#설계-패턴과-베스트-프랙티스)

---

## 문제 상황: 외래 키 제약 조건 위반

### 에러 메시지

고객 등록 시 "생성" 버튼을 클릭하면 다음 에러가 발생했습니다:

```
Foreign key constraint violated on the constraint: `client_primary_employee_id_fkey`
```

### 시나리오

1. 사용자가 고객 정보 입력 폼에서 "담당 직원"을 선택
2. 프론트엔드는 선택된 직원의 `employee.id`를 서버로 전송
3. 백엔드에서 고객 생성 시 외래 키 에러 발생

---

## 원인 분석: 스키마 설계와 실제 사용의 불일치

### 원래 스키마 설계

데이터베이스는 **히스토리 추적**을 위해 중간 테이블을 사용하도록 설계되어 있었습니다:

```
┌──────────┐     ┌────────────────────┐     ┌──────────┐
│  client  │────▶│  employee_schedule │────▶│ employee │
└──────────┘     └────────────────────┘     └──────────┘
      │                    │                      │
      │  primary_          │  employee_id         │
      │  schedule_id       │  work_address        │
      │                    │  start_date          │
      │                    │  end_date            │
      │                    │  replaced            │
```

**설계 의도:**
- 고객에게 직원이 직접 배정되는 것이 아니라, "스케줄"이 배정됨
- 직원 교체 시 기존 스케줄은 `replaced = true`로 보존
- 새 스케줄을 생성하여 고객에게 연결
- 이를 통해 **배정 이력** 추적 가능

### 실제 구현 상태

프론트엔드에서는 단순히 직원 ID만 전송하고 있었습니다:

```typescript
// 프론트엔드 - 직원 ID 직접 전송
const formData = {
    name: "홍길동",
    primaryEmployeeId: 5,  // employee.id를 직접 전송
};

await fetch('/api/clients', {
    method: 'POST',
    body: JSON.stringify(formData),
});
```

```typescript
// 백엔드 - 스키마는 schedule_id를 기대
model client {
    primary_schedule_id Int?  // employee_schedule.id를 참조해야 함!
    // ...
}
```

**문제:** `employee.id = 5`를 `primary_schedule_id`에 저장하려고 하니, `employee_schedule` 테이블에 `id = 5`인 레코드가 없어서 외래 키 위반 발생.

---

## 해결 방법: 중간 테이블을 통한 히스토리 추적

### 해결 전략

1. 스키마 설계 의도를 유지 (히스토리 추적 가능)
2. 프론트엔드 인터페이스는 단순하게 유지 (직원 ID만 전송)
3. 백엔드 서비스 레이어에서 자동으로 `employee_schedule` 생성

### 최종 데이터 흐름

```
Frontend                  Backend Service              Database
    │                           │                          │
    │  { employeeId: 5 }        │                          │
    │─────────────────────────▶ │                          │
    │                           │                          │
    │                           │  1. employee_schedule    │
    │                           │     생성                  │
    │                           │─────────────────────────▶ │
    │                           │                          │
    │                           │  schedule_id 반환        │
    │                           │◀───────────────────────── │
    │                           │                          │
    │                           │  2. client 생성          │
    │                           │     (schedule_id 참조)    │
    │                           │─────────────────────────▶ │
```

---

## 구현 상세

### 1. Prisma 스키마 정의

```prisma
// backend/prisma/schema.prisma

model client {
    id                     Int      @id @default(autoincrement())
    name                   String
    address                String?
    
    // 직원 스케줄 참조 (직원 직접 참조 X)
    primary_schedule_id    Int?
    secondary_schedule_id  Int?
    
    // 관계 정의
    primary_schedule       employee_schedule? @relation(
        "client_primary_employee_schedule", 
        fields: [primary_schedule_id], 
        references: [id]
    )
    secondary_schedule     employee_schedule? @relation(
        "client_secondary_employee_schedule", 
        fields: [secondary_schedule_id], 
        references: [id]
    )
    
    created_at             DateTime @default(now())
    updated_at             DateTime @updatedAt
}

model employee_schedule {
    id                   Int      @id @default(autoincrement())
    employee_id          Int      @db.SmallInt
    work_address         String
    start_date           DateTime @db.Date
    end_date             DateTime @db.Date
    replaced             Boolean  @default(false)  // 교체 여부
    
    // 직원 참조
    employee             employee @relation(
        fields: [employee_id], 
        references: [id], 
        onDelete: Cascade
    )
    
    // 역방향 관계 (어떤 고객들이 이 스케줄을 사용하는지)
    clients_as_primary   client[] @relation("client_primary_employee_schedule")
    clients_as_secondary client[] @relation("client_secondary_employee_schedule")
    
    created_at           DateTime @default(now())
    
    @@index([employee_id])
    @@index([replaced])
}

model employee {
    id                   Int      @id @default(autoincrement())
    name                 String
    phone                String?
    
    // 역방향 관계
    schedules            employee_schedule[]
    
    created_at           DateTime @default(now())
    updated_at           DateTime @updatedAt
}
```

### 2. 서비스 레이어 구현

```typescript
// backend/application/services/client.service.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/database/prisma.service';
import { CreateClientUsecase } from '@/application/usecases/client/create-client.usecase';

interface CreateClientParams {
    name: string;
    address?: string;
    primaryEmployeeId: number;      // 프론트엔드에서 직원 ID 전송
    secondaryEmployeeId?: number;
    contractStartDate: Date;
    contractEndDate: Date;
}

@Injectable()
export class ClientService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly createClientUsecase: CreateClientUsecase,
    ) {}
    
    async create(params: CreateClientParams) {
        // 트랜잭션으로 원자성 보장
        return this.prisma.$transaction(async (tx) => {
            // 1. 주 담당 직원의 스케줄 생성
            const primarySchedule = await tx.employee_schedule.create({
                data: {
                    employee_id: params.primaryEmployeeId,
                    work_address: params.address ?? "",
                    start_date: params.contractStartDate,
                    end_date: params.contractEndDate,
                    replaced: false,
                },
            });
            
            // 2. 부 담당 직원의 스케줄 생성 (있는 경우)
            let secondaryScheduleId: number | null = null;
            if (params.secondaryEmployeeId) {
                const secondarySchedule = await tx.employee_schedule.create({
                    data: {
                        employee_id: params.secondaryEmployeeId,
                        work_address: params.address ?? "",
                        start_date: params.contractStartDate,
                        end_date: params.contractEndDate,
                        replaced: false,
                    },
                });
                secondaryScheduleId = secondarySchedule.id;
            }
            
            // 3. 스케줄 ID로 고객 생성
            const client = await tx.client.create({
                data: {
                    name: params.name,
                    address: params.address,
                    primary_schedule_id: primarySchedule.id,
                    secondary_schedule_id: secondaryScheduleId,
                },
                include: {
                    primary_schedule: {
                        include: { employee: true }
                    },
                    secondary_schedule: {
                        include: { employee: true }
                    },
                },
            });
            
            return client;
        });
    }
}
```

### 3. 직원 교체 로직 (히스토리 보존)

```typescript
// backend/application/services/client.service.ts

async replaceEmployee(
    clientId: number, 
    newEmployeeId: number, 
    scheduleType: 'primary' | 'secondary'
) {
    return this.prisma.$transaction(async (tx) => {
        // 1. 현재 고객 정보 조회
        const client = await tx.client.findUnique({
            where: { id: clientId },
            include: {
                primary_schedule: true,
                secondary_schedule: true,
            },
        });
        
        if (!client) {
            throw new NotFoundException('Client not found');
        }
        
        const scheduleField = scheduleType === 'primary' 
            ? 'primary_schedule' 
            : 'secondary_schedule';
        const scheduleIdField = scheduleType === 'primary'
            ? 'primary_schedule_id'
            : 'secondary_schedule_id';
        
        const currentSchedule = client[scheduleField];
        
        // 2. 기존 스케줄을 'replaced'로 마킹 (히스토리 보존)
        if (currentSchedule) {
            await tx.employee_schedule.update({
                where: { id: currentSchedule.id },
                data: { 
                    replaced: true,
                    end_date: new Date(),  // 종료일을 오늘로
                },
            });
        }
        
        // 3. 새 스케줄 생성
        const newSchedule = await tx.employee_schedule.create({
            data: {
                employee_id: newEmployeeId,
                work_address: client.address ?? "",
                start_date: new Date(),
                end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1년 후
                replaced: false,
            },
        });
        
        // 4. 고객에 새 스케줄 연결
        await tx.client.update({
            where: { id: clientId },
            data: {
                [scheduleIdField]: newSchedule.id,
            },
        });
        
        return newSchedule;
    });
}
```

### 4. 직원 배정 이력 조회

```typescript
// backend/application/services/client.service.ts

async getEmployeeHistory(clientId: number) {
    // 해당 고객의 모든 스케줄 이력 조회
    const schedules = await this.prisma.employee_schedule.findMany({
        where: {
            OR: [
                { clients_as_primary: { some: { id: clientId } } },
                { clients_as_secondary: { some: { id: clientId } } },
            ],
        },
        include: {
            employee: {
                select: { id: true, name: true },
            },
        },
        orderBy: { start_date: 'desc' },
    });
    
    return schedules.map(schedule => ({
        employeeId: schedule.employee_id,
        employeeName: schedule.employee.name,
        startDate: schedule.start_date,
        endDate: schedule.end_date,
        isReplaced: schedule.replaced,
        isCurrent: !schedule.replaced,
    }));
}
```

---

## 설계 패턴과 베스트 프랙티스

### 1. 중간 테이블 패턴 (Association Table with Metadata)

단순 다대다 관계 대신, 메타데이터를 포함한 중간 테이블을 사용:

```
일반적인 다대다:
client <──────────────▶ employee
         many-to-many

메타데이터 포함 중간 테이블:
client ──────▶ employee_schedule ──────▶ employee
             (start_date, end_date,
              replaced, work_address)
```

**장점:**
- 관계의 시작/종료 시점 기록
- 관계 변경 이력 추적
- 관계별 추가 속성 저장

### 2. Soft Delete vs History Table

| 방식 | 설명 | 사용 시점 |
|------|------|----------|
| **Soft Delete** | `deleted_at` 컬럼으로 삭제 표시 | 단순 삭제/복구만 필요할 때 |
| **History Table** | 별도 이력 테이블에 기록 | 변경 전후 값 비교가 필요할 때 |
| **Status Flag** | `replaced`, `active` 플래그 | 현재 유효한 레코드만 구분 필요할 때 |

이 프로젝트에서는 **Status Flag** 방식 (`replaced` 컬럼)을 사용했습니다.

### 3. 서비스 레이어에서 관계 자동 생성

프론트엔드 개발자에게 복잡한 DB 스키마를 노출하지 않고, 서비스 레이어에서 추상화:

```typescript
// ❌ 프론트엔드에서 복잡한 구조 전송
{
    name: "홍길동",
    primarySchedule: {
        employeeId: 5,
        workAddress: "서울시...",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
    }
}

// ✅ 프론트엔드에서 단순한 구조 전송
{
    name: "홍길동",
    primaryEmployeeId: 5,
    address: "서울시...",
    contractStartDate: "2024-01-01",
    contractEndDate: "2024-12-31",
}
// → 서비스 레이어에서 employee_schedule 자동 생성
```

### 4. 트랜잭션으로 데이터 일관성 보장

여러 테이블에 걸친 작업은 반드시 트랜잭션 사용:

```typescript
// Prisma Interactive Transaction
return this.prisma.$transaction(async (tx) => {
    // 1. schedule 생성
    const schedule = await tx.employee_schedule.create({ ... });
    
    // 2. client 생성
    const client = await tx.client.create({
        data: {
            primary_schedule_id: schedule.id,  // 1에서 생성된 ID 사용
        },
    });
    
    return client;
});
// 둘 중 하나라도 실패하면 모두 롤백
```

### 5. 인덱스 전략

자주 조회되는 컬럼에 인덱스 추가:

```prisma
model employee_schedule {
    // ...
    
    @@index([employee_id])      // 직원별 스케줄 조회
    @@index([replaced])         // 현재 유효한 스케줄만 필터링
    @@index([start_date])       // 기간별 조회
}
```

---

## 마이그레이션 참고

기존 스키마에서 변경이 필요한 경우:

```sql
-- 1. 기존 외래 키 삭제
ALTER TABLE "client" 
    DROP CONSTRAINT IF EXISTS "client_primary_employee_id_fkey";

-- 2. 컬럼 이름 변경 (employee_id → schedule_id)
ALTER TABLE "client" 
    RENAME COLUMN "primary_employee_id" TO "primary_schedule_id";

-- 3. 타입 변경 (필요 시)
ALTER TABLE "client" 
    ALTER COLUMN "primary_schedule_id" TYPE INT;

-- 4. Nullable 설정
ALTER TABLE "client" 
    ALTER COLUMN "primary_schedule_id" DROP NOT NULL;

-- 5. 새 외래 키 추가
ALTER TABLE "client" 
    ADD CONSTRAINT "client_primary_schedule_id_fkey" 
    FOREIGN KEY ("primary_schedule_id") 
    REFERENCES "employee_schedule"("id") 
    ON DELETE NO ACTION ON UPDATE NO ACTION;
```

또는 Prisma 마이그레이션 사용:

```bash
npx prisma migrate dev --name add_schedule_relation
```

---

## 정리

### 핵심 교훈

1. **스키마 설계 의도를 먼저 이해하라** - 왜 중간 테이블이 있는지 파악
2. **서비스 레이어에서 복잡성을 숨겨라** - API는 단순하게, 내부 로직에서 처리
3. **히스토리 추적이 필요하면 중간 테이블 활용** - 직접 참조 대신 메타데이터 테이블
4. **트랜잭션으로 데이터 일관성 보장** - 다중 테이블 작업 시 필수

### 체크리스트

- [ ] 외래 키 관계가 실제 비즈니스 요구사항과 일치하는가?
- [ ] 관계 변경 이력 추적이 필요한가?
- [ ] 프론트엔드 인터페이스가 불필요하게 복잡하지 않은가?
- [ ] 트랜잭션으로 원자성이 보장되는가?
- [ ] 적절한 인덱스가 설정되어 있는가?

---

## 참고 자료

- [Prisma Relations](https://www.prisma.io/docs/concepts/components/prisma-schema/relations)
- [Prisma Transactions](https://www.prisma.io/docs/concepts/components/prisma-client/transactions)
- [Database Design Patterns - History Tables](https://martinfowler.com/eaaDev/timeNarrative.html)
