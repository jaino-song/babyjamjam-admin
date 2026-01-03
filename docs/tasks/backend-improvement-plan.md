# Backend Architecture Improvement Plan

> Created: 2026-01-03
> Status: Planning
> Priority: High

---

## Executive Summary

백엔드 아키텍처 분석 결과를 바탕으로 4단계 개선 계획을 수립합니다.

| Phase | 이름 | 예상 작업량 | 우선순위 |
|-------|------|------------|----------|
| 1 | TypeScript Strict Mode 마이그레이션 | 중간 | 🔴 Critical |
| 2 | 아키텍처 정제 (Clean Architecture 완성) | 높음 | 🟡 High |
| 3 | 테스트 인프라 구축 | 높음 | 🟡 High |
| 4 | 장기 개선 (CQRS, Error Handling) | 낮음 | 🟢 Medium |

---

## Phase 1: TypeScript Strict Mode 마이그레이션

### 목표
- 타입 안전성 강화로 런타임 에러 방지
- 코드 품질 향상 및 IDE 지원 최적화

### 1.1 tsconfig.json 업데이트

**파일**: `backend/tsconfig.json`

**현재 상태**:
```json
{
  "compilerOptions": {
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}
```

**목표 상태**:
```json
{
  "compilerOptions": {
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### 1.2 점진적 마이그레이션 전략

**순서**: Domain → Application → Infrastructure → Interface

#### Step 1.2.1: Domain Layer 타입 수정

| 파일 | 작업 내용 |
|------|----------|
| `domain/entities/*.ts` | null 체크 추가, Optional 프로퍼티 명시 |
| `domain/repositories/*.interface.ts` | 반환 타입 명확화 |
| `domain/value-objects/*.ts` | 유효성 검증 강화 |

**예시 수정 - ClientEntity**:
```typescript
// Before
public phone: string | null,

// After
public readonly phone: string | null,

// update 메서드 수정
update(props: Partial<UpdateClientProps>): void {
    if (props.name !== undefined) this.name = props.name;
    // undefined와 null 구분 처리
}
```

#### Step 1.2.2: Application Layer 타입 수정

| 파일 | 작업 내용 |
|------|----------|
| `application/usecases/**/*.ts` | 입력 파라미터 타입 명시 |
| `application/services/*.ts` | 반환 타입 명시, null 체크 |
| `application/dto/*.ts` | DTO 타입 강화 |

#### Step 1.2.3: Infrastructure Layer 타입 수정

| 파일 | 작업 내용 |
|------|----------|
| `infrastructure/database/repositories/*.ts` | Prisma 타입 매핑 |
| `infrastructure/database/mapper/*.ts` | 변환 함수 타입 명시 |
| `infrastructure/auth/*.ts` | 인증 payload 타입 강화 |

#### Step 1.2.4: Interface Layer 타입 수정

| 파일 | 작업 내용 |
|------|----------|
| `interface/controllers/*.ts` | Request/Response 타입 |
| `interface/dto/*.ts` | class-validator 데코레이터 검토 |

### 1.3 검증 체크리스트

- [ ] `npx tsc --noEmit` 통과
- [ ] `pnpm build` 성공
- [ ] 기존 테스트 통과
- [ ] 런타임 동작 확인

---

## Phase 2: 아키텍처 정제

### 목표
- Clean Architecture 원칙 완전 준수
- 레이어 간 경계 명확화
- Value Objects 활용도 증가

### 2.1 Entity에서 Prisma 의존성 제거

**문제**: Domain Layer가 Infrastructure(Prisma)에 의존

**현재 상태** (`domain/entities/client.entity.ts`):
```typescript
static fromPrisma(prismaData: {...}): ClientEntity {
    // Domain이 Prisma 타입을 알고 있음 ❌
}

toPersistence(): {...} {
    // Infrastructure 관심사가 Domain에 존재 ❌
}
```

**조치 사항**:

#### Step 2.1.1: Entity 순수화

```typescript
// domain/entities/client.entity.ts
export class ClientEntity {
    private constructor(
        public readonly id: number,
        public name: string,
        // ... other properties
    ) {}

    // Factory method for domain use only
    static create(props: CreateClientProps): ClientEntity {
        return new ClientEntity(0, props.name, ...);
    }

    // Reconstitute from persistence (generic, not Prisma-specific)
    static reconstitute(id: number, props: ClientProps): ClientEntity {
        return new ClientEntity(id, props.name, ...);
    }

    // Domain methods
    update(props: Partial<UpdateClientProps>): void { ... }
    isGoingToCareCenter(): boolean { ... }
    isVoucherClient(): boolean { ... }

    // ❌ 제거: fromPrisma(), toPersistence()
}
```

#### Step 2.1.2: Mapper 강화

**파일**: `infrastructure/database/mapper/client.mapper.ts`

```typescript
import { client as PrismaClient } from '@prisma/client';
import { ClientEntity } from 'domain/entities/client.entity';

export class ClientMapper {
    // Prisma → Domain
    static toDomain(raw: PrismaClient): ClientEntity {
        return ClientEntity.reconstitute(raw.id, {
            name: raw.name,
            address: raw.address,
            phone: raw.phone,
            // ... field mapping with camelCase conversion
        });
    }

    // Domain → Prisma (Create)
    static toPrismaCreate(entity: ClientEntity): Omit<PrismaClient, 'id'> {
        return {
            name: entity.name,
            address: entity.address,
            // ... field mapping with snake_case conversion
        };
    }

    // Domain → Prisma (Update)
    static toPrismaUpdate(entity: ClientEntity): Partial<PrismaClient> {
        return {
            name: entity.name,
            // ...
        };
    }
}
```

**적용 대상 Entity**:
- [ ] `client.entity.ts`
- [ ] `employee.entity.ts`
- [ ] `user.entity.ts`
- [ ] `voucher-price-info.entity.ts`
- [ ] `employee-schedule.entity.ts`
- [ ] `eformsign-doc.entity.ts`
- [ ] `area-template.entity.ts`
- [ ] `bank-account-info.entity.ts`
- [ ] `message.entity.ts`

### 2.2 Value Objects 활용

**현재 상태**: VO 정의만 존재, 실제 사용 X

**조치 사항**:

#### Step 2.2.1: PhoneNumber VO 적용

**파일**: `domain/value-objects/phone-number.vo.ts`

```typescript
export class PhoneNumber {
    private constructor(private readonly value: string) {}

    static create(phone: string): PhoneNumber {
        const normalized = this.normalize(phone);
        if (!this.isValid(normalized)) {
            throw new InvalidPhoneNumberError(phone);
        }
        return new PhoneNumber(normalized);
    }

    static createOrNull(phone: string | null): PhoneNumber | null {
        if (!phone) return null;
        try {
            return PhoneNumber.create(phone);
        } catch {
            return null;
        }
    }

    private static normalize(phone: string): string {
        return phone.replace(/[-\s]/g, '');
    }

    private static isValid(phone: string): boolean {
        return /^01[0-9]{8,9}$/.test(phone);
    }

    getValue(): string {
        return this.value;
    }

    getFormatted(): string {
        // 010-1234-5678 형태로 반환
        return this.value.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
    }

    equals(other: PhoneNumber): boolean {
        return this.value === other.value;
    }
}
```

**적용 Entity**:
- `EmployeeEntity.phone: PhoneNumber`
- `ClientEntity.phone: PhoneNumber | null`

#### Step 2.2.2: Money VO 적용

```typescript
export class Money {
    private constructor(
        private readonly amount: number,
        private readonly currency: string = 'KRW'
    ) {}

    static create(amount: number | string): Money {
        const numericAmount = typeof amount === 'string'
            ? parseInt(amount.replace(/,/g, ''), 10)
            : amount;
        return new Money(numericAmount);
    }

    getAmount(): number {
        return this.amount;
    }

    getFormatted(): string {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: this.currency
        }).format(this.amount);
    }

    add(other: Money): Money {
        return new Money(this.amount + other.amount, this.currency);
    }

    subtract(other: Money): Money {
        return new Money(this.amount - other.amount, this.currency);
    }
}
```

**적용 Entity**:
- `VoucherPriceInfoEntity.fullPrice: Money`
- `VoucherPriceInfoEntity.grant: Money`
- `VoucherPriceInfoEntity.actualPrice: Money`
- `ClientEntity.fullPrice: Money | null`

### 2.3 Service Layer 리팩토링

**문제**: `ClientService`가 UseCase와 Prisma를 동시에 호출

**현재 상태** (`application/services/client.service.ts`):
```typescript
@Injectable()
export class ClientService {
    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly prismaService: PrismaService, // ❌ 직접 의존
    ) {}

    async create(params: {...}): Promise<ClientEntity> {
        const client = await this.createClientUsecase.execute({...});

        // ❌ UseCase를 통하지 않고 직접 Prisma 호출
        await this.prismaService.employee_schedule.create({...});

        return client;
    }
}
```

**조치 사항**:

#### Step 2.3.1: Transaction UseCase 도입

**새 파일**: `application/usecases/client/create-client-with-schedule.usecase.ts`

```typescript
@Injectable()
export class CreateClientWithScheduleUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(EMPLOYEE_SCHEDULE_REPOSITORY)
        private readonly scheduleRepository: IEmployeeScheduleRepository,
        private readonly prismaService: PrismaService, // Transaction용
    ) {}

    async execute(params: CreateClientWithScheduleParams): Promise<ClientEntity> {
        return this.prismaService.$transaction(async (tx) => {
            // 1. Client 생성
            const client = await this.clientRepository.create(
                ClientEntity.create({...params}),
                tx // transaction 전달
            );

            // 2. Schedule 생성
            await this.scheduleRepository.create(
                EmployeeScheduleEntity.create({
                    clientId: client.id,
                    primaryEmployeeId: params.primaryEmployeeId,
                    ...
                }),
                tx
            );

            return client;
        });
    }
}
```

#### Step 2.3.2: Service를 Facade로 간소화

```typescript
@Injectable()
export class ClientService {
    constructor(
        private readonly createClientWithSchedule: CreateClientWithScheduleUsecase,
        private readonly findClientById: FindClientByIdUsecase,
        private readonly listClients: ListClientsUsecase,
        private readonly updateClient: UpdateClientUsecase,
        private readonly deleteClient: DeleteClientUsecase,
    ) {}

    // 단순 위임 + Response DTO 변환
    async create(dto: CreateClientDto): Promise<ClientResponseDto> {
        const entity = await this.createClientWithSchedule.execute(dto);
        return ClientResponseDto.from(entity);
    }
}
```

### 2.4 디렉토리 구조 정리

**현재**:
```
backend/
├── domain/repositories/     # Interface가 여기에
├── infrastructure/database/repositories/  # 구현체가 여기에
```

**권장 (Ports & Adapters 명확화)**:
```
backend/
├── domain/
│   └── ports/               # 모든 Port(Interface) 통합
│       ├── repositories/
│       │   ├── client.repository.port.ts
│       │   └── ...
│       └── services/
│           └── external-api.port.ts
├── infrastructure/
│   └── adapters/            # 모든 Adapter(구현체) 통합
│       ├── repositories/
│       │   └── prisma-client.repository.ts
│       └── services/
│           └── eformsign-api.adapter.ts
```

---

## Phase 3: 테스트 인프라 구축

### 목표
- UseCase 단위 테스트 80% 커버리지
- Integration 테스트 주요 플로우 커버
- E2E 테스트 핵심 API 커버

### 3.1 테스트 구조 설계

```
backend/
├── test/
│   ├── unit/
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   └── value-objects/
│   │   └── application/
│   │       └── usecases/
│   ├── integration/
│   │   └── repositories/
│   └── e2e/
│       └── controllers/
├── test-utils/
│   ├── factories/           # 테스트 데이터 팩토리
│   ├── mocks/               # Mock 객체
│   └── fixtures/            # 고정 테스트 데이터
```

### 3.2 UseCase 단위 테스트 작성

**우선순위**: Client → Employee → Schedule → Auth

#### Step 3.2.1: 테스트 유틸 생성

**새 파일**: `backend/test-utils/factories/client.factory.ts`

```typescript
import { ClientEntity } from 'domain/entities/client.entity';

export class ClientFactory {
    static create(overrides: Partial<ClientProps> = {}): ClientEntity {
        return ClientEntity.reconstitute(
            overrides.id ?? 1,
            {
                name: overrides.name ?? '홍길동',
                address: overrides.address ?? '서울시 강남구',
                phone: overrides.phone ?? '010-1234-5678',
                type: overrides.type ?? '일반',
                duration: overrides.duration ?? 12,
                careCenter: overrides.careCenter ?? false,
                voucherClient: overrides.voucherClient ?? true,
                ...overrides,
            }
        );
    }

    static createMany(count: number): ClientEntity[] {
        return Array.from({ length: count }, (_, i) =>
            this.create({ id: i + 1, name: `고객${i + 1}` })
        );
    }
}
```

**새 파일**: `backend/test-utils/mocks/client.repository.mock.ts`

```typescript
import { IClientRepository } from 'domain/repositories/client.repository.interface';

export const createMockClientRepository = (): jest.Mocked<IClientRepository> => ({
    findById: jest.fn(),
    findAll: jest.fn(),
    findAllPaginated: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
});
```

#### Step 3.2.2: CreateClientUsecase 테스트

**새 파일**: `backend/test/unit/application/usecases/client/create-client.usecase.spec.ts`

```typescript
import { CreateClientUsecase } from 'application/usecases/client';
import { IClientRepository } from 'domain/repositories/client.repository.interface';
import { ClientFactory } from 'test-utils/factories/client.factory';
import { createMockClientRepository } from 'test-utils/mocks/client.repository.mock';

describe('CreateClientUsecase', () => {
    let usecase: CreateClientUsecase;
    let mockRepository: jest.Mocked<IClientRepository>;

    beforeEach(() => {
        mockRepository = createMockClientRepository();
        usecase = new CreateClientUsecase(mockRepository);
    });

    describe('execute', () => {
        it('should create a client with valid data', async () => {
            // Arrange
            const inputDto = {
                name: '홍길동',
                address: '서울시',
                careCenter: false,
                voucherClient: true,
            };
            const expectedClient = ClientFactory.create({ id: 1, ...inputDto });
            mockRepository.create.mockResolvedValue(expectedClient);

            // Act
            const result = await usecase.execute(inputDto);

            // Assert
            expect(result).toEqual(expectedClient);
            expect(mockRepository.create).toHaveBeenCalledTimes(1);
        });

        it('should throw error when name is empty', async () => {
            // Arrange
            const inputDto = { name: '', careCenter: false, voucherClient: true };

            // Act & Assert
            await expect(usecase.execute(inputDto))
                .rejects.toThrow('Name is required');
        });
    });
});
```

### 3.3 테스트 대상 UseCase 목록

| Domain | UseCase | Priority |
|--------|---------|----------|
| Client | CreateClientUsecase | P0 |
| Client | UpdateClientUsecase | P0 |
| Client | ListClientsPaginatedUsecase | P0 |
| Client | DeleteClientUsecase | P1 |
| Employee | CreateEmployeeUsecase | P0 |
| Employee | UpdateEmployeeUsecase | P1 |
| Schedule | CreateScheduleUsecase | P0 |
| Schedule | ReplaceScheduleUsecase | P0 |
| Auth | ValidateUserUsecase | P0 |

### 3.4 Integration 테스트

**새 파일**: `backend/test/integration/repositories/client.repository.spec.ts`

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from 'infrastructure/database/prisma.service';
import { SbClientRepository } from 'infrastructure/database/repositories/sb.client.repository';

describe('SbClientRepository (Integration)', () => {
    let repository: SbClientRepository;
    let prisma: PrismaService;

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            providers: [SbClientRepository, PrismaService],
        }).compile();

        repository = module.get(SbClientRepository);
        prisma = module.get(PrismaService);
    });

    beforeEach(async () => {
        // Clean test data
        await prisma.client.deleteMany({
            where: { name: { startsWith: 'TEST_' } },
        });
    });

    describe('findAllPaginated', () => {
        it('should return paginated results', async () => {
            // Arrange: Create 15 test clients
            await prisma.client.createMany({
                data: Array.from({ length: 15 }, (_, i) => ({
                    name: `TEST_Client${i}`,
                    care_center: false,
                    voucher_client: true,
                })),
            });

            // Act
            const result = await repository.findAllPaginated(1, 10);

            // Assert
            expect(result.data).toHaveLength(10);
            expect(result.total).toBe(15);
            expect(result.totalPages).toBe(2);
        });
    });
});
```

### 3.5 E2E 테스트 (Playwright 또는 SuperTest)

**새 파일**: `backend/test/e2e/client.e2e-spec.ts`

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from 'app.module';

describe('ClientController (E2E)', () => {
    let app: INestApplication;
    let authToken: string;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        await app.init();

        // Get auth token for tests
        authToken = await getTestAuthToken();
    });

    afterAll(async () => {
        await app.close();
    });

    describe('GET /clients', () => {
        it('should return paginated clients', () => {
            return request(app.getHttpServer())
                .get('/clients?page=1&limit=10')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect((res) => {
                    expect(res.body).toHaveProperty('data');
                    expect(res.body).toHaveProperty('total');
                    expect(res.body).toHaveProperty('page', 1);
                });
        });

        it('should return 401 without auth token', () => {
            return request(app.getHttpServer())
                .get('/clients')
                .expect(401);
        });
    });
});
```

---

## Phase 4: 장기 개선

### 4.1 Error Handling 표준화

#### Step 4.1.1: Domain Exception 정의

**새 파일**: `domain/exceptions/domain.exception.ts`

```typescript
export abstract class DomainException extends Error {
    abstract readonly code: string;
    abstract readonly statusCode: number;

    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
        };
    }
}

// Specific exceptions
export class EntityNotFoundError extends DomainException {
    readonly code = 'ENTITY_NOT_FOUND';
    readonly statusCode = 404;

    constructor(entity: string, id: string | number) {
        super(`${entity} with id ${id} not found`);
    }
}

export class InvalidPhoneNumberError extends DomainException {
    readonly code = 'INVALID_PHONE_NUMBER';
    readonly statusCode = 400;

    constructor(phone: string) {
        super(`Invalid phone number format: ${phone}`);
    }
}

export class DuplicateEntityError extends DomainException {
    readonly code = 'DUPLICATE_ENTITY';
    readonly statusCode = 409;

    constructor(entity: string, field: string, value: string) {
        super(`${entity} with ${field} '${value}' already exists`);
    }
}
```

#### Step 4.1.2: Global Exception Filter

**새 파일**: `interface/filters/domain-exception.filter.ts`

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { DomainException } from 'domain/exceptions/domain.exception';

@Catch(DomainException)
export class DomainExceptionFilter implements ExceptionFilter {
    catch(exception: DomainException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();

        response.status(exception.statusCode).json({
            statusCode: exception.statusCode,
            error: exception.code,
            message: exception.message,
            timestamp: new Date().toISOString(),
        });
    }
}
```

### 4.2 CQRS 패턴 준비

**현재 구조**:
```
application/usecases/client/
├── create-client.usecase.ts
├── update-client.usecase.ts
├── delete-client.usecase.ts
├── find-client-by-id.usecase.ts
└── list-clients.usecase.ts
```

**CQRS 구조**:
```
application/
├── commands/
│   └── client/
│       ├── create-client.command.ts
│       ├── create-client.handler.ts
│       ├── update-client.command.ts
│       └── update-client.handler.ts
├── queries/
│   └── client/
│       ├── get-client.query.ts
│       ├── get-client.handler.ts
│       ├── list-clients.query.ts
│       └── list-clients.handler.ts
└── bus/
    ├── command.bus.ts
    └── query.bus.ts
```

### 4.3 Rate Limiting 추가

**의존성 추가**: `@nestjs/throttler`

**파일**: `app.module.ts`

```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
    imports: [
        ThrottlerModule.forRoot([{
            ttl: 60000,    // 1분
            limit: 100,    // 100 요청
        }]),
        // ... other imports
    ],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule {}
```

---

## Implementation Checklist

### Phase 1: TypeScript Strict Mode
- [ ] tsconfig.json 업데이트
- [ ] Domain layer 타입 수정
- [ ] Application layer 타입 수정
- [ ] Infrastructure layer 타입 수정
- [ ] Interface layer 타입 수정
- [ ] Build 성공 확인
- [ ] 기존 테스트 통과

### Phase 2: Architecture Refinement
- [ ] Entity에서 fromPrisma/toPersistence 제거
- [ ] Mapper 강화
- [ ] PhoneNumber VO 적용
- [ ] Money VO 적용
- [ ] Service → UseCase 리팩토링
- [ ] 디렉토리 구조 정리 (선택)

### Phase 3: Testing Infrastructure
- [ ] 테스트 유틸 생성 (Factory, Mock)
- [ ] UseCase 단위 테스트 작성 (P0)
- [ ] UseCase 단위 테스트 작성 (P1)
- [ ] Integration 테스트 작성
- [ ] E2E 테스트 작성
- [ ] 커버리지 80% 달성

### Phase 4: Long-term Improvements
- [ ] Domain Exception 정의
- [ ] Global Exception Filter 적용
- [ ] Rate Limiting 추가
- [ ] CQRS 패턴 도입 (선택)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Strict mode 마이그레이션 시 빌드 실패 | High | 단계별 점진적 적용 |
| Entity 리팩토링 시 런타임 에러 | High | 충분한 테스트 커버리지 확보 후 진행 |
| 테스트 작성 시간 지연 | Medium | P0 항목 우선 집중 |

---

## Notes

- Phase 1은 Phase 2, 3의 선행 조건
- Phase 2와 Phase 3는 병렬 진행 가능
- Phase 4는 Phase 1-3 완료 후 진행 권장

---

*Last Updated: 2026-01-03*
