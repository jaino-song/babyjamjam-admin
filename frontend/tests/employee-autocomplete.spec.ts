import { test, expect } from '@playwright/test';
import { E2E_EMPLOYEES, fillRequiredClientFields, goToNextStep, openClientForm } from './helpers/client-form';

/**
 * EmployeeAutocomplete Component Tests
 *
 * The picker lives on step 2 (제공인력 정보) of the "새 고객 등록" panel. These tests verify:
 * - Real-time search filtering
 * - "새 제공인력 등록" is always offered in the dropdown
 * - The typed name prefills the nested employee registration dialog
 */

test.describe('EmployeeAutocomplete', () => {
    // Open the new-client form and move to the employee step before each test.
    test.beforeEach(async ({ page }) => {
        const panel = await openClientForm(page);
        await fillRequiredClientFields(panel);
        await goToNextStep(panel);
        await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toBeVisible();
    });

    test('shows the primary and secondary pickers on the employee step', async ({ page }) => {
        await expect(page.getByRole('combobox', { name: '주 담당 인력', exact: true })).toBeVisible();
        await expect(page.getByRole('combobox', { name: '보조 담당 인력', exact: true })).toBeVisible();
    });

    test('opens the dropdown on click and always offers "새 제공인력 등록"', async ({ page }) => {
        await page.getByRole('combobox', { name: '주 담당 인력', exact: true }).click();

        await expect(page.getByRole('combobox', { name: '주 담당 인력 검색' })).toBeVisible();
        await expect(page.getByRole('button', { name: '새 제공인력 등록' })).toBeVisible();
    });

    test('filters employees when typing in the search', async ({ page }) => {
        await page.getByRole('combobox', { name: '주 담당 인력', exact: true }).click();
        await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill('김');

        // Both 김-prefixed employees match, 이도우 does not.
        await expect(page.getByRole('option', { name: /김제공/ })).toBeVisible();
        await expect(page.getByRole('option', { name: /김보조/ })).toBeVisible();
        await expect(page.getByRole('option', { name: /이도우/ })).toHaveCount(0);

        // The register button stays available next to search results.
        await expect(page.getByRole('button', { name: '새 제공인력 등록' })).toBeVisible();
    });

    test('selects an employee and shows the name on the picker', async ({ page }) => {
        const primary = page.getByRole('combobox', { name: '주 담당 인력', exact: true });
        await primary.click();
        await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill(E2E_EMPLOYEES[2].name);
        await page.getByRole('option', { name: new RegExp(E2E_EMPLOYEES[2].name) }).click();

        await expect(primary).toContainText(E2E_EMPLOYEES[2].name);
    });

    test('opens the employee registration dialog with the typed name prefilled', async ({ page }) => {
        const testName = '테스트직원';
        await page.getByRole('combobox', { name: '주 담당 인력', exact: true }).click();
        await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill(testName);

        await page.getByRole('button', { name: '새 제공인력 등록' }).click();

        const dialog = page.getByRole('dialog', { name: '새 제공인력 등록' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel('이름*')).toHaveValue(testName);
    });

    test('keeps "새 제공인력 등록" visible even when no employee matches', async ({ page }) => {
        await page.getByRole('combobox', { name: '주 담당 인력', exact: true }).click();
        await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill('존재하지않는이름xyz123');

        await expect(page.getByText('일치하는 제공인력이 없습니다.')).toBeVisible();
        await expect(page.getByRole('button', { name: '새 제공인력 등록' })).toBeVisible();
    });
});
