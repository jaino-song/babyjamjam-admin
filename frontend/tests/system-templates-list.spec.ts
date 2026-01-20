import { test, expect, type Page, type Route, type Request } from '@playwright/test';

const templatesFixture = [
  {
    id: 'tpl-price',
    templateKey: 'PRICE_INFO',
    name: '비용 안내',
    description: '바우처 비용 안내 메시지',
    content: '비용 안내 메시지: {{name}}',
    requiredVariables: [
      {
        key: 'name',
        label: '이름',
        type: 'string',
        required: true,
      },
    ],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-greeting',
    templateKey: 'GREETING',
    name: '인사(소개)',
    description: '첫 인사 메시지',
    content: '안녕하세요!',
    requiredVariables: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-thanks',
    templateKey: 'THANKS',
    name: '감사',
    description: '감사 메시지',
    content: '감사합니다 {{name}}님',
    requiredVariables: [
      {
        key: 'name',
        label: '이름',
        type: 'string',
        required: true,
      },
    ],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-survey',
    templateKey: 'SURVEY',
    name: '설문',
    description: '설문 요청 메시지',
    content: '설문 부탁드립니다 {{name}}님',
    requiredVariables: [
      {
        key: 'name',
        label: '이름',
        type: 'string',
        required: true,
      },
    ],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-service',
    templateKey: 'SERVICE_INFO',
    name: '서비스 안내',
    description: '서비스 안내 메시지',
    content: '서비스 안내드립니다 {{name}}님',
    requiredVariables: [
      {
        key: 'name',
        label: '이름',
        type: 'string',
        required: true,
      },
    ],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-reminder',
    templateKey: 'REMINDER',
    name: '리마인더',
    description: '리마인더 메시지',
    content: '리마인더입니다 {{name}}님',
    requiredVariables: [
      {
        key: 'name',
        label: '이름',
        type: 'string',
        required: true,
      },
    ],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tpl-info',
    templateKey: 'INFO',
    name: '안내',
    description: '일반 안내 메시지',
    content: '안내드립니다',
    requiredVariables: [],
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  },
] as const;

function mockSystemTemplatesApi(page: Page) {
  return page.route('**/api/system-templates', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templatesFixture),
    });
  });
}

test.describe('System Templates List', () => {
  test('should display all 7 templates', async ({ page }) => {
    await mockSystemTemplatesApi(page);

    await page.goto('/messages/system-templates');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: '시스템 템플릿 관리' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '비용 안내' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '인사(소개)' })).toBeVisible();

    await expect(page.getByRole('button', { name: '편집' })).toHaveCount(7);
  });

  test('should navigate to editor on click', async ({ page }) => {
    await mockSystemTemplatesApi(page);

    await page.route('**/api/system-templates/PRICE_INFO', async (route: Route, request: Request) => {
      if (request.method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(templatesFixture[0]),
      });
    });

    await page.goto('/messages/system-templates');
    await page.getByRole('button', { name: '편집' }).first().click();

    await expect(page).toHaveURL(/\/messages\/system-templates\/PRICE_INFO/);
    await expect(page.getByRole('heading', { name: /비용 안내 편집/ })).toBeVisible();
  });
});
