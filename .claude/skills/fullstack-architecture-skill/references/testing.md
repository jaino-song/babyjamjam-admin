# Testing Strategy Guide

## 테스트 피라미드

```
          ▲
         /E2E\           10% - Critical User Journeys
        /─────\
       /Integration\     20% - API, DB, External Services
      /─────────────\
     /    Unit Tests \   70% - Domain Logic, Utils
    /─────────────────\
```

## 기술 스택

| 레벨 | 도구 |
|------|------|
| E2E | Playwright |
| Integration | Vitest + Supertest |
| Unit | Vitest |

## Playwright 설정

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    // Desktop
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    
    // Mobile
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'] } },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

## Page Object Model

```typescript
// e2e/pages/base.page.ts
import { Page, Locator } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }
}

// e2e/pages/login.page.ts
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly kakaoButton: Locator;
  readonly naverButton: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = this.getByTestId('login-email');
    this.passwordInput = this.getByTestId('login-password');
    this.submitButton = this.getByTestId('login-submit');
    this.errorMessage = this.getByTestId('login-error');
    this.kakaoButton = this.getByTestId('login-kakao');
    this.naverButton = this.getByTestId('login-naver');
  }

  async goto() {
    await this.page.goto('/login');
    await this.waitForPageLoad();
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectError(message: string) {
    await expect(this.errorMessage).toContainText(message);
  }

  async expectRedirectToDashboard() {
    await expect(this.page).toHaveURL('/dashboard');
  }
}

// e2e/pages/dashboard.page.ts
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  readonly welcomeMessage: Locator;
  readonly logoutButton: Locator;
  readonly userMenu: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomeMessage = this.getByTestId('dashboard-welcome');
    this.logoutButton = this.getByTestId('logout-button');
    this.userMenu = this.getByTestId('user-menu');
  }

  async goto() {
    await this.page.goto('/dashboard');
    await this.waitForPageLoad();
  }

  async logout() {
    await this.userMenu.click();
    await this.logoutButton.click();
  }

  async expectWelcomeMessage(name: string) {
    await expect(this.welcomeMessage).toContainText(name);
  }
}
```

## Test Fixtures

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base, Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

export const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
  name: 'Test User',
};

type AuthFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(TEST_USER.email, TEST_USER.password);
    await page.waitForURL('/dashboard');
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

## E2E 테스트 예시

```typescript
// e2e/auth/login.spec.ts
import { test, expect, TEST_USER } from '../fixtures/auth.fixture';

test.describe('Login', () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goto();
  });

  test('should display login form', async ({ loginPage }) => {
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ loginPage }) => {
    await loginPage.login('wrong@email.com', 'wrongpassword');
    await loginPage.expectError('이메일 또는 비밀번호가 올바르지 않습니다');
  });

  test('should redirect to dashboard on successful login', async ({ loginPage }) => {
    await loginPage.login(TEST_USER.email, TEST_USER.password);
    await loginPage.expectRedirectToDashboard();
  });

  test('should validate email format', async ({ loginPage, page }) => {
    await loginPage.emailInput.fill('invalid-email');
    await loginPage.passwordInput.fill('password123');
    await loginPage.submitButton.click();
    await expect(page.getByText('올바른 이메일 형식이 아닙니다')).toBeVisible();
  });
});

// e2e/auth/oauth.spec.ts
import { test, expect } from '../fixtures/auth.fixture';

test.describe('OAuth Login', () => {
  test('should redirect to Kakao login page', async ({ loginPage, page }) => {
    await loginPage.goto();
    
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      loginPage.kakaoButton.click(),
    ]);

    await expect(popup).toHaveURL(/kauth\.kakao\.com/);
    await popup.close();
  });
});

// e2e/dashboard/dashboard.spec.ts
import { test, expect, TEST_USER } from '../fixtures/auth.fixture';
import { DashboardPage } from '../pages/dashboard.page';

test.describe('Dashboard', () => {
  test('should display welcome message after login', async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.expectWelcomeMessage(TEST_USER.name);
  });

  test('should redirect to login after logout', async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.logout();
    await expect(authenticatedPage).toHaveURL('/login');
  });

  test('should protect dashboard route', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
  });
});
```

## Unit Test (Vitest)

```typescript
// src/shared/lib/__tests__/utils.test.ts
import { describe, it, expect } from 'vitest';
import { cn, formatDate, formatCurrency } from '../utils';

describe('cn', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
  });

  it('should merge tailwind classes correctly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
```

## Backend Integration Test

```typescript
// backend/test/auth.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('should reject invalid password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrongpassword' })
        .expect(401);
    });
  });
});
```

## 테스트 실행 스크립트

```json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed"
  }
}
```

## testId 네이밍 컨벤션

```
Format: [feature]-[component]-[element]

Examples:
- login-email          (로그인 이메일 입력)
- login-submit         (로그인 제출 버튼)
- login-error          (로그인 에러 메시지)
- dashboard-welcome    (대시보드 환영 메시지)
- user-menu            (유저 메뉴 드롭다운)
- modal-close          (모달 닫기 버튼)
- post-list-item-{id}  (게시물 리스트 아이템)
```

## CI 테스트 Pipeline

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test:coverage

  e2e-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```
