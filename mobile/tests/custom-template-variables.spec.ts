import { test, expect, type Page, type Route, type Request } from '@playwright/test';

type CustomVariableFixture = {
  key: string;
  label: string;
  required: boolean;
};

type SystemTemplateFixture = {
  id: string;
  templateKey: 'SERVICE_INFO';
  name: string;
  description: string;
  content: string;
  requiredVariables: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
  }>;
  customVariables: CustomVariableFixture[];
  updatedAt: string;
};

const baseTemplateFixture: SystemTemplateFixture = {
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
  customVariables: [],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
};

const phoneVariable: CustomVariableFixture = {
  key: 'phone',
  label: '연락처',
  required: true,
};

const templateWithPhoneVariable: SystemTemplateFixture = {
  ...baseTemplateFixture,
  customVariables: [phoneVariable],
};

const templateWithPhoneContent: SystemTemplateFixture = {
  ...templateWithPhoneVariable,
  content: '서비스 안내드립니다 {{name}}님 연락처 {{phone}}',
};

async function mockSystemTemplateApi(
  page: Page,
  template: SystemTemplateFixture = baseTemplateFixture,
  onUpdate?: (body: { content?: string; customVariables?: CustomVariableFixture[] }) => void,
) {
  await page.route('**/api/system-templates/SERVICE_INFO', async (route: Route, request: Request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(template),
      });
    }

    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as {
        content?: string;
        customVariables?: CustomVariableFixture[];
      } | null;

      if (body) {
        onUpdate?.(body);
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...template,
          content: body?.content ?? template.content,
          customVariables: body?.customVariables ?? template.customVariables,
        }),
      });
    }

    return route.continue();
  });
}

test.describe('Custom Template Variables', () => {
  test('add custom variable in template editor', async ({ page }) => {
    await mockSystemTemplateApi(page, baseTemplateFixture);

    // #given - template editor is open
    await page.goto('/messages/system-templates/SERVICE_INFO');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '추가' }).first().click();
    const dialog = page.getByRole('dialog', { name: '커스텀 변수 관리' });
    await expect(dialog).toBeVisible();

    // #when - user adds a required custom variable
    await dialog.getByLabel('키 (영문/숫자)').fill('phone');
    await dialog.getByLabel('변수 명 (라벨)').fill('연락처');
     await dialog.getByRole('switch', { name: '필수 여부' }).click();
    await dialog.getByRole('button', { name: '추가' }).click();
    await dialog.getByRole('button', { name: '닫기' }).click();

    // #then - new custom variable chip is visible
    await expect(page.getByRole('button', { name: '연락처' })).toBeVisible();
  });

  test('save template with custom variables', async ({ page }) => {
    let savedPayload: { content?: string; customVariables?: CustomVariableFixture[] } | null = null;

    await mockSystemTemplateApi(page, templateWithPhoneVariable, (body) => {
      savedPayload = body;
    });

    // #given - template editor includes custom variables
    await page.goto('/messages/system-templates/SERVICE_INFO');
    await page.waitForLoadState('networkidle');

    // #when - user inserts custom variable and saves
    await page.getByRole('button', { name: '연락처' }).click();
    await page.getByRole('button', { name: '저장' }).click();

    // #then - save request includes custom variables
    await expect(page.getByText('저장되었습니다')).toBeVisible();
    await expect.poll(() => savedPayload).toMatchObject({
      customVariables: [phoneVariable],
    });
  });

   test('message form shows custom variable inputs', async ({ page }) => {
     await mockSystemTemplateApi(page, templateWithPhoneVariable);

     // #given - service info message form is open
     await page.goto('/messages');
     await page.waitForLoadState('networkidle');

     // Select service-info from dropdown
     await page.getByRole('combobox', { name: '' }).click();
     await page.getByRole('option', { name: /서비스 소개/ }).click();
     await page.waitForLoadState('networkidle');

     const nameInput = page.getByLabel('산모님 성함');
     const phoneInput = page.getByLabel('연락처');
     const generateButton = page.getByRole('button', { name: /생성|Generate/ });

     // #when - user fills only the name
     await expect(nameInput).toBeVisible();
     await expect(phoneInput).toBeVisible();
     await nameInput.fill('김철수');

    // #then - generate stays disabled until required custom input
    await expect(generateButton).toBeDisabled();

    // #when - user fills custom variable
    await phoneInput.fill('010-2222-3333');

    // #then - generate button becomes enabled
    await expect(generateButton).toBeEnabled();
  });

   test('generated message includes custom variable values', async ({ page }) => {
     await mockSystemTemplateApi(page, templateWithPhoneContent);

     // #given - service info message form is open with custom variables
     await page.goto('/messages');
     await page.waitForLoadState('networkidle');

     // Select service-info from dropdown
     await page.getByRole('combobox', { name: '' }).click();
     await page.getByRole('option', { name: /서비스 소개/ }).click();
     await page.waitForLoadState('networkidle');

     const nameInput = page.getByLabel('산모님 성함');
     const phoneInput = page.getByLabel('연락처');
     const generateButton = page.getByRole('button', { name: /생성|Generate/ });

     // Wait for form to fully render
     await expect(nameInput).toBeVisible();
     await expect(phoneInput).toBeVisible();

     // #when - user generates message with custom values
     await nameInput.fill('김철수');
    await phoneInput.fill('010-2222-3333');
    await generateButton.click();

    // #then - generated message includes custom variable values
    const messageField = page.getByRole('textbox').last();
    await expect(messageField).toHaveValue(/김철수/);
    await expect(messageField).toHaveValue(/010-2222-3333/);
  });
});
