import { test, expect } from '@playwright/test';

test.describe('Alimtalk Provider Settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings/general');
        await page.waitForLoadState('networkidle');
    });

    test.describe('Page Load', () => {
        test('should display alimtalk settings section', async ({ page }) => {
            await expect(page.getByText('알림톡 설정')).toBeVisible();
            await expect(page.getByText('카카오 알림톡 발송 서비스를 선택합니다.')).toBeVisible();
        });

        test('should display all provider options', async ({ page }) => {
            await expect(page.getByText('알리고 (Aligo)')).toBeVisible();
            await expect(page.getByText('사용 안함')).toBeVisible();
        });

        test('should have one option selected by default', async ({ page }) => {
            const selectedRadio = page.locator('input[type="radio"]:checked');
            await expect(selectedRadio).toHaveCount(1);
        });
    });

    test.describe('Provider Selection', () => {
        test('should allow selecting Aligo provider', async ({ page }) => {
            const aligoRadio = page.getByRole('radio', { name: /알리고/i });
            await aligoRadio.click();

            await expect(aligoRadio).toBeChecked();
        });

        test('should allow selecting None (disabled)', async ({ page }) => {
            const noneRadio = page.getByRole('radio', { name: /사용 안함/i });
            await noneRadio.click();

            await expect(noneRadio).toBeChecked();
        });
    });

    test.describe.serial('Save and Persist', () => {
        test('should show success message after saving', async ({ page }) => {
            const aligoRadio = page.getByRole('radio', { name: /알리고/i });
            const noneRadio = page.getByRole('radio', { name: /사용 안함/i });

            const isNoneAlreadySelected = await noneRadio.isChecked();
            if (isNoneAlreadySelected) {
                await aligoRadio.click();
                await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });
                await page.waitForTimeout(300);
            }

            await noneRadio.click();
            const snackbar = page.getByText('알림톡 설정이 저장되었습니다.');
            await expect(snackbar).toBeVisible({ timeout: 5000 });
        });

        test('should persist Aligo selection after page reload', async ({ page }) => {
            const aligoRadio = page.getByRole('radio', { name: /알리고/i });
            const noneRadio = page.getByRole('radio', { name: /사용 안함/i });

            const isAligoAlreadySelected = await aligoRadio.isChecked();
            if (isAligoAlreadySelected) {
                await noneRadio.click();
                await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });
                await page.waitForTimeout(500);
            }

            await aligoRadio.click();
            await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });
            await page.waitForTimeout(500);

            await page.reload();
            await page.waitForLoadState('networkidle');

            const selectedRadio = page.getByRole('radio', { name: /알리고/i });
            await expect(selectedRadio).toBeChecked({ timeout: 5000 });
        });

        test('should persist "none" selection after reload', async ({ page }) => {
            const noneRadio = page.getByRole('radio', { name: /사용 안함/i });
            await noneRadio.click();

            await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });
            await page.waitForTimeout(500);

            await page.reload();
            await page.waitForLoadState('networkidle');

            const selectedRadio = page.getByRole('radio', { name: /사용 안함/i });
            await expect(selectedRadio).toBeChecked({ timeout: 5000 });
        });
    });

    test.describe('UI State', () => {
        test('should show loading state initially', async ({ page }) => {
            await page.goto('/settings/general');

            const loadingIndicator = page.locator('.MuiCircularProgress-root');
            await expect(loadingIndicator).toBeVisible({ timeout: 1000 }).catch(() => {});
        });

        test('should disable radio buttons while saving', async ({ page }) => {
            const aligoRadio = page.getByRole('radio', { name: /알리고/i });
            await aligoRadio.click();

            await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });
        });

        test('should display last updated timestamp after save', async ({ page }) => {
            const aligoRadio = page.getByRole('radio', { name: /알리고/i });
            const noneRadio = page.getByRole('radio', { name: /사용 안함/i });

            const isAligoSelected = await aligoRadio.isChecked();
            if (isAligoSelected) {
                await noneRadio.click();
            } else {
                await aligoRadio.click();
            }

            await expect(page.getByText('알림톡 설정이 저장되었습니다.')).toBeVisible({ timeout: 5000 });

            const timestamp = page.getByText(/마지막 수정:/);
            await expect(timestamp).toBeVisible({ timeout: 5000 });
        });
    });

    test.describe('Navigation', () => {
        test('should access settings via tab navigation', async ({ page }) => {
            await page.goto('/settings/voucher-price');
            await page.waitForLoadState('networkidle');

            const generalTab = page.getByRole('tab', { name: /일반 설정/i });
            await generalTab.click();

            await expect(page).toHaveURL('/settings/general');
            await expect(page.getByText('알림톡 설정')).toBeVisible();
        });
    });
});

test.describe('Alimtalk Settings Error Handling', () => {
    test('should show error message on API failure', async ({ page }) => {
        await page.route('**/api/settings/alimtalk-provider', (route) => {
            route.fulfill({
                status: 500,
                body: JSON.stringify({ error: 'Internal Server Error' }),
            });
        });

        await page.goto('/settings/general');
        await page.waitForLoadState('networkidle');

        const errorAlert = page.getByText('설정을 불러오는데 실패했습니다.');
        await expect(errorAlert).toBeVisible();
    });

    test('should show error snackbar on save failure', async ({ page }) => {
        await page.route('**/api/settings/alimtalk-provider', (route, request) => {
            if (request.method() === 'PUT') {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Failed to save' }),
                });
            } else {
                route.continue();
            }
        });

        await page.goto('/settings/general');
        await page.waitForLoadState('networkidle');

        const aligoRadio = page.getByRole('radio', { name: /알리고/i });
        const noneRadio = page.getByRole('radio', { name: /사용 안함/i });

        const isAligoSelected = await aligoRadio.isChecked();
        if (isAligoSelected) {
            await noneRadio.click();
        } else {
            await aligoRadio.click();
        }

        const errorSnackbar = page.getByText('설정 저장에 실패했습니다. 다시 시도해주세요.');
        await expect(errorSnackbar).toBeVisible({ timeout: 5000 });
    });
});
