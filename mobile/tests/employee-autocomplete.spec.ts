import { expect, test } from '@playwright/test';

test.describe('EmployeeAutocomplete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/clients/new');
    await expect(page.locator('[data-component="clients-new-page-shell"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test('renders employee autocompletes on the client creation wizard', async ({ page }) => {
    const employeeAutocompletes = page.getByTestId('employee-autocomplete');

    await expect(employeeAutocompletes.first()).toBeVisible();
    await expect(employeeAutocompletes).toHaveCount(2);
  });

  test('opens the dropdown on focus and keeps the manual-entry action visible', async ({ page }) => {
    const autocompleteInput = page.getByTestId('employee-autocomplete').first().locator('input');

    await autocompleteInput.click();

    await expect(page.locator('[data-component="employee-autocomplete-dropdown"]').first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('[data-component="employee-autocomplete-add-button"]').first()).toBeVisible();
  });

  test('keeps the manual-entry action visible while filtering', async ({ page }) => {
    const autocompleteInput = page.getByTestId('employee-autocomplete').first().locator('input');

    await autocompleteInput.click();
    await expect(page.locator('[data-component="employee-autocomplete-dropdown"]').first()).toBeVisible({
      timeout: 5000,
    });

    await autocompleteInput.fill('김');

    await expect(page.locator('[data-component="employee-autocomplete-dropdown"]').first()).toBeVisible();
    await expect(page.locator('[data-component="employee-autocomplete-add-button"]').first()).toBeVisible();
  });

  test('opens the employee dialog with the typed name prefilled', async ({ page }) => {
    const autocompleteInput = page.getByTestId('employee-autocomplete').first().locator('input');
    const typedName = '테스트직원';

    await autocompleteInput.click();
    await expect(page.locator('[data-component="employee-autocomplete-dropdown"]').first()).toBeVisible({
      timeout: 5000,
    });

    await autocompleteInput.fill(typedName);
    await page.locator('[data-component="employee-autocomplete-add-button"]').first().click();

    const employeeDialog = page.locator('[data-component="employees-form-dialog"]');
    await expect(employeeDialog).toBeVisible({ timeout: 5000 });
    await expect(employeeDialog.locator('#name')).toHaveValue(typedName);
  });
});
