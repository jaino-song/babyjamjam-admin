# Testing Guide

TDD 기반 테스트 전략 및 실행 가이드

---

## 🔄 TDD Cycle

### Red → Green → Refactor

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   1. RED        2. GREEN       3. REFACTOR             │
│   ┌─────┐       ┌─────┐        ┌─────┐                 │
│   │ 실패 │  →   │ 통과 │   →   │ 개선 │   →  반복      │
│   │테스트│       │ 코드 │        │ 코드 │                 │
│   └─────┘       └─────┘        └─────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

1. **Red**: 실패하는 테스트 먼저 작성
2. **Green**: 테스트를 통과하는 최소한의 코드 작성
3. **Refactor**: 코드 품질 개선 (테스트는 계속 통과)

---

## 📁 테스트 파일 구조

```
src/
├── domain/
│   └── entities/
│       ├── user.entity.ts
│       └── __tests__/
│           └── user.entity.spec.ts
│
├── application/
│   └── use-cases/
│       ├── create-user.use-case.ts
│       └── __tests__/
│           └── create-user.use-case.spec.ts
│
└── infrastructure/
    └── adapters/
        ├── prisma-user.adapter.ts
        └── __tests__/
            └── prisma-user.adapter.integration.spec.ts

e2e/
├── auth.e2e.spec.ts
├── checkout.e2e.spec.ts
└── fixtures/
    └── test-data.ts
```

### 파일 명명 규칙

| 테스트 유형 | 패턴 | 예시 |
|------------|------|------|
| 단위 테스트 | `*.spec.ts` | `user.entity.spec.ts` |
| 통합 테스트 | `*.integration.spec.ts` | `prisma-user.integration.spec.ts` |
| E2E 테스트 | `*.e2e.spec.ts` | `auth.e2e.spec.ts` |

---

## 🧪 단위 테스트 (Jest)

### 기본 구조

```typescript
describe('CreateUserUseCase', () => {
  // Arrange: 테스트 환경 설정
  let useCase: CreateUserUseCase;
  let mockUserRepository: jest.Mocked<UserRepositoryPort>;

  beforeEach(() => {
    mockUserRepository = {
      findByEmail: jest.fn(),
      save: jest.fn(),
      findById: jest.fn(),
    };
    useCase = new CreateUserUseCase(mockUserRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should create user when email is unique', async () => {
      // Arrange
      const dto: CreateUserDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };
      const expectedUser = User.create({ ...dto, id: 'user-1' });
      
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.save.mockResolvedValue(expectedUser);

      // Act
      const result = await useCase.execute(dto);

      // Assert
      expect(result).toEqual(expectedUser);
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(mockUserRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should throw error when email already exists', async () => {
      // Arrange
      const existingUser = User.create({
        id: 'existing-user',
        email: 'test@example.com',
        password: 'hashed',
        name: 'Existing',
      });
      mockUserRepository.findByEmail.mockResolvedValue(existingUser);

      // Act & Assert
      await expect(
        useCase.execute({ email: 'test@example.com', password: 'pw', name: 'New' })
      ).rejects.toThrow(EmailAlreadyExistsError);

      expect(mockUserRepository.save).not.toHaveBeenCalled();
    });
  });
});
```

### Entity/Value Object 테스트

```typescript
describe('Email Value Object', () => {
  describe('create', () => {
    it('should create valid email', () => {
      const email = Email.create('user@example.com');
      expect(email.value).toBe('user@example.com');
    });

    it('should throw for invalid email format', () => {
      expect(() => Email.create('invalid')).toThrow(InvalidEmailError);
    });

    it('should normalize email to lowercase', () => {
      const email = Email.create('User@Example.COM');
      expect(email.value).toBe('user@example.com');
    });
  });

  describe('equals', () => {
    it('should return true for same email', () => {
      const email1 = Email.create('test@example.com');
      const email2 = Email.create('test@example.com');
      expect(email1.equals(email2)).toBe(true);
    });
  });
});
```

### Mock 패턴

```typescript
// Factory 함수로 Mock 생성
function createMockUserRepository(): jest.Mocked<UserRepositoryPort> {
  return {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
}

// Partial Mock
const partialMock = {
  findById: jest.fn().mockResolvedValue(testUser),
} as Partial<jest.Mocked<UserRepositoryPort>>;

// Spy 사용
const loggerSpy = jest.spyOn(logger, 'error');
expect(loggerSpy).toHaveBeenCalledWith('Error message');
```

---

## 🔗 통합 테스트

### Prisma 통합 테스트

```typescript
describe('PrismaUserRepository (Integration)', () => {
  let prisma: PrismaClient;
  let repository: PrismaUserRepository;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL } },
    });
    repository = new PrismaUserRepository(prisma);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // 테스트 데이터 초기화
    await prisma.user.deleteMany();
  });

  describe('save', () => {
    it('should persist user to database', async () => {
      // Arrange
      const user = User.create({
        email: 'test@example.com',
        password: 'hashedPassword',
        name: 'Test User',
      });

      // Act
      const saved = await repository.save(user);

      // Assert
      expect(saved.id).toBeDefined();
      
      const found = await prisma.user.findUnique({
        where: { email: 'test@example.com' },
      });
      expect(found).not.toBeNull();
      expect(found?.name).toBe('Test User');
    });
  });
});
```

### API 통합 테스트

```typescript
describe('UserController (Integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /users', () => {
    it('should create user and return 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/users')
        .send({
          email: 'new@example.com',
          password: 'password123',
          name: 'New User',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        email: 'new@example.com',
        name: 'New User',
      });
      expect(response.body.password).toBeUndefined();
    });

    it('should return 409 for duplicate email', async () => {
      // 먼저 사용자 생성
      await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'dup@example.com', password: 'pw', name: 'First' });

      // 중복 시도
      await request(app.getHttpServer())
        .post('/users')
        .send({ email: 'dup@example.com', password: 'pw', name: 'Second' })
        .expect(409);
    });
  });
});
```

---

## 🌐 E2E 테스트 (Playwright)

### 설정

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 인증 플로우 테스트

```typescript
// e2e/auth.e2e.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should login with valid credentials', async ({ page }) => {
    // Navigate to login
    await page.click('text=로그인');
    
    // Fill form
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    
    // Submit
    await page.click('button[type="submit"]');
    
    // Verify redirect
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('text=환영합니다')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.click('text=로그인');
    await page.fill('input[name="email"]', 'wrong@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('text=이메일 또는 비밀번호가 올바르지 않습니다')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });
});
```

### 결제 플로우 테스트

```typescript
// e2e/checkout.e2e.spec.ts
test.describe('Checkout Flow', () => {
  test.use({ storageState: 'e2e/.auth/user.json' }); // 로그인 상태 재사용

  test('should complete purchase', async ({ page }) => {
    // 상품 선택
    await page.goto('/products');
    await page.click('text=프리미엄 플랜');
    await page.click('button:has-text("구매하기")');

    // 결제 정보 입력 (테스트 카드)
    const iframe = page.frameLocator('iframe[name="stripe_card"]');
    await iframe.locator('[placeholder="Card number"]').fill('4242424242424242');
    await iframe.locator('[placeholder="MM / YY"]').fill('12/30');
    await iframe.locator('[placeholder="CVC"]').fill('123');

    // 결제 완료
    await page.click('button:has-text("결제하기")');

    // 성공 확인
    await expect(page).toHaveURL('/checkout/success');
    await expect(page.locator('text=결제가 완료되었습니다')).toBeVisible();
  });
});
```

### Page Object Model

```typescript
// e2e/pages/LoginPage.ts
export class LoginPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
  }

  async expectError(message: string) {
    await expect(this.page.locator(`text=${message}`)).toBeVisible();
  }
}

// 사용
test('login test', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('test@example.com', 'password');
});
```

---

## 📊 테스트 커버리지

### 기준

| 레이어 | 최소 커버리지 | 필수 테스트 |
|--------|--------------|-------------|
| Entity/VO | 90% | 모든 비즈니스 규칙 |
| Use Case | 85% | 모든 분기, 에러 케이스 |
| Controller | 70% | 요청/응답 매핑 |
| Repository | 60% | 주요 쿼리 |

### 커버리지 설정

```javascript
// jest.config.js
module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/domain/': {
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
  ],
};
```

---

## 🔧 테스트 유틸리티

### Test Fixtures

```typescript
// test/fixtures/user.fixture.ts
export const createTestUser = (overrides?: Partial<User>): User => {
  return User.create({
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashedPassword',
    name: 'Test User',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  });
};

export const createTestUsers = (count: number): User[] => {
  return Array.from({ length: count }, (_, i) =>
    createTestUser({
      id: `test-user-${i}`,
      email: `user${i}@example.com`,
    })
  );
};
```

### Test Database

```typescript
// test/setup/database.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;

  for (const { tablename } of tables) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
    }
  }
}

export async function seedTestData() {
  await prisma.user.create({
    data: {
      email: 'seed@example.com',
      password: 'hashedPassword',
      name: 'Seed User',
    },
  });
}
```

---

## 📋 테스트 체크리스트

### 단위 테스트

- [ ] 모든 public 메서드 테스트
- [ ] 정상 케이스 (happy path)
- [ ] 에러 케이스 (edge cases)
- [ ] 경계값 테스트
- [ ] Mock 의존성 검증

### 통합 테스트

- [ ] API 엔드포인트 테스트
- [ ] 데이터베이스 연동 테스트
- [ ] 외부 서비스 연동 테스트

### E2E 테스트

- [ ] 핵심 사용자 플로우
- [ ] 인증/인가 플로우
- [ ] 결제 플로우 (테스트 모드)
- [ ] 에러 처리 UI

---

## 🔗 관련 문서

- [Code Standards](./code-standards.md)
- [DevOps Guide](./devops.md)
