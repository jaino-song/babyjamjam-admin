import { test, expect, type Page, type Route, type Request } from '@playwright/test';

const templateFixture = {
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
} as const;

const versionsFixture = [
  {
    versionNumber: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    createdBy: 'tester',
  },
  {
    versionNumber: 2,
    createdAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
    createdBy: 'tester',
  },
] as const;

async function mockVersionsApi(page: Page) {
  await page.route('**/api/system-templates/THANKS', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templateFixture),
    });
  });

  await page.route('**/api/system-templates/THANKS/versions', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(versionsFixture),
    });
  });

  await page.route('**/api/system-templates/THANKS/rollback/*', async (route: Route, request: Request) => {
    if (request.method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templateFixture),
    });
  });
}

test.describe('System Template Versions', () => {
  test.beforeEach(async ({ page }) => {
    await mockVersionsApi(page);
    await page.goto('/messages/system-templates/THANKS');
    await page.waitForLoadState('networkidle');
  });

  test('should show version history', async ({ page }) => {
    await page.getByRole('button', { name: '버전 기록' }).click();

    await expect(page.getByText('버전 1')).toBeVisible();
    await expect(page.getByText('버전 2')).toBeVisible();
  });

  test('should rollback with confirmation', async ({ page }) => {
    await page.getByRole('button', { name: '버전 기록' }).click();

    await page.getByTitle('이 버전으로 복원').first().click();

    await expect(page.getByRole('heading', { name: '버전 복원' })).toBeVisible();
    await expect(page.getByText('복원하시겠습니까?')).toBeVisible();

    await page.getByRole('button', { name: '복원' }).click();

    await expect(page.getByRole('heading', { name: '버전 복원' })).not.toBeVisible();
    await expect(page.getByText('버전 1')).not.toBeVisible();
  });
});
