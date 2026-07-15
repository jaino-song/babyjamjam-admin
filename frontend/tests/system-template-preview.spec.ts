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

async function mockTemplateApi(page: Page) {
  await page.route('**/api/system-templates/THANKS', async (route: Route, request: Request) => {
    if (request.method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(templateFixture),
    });
  });
}

test.describe('System Template Preview', () => {
  test.beforeEach(async ({ page }) => {
    await mockTemplateApi(page);
    await page.goto('/messages/system-templates/THANKS');
    await page.waitForLoadState('networkidle');
  });

  test('should display preview with sample data', async ({ page }) => {
    await expect(page.getByText('미리보기')).toBeVisible();
    await expect(page.getByText('홍길동')).toBeVisible();
  });

  test('should update preview in real-time', async ({ page }) => {
    const editor = page.getByRole('textbox');
    await editor.fill('테스트 {{name}}');

    await expect(page.getByText('테스트 홍길동')).toBeVisible();
  });
});
