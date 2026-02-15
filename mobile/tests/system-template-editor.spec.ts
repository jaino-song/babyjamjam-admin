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
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(templateFixture),
      });
    }

    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { content?: string } | null;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...templateFixture, content: body?.content ?? templateFixture.content }),
      });
    }

    return route.continue();
  });
}

test.describe('System Template Editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockTemplateApi(page);
    await page.goto('/messages/system-templates/THANKS');
    await page.waitForLoadState('networkidle');
  });

  test('should display template content', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /감사 편집/ })).toBeVisible();

    const editor = page.getByRole('textbox');
    await expect(editor).toHaveValue(templateFixture.content);
  });

  test('should show variable toolbar', async ({ page }) => {
    await expect(page.getByText('변수 삽입')).toBeVisible();
    await expect(page.getByRole('button', { name: '이름' })).toBeVisible();
  });

  test('should insert variable on click', async ({ page }) => {
    const editor = page.getByRole('textbox');
    await editor.fill('');

    await page.getByRole('button', { name: '이름' }).click();
    await expect(editor).toHaveValue('{{name}}');
  });

  test('should show validation errors', async ({ page }) => {
    const editor = page.getByRole('textbox');
    await editor.fill('감사합니다');

    const errorAlert = page.locator('.MuiAlert-root[role="alert"]').filter({ hasText: '필수 변수 누락: {{name}}' });
    await expect(errorAlert).toBeVisible();
  });

  test('should disable save when invalid', async ({ page }) => {
    const editor = page.getByRole('textbox');
    await editor.fill('감사합니다');

    const saveButton = page.getByRole('button', { name: '저장' });
    await expect(saveButton).toBeDisabled();
  });

  test('should save and show success', async ({ page }) => {
    const saveButton = page.getByRole('button', { name: '저장' });
    await expect(saveButton).toBeEnabled();

    await saveButton.click();
    await expect(page.getByText('저장되었습니다')).toBeVisible();
  });
});
