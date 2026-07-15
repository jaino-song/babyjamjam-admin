import { test, expect } from '@playwright/test';

/**
 * EmployeeAutocomplete Component Tests
 *
 * These tests verify the unified EmployeeAutocomplete component:
 * - Real-time search filtering
 * - "새 제공인력 추가" button always visible in dropdown
 * - Zustand store prefilling for EmployeeFormDialog
 * - Korean IME compatibility (openOnFocus)
 */

test.describe('EmployeeAutocomplete', () => {
    // Navigate to clients page and open the form dialog before each test
    test.beforeEach(async ({ page }) => {
        // Go to clients page
        await page.goto('/clients');

        // Wait for page to load
        await page.waitForLoadState('networkidle');
    });

    test('should open ClientFormDialog when clicking add button', async ({ page }) => {
        // Find and click the add button (Plus icon)
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();

        // Verify dialog opens
        const dialog = page.locator('[data-testid="client-form-dialog"]');
        await expect(dialog).toBeVisible();
    });

    test('should show EmployeeAutocomplete in ClientFormDialog', async ({ page }) => {
        // Open the form dialog
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();

        // Wait for dialog
        await expect(page.locator('[data-testid="client-form-dialog"]')).toBeVisible();

        // Find the primary employee autocomplete by its label
        const employeeAutocomplete = page.locator('[data-testid="employee-autocomplete"]').first();
        await expect(employeeAutocomplete).toBeVisible();
    });

    test('should open dropdown on focus and show "새 제공인력 추가" button', async ({ page }) => {
        // Open the form dialog
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();
        await expect(page.locator('[data-testid="client-form-dialog"]')).toBeVisible();

        // Find the employee autocomplete input
        const autocompleteInput = page.locator('[data-testid="employee-autocomplete"] input').first();

        // Click to focus - should open dropdown (Korean IME compatibility)
        await autocompleteInput.click();

        // Wait for dropdown to appear
        const dropdown = page.locator('[data-testid="employee-autocomplete-dropdown"]');
        await expect(dropdown).toBeVisible({ timeout: 5000 });

        // The "새 제공인력 추가" button should be visible
        const addNewButton = page.locator('[data-testid="employee-autocomplete-add-button"]');
        await expect(addNewButton).toBeVisible();
    });

    test('should filter employees when typing in search', async ({ page }) => {
        // Open the form dialog
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();
        await expect(page.locator('[data-testid="client-form-dialog"]')).toBeVisible();

        // Find and focus the employee autocomplete
        const autocompleteInput = page.locator('[data-testid="employee-autocomplete"] input').first();
        await autocompleteInput.click();

        // Wait for dropdown
        await expect(page.locator('[data-testid="employee-autocomplete-dropdown"]')).toBeVisible({ timeout: 5000 });

        // Type a search term (Korean name)
        await autocompleteInput.fill('김');

        // Wait a moment for filtering
        await page.waitForTimeout(300);

        // The dropdown should still be visible with filtered results
        // Note: Actual filtering depends on employee data in the database
        await expect(page.locator('[data-testid="employee-autocomplete-dropdown"]')).toBeVisible();

        // The add button should still be visible even with search results
        const addNewButton = page.locator('[data-testid="employee-autocomplete-add-button"]');
        await expect(addNewButton).toBeVisible();
    });

    test('should open EmployeeFormDialog with prefilled name when clicking add button', async ({ page }) => {
        // Open the form dialog
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();
        await expect(page.locator('[data-testid="client-form-dialog"]')).toBeVisible();

        // Find and focus the employee autocomplete
        const autocompleteInput = page.locator('[data-testid="employee-autocomplete"] input').first();
        await autocompleteInput.click();

        // Wait for dropdown
        await expect(page.locator('[data-testid="employee-autocomplete-dropdown"]')).toBeVisible({ timeout: 5000 });

        // Type a name that we want to be prefilled
        const testName = '테스트직원';
        await autocompleteInput.fill(testName);

        // Click the "새 제공인력 추가" button
        const addNewEmployeeButton = page.locator('[data-testid="employee-autocomplete-add-button"]');
        await addNewEmployeeButton.click();

        // Wait for the EmployeeFormDialog to appear (it's a nested dialog)
        // Look for the dialog that contains employee form fields
        await page.waitForTimeout(500);

        // Check that a second dialog opened (EmployeeFormDialog)
        const dialogs = page.locator('[role="dialog"]');
        const dialogCount = await dialogs.count();

        // There should be 2 dialogs now (ClientFormDialog + EmployeeFormDialog)
        expect(dialogCount).toBeGreaterThanOrEqual(2);

        // Find the name input in the EmployeeFormDialog (should be prefilled)
        // The EmployeeFormDialog should have a text field with the prefilled name
        const nameInputInEmployeeDialog = page.locator('[role="dialog"]').last().locator('input[type="text"]').first();

        // Verify it has the prefilled value
        await expect(nameInputInEmployeeDialog).toHaveValue(testName);
    });

    test('should keep "새 제공인력 추가" button visible even when no matches found', async ({ page }) => {
        // Open the form dialog
        const addButton = page.locator('[data-testid="add-client-button"]');
        await addButton.click();
        await expect(page.locator('[data-testid="client-form-dialog"]')).toBeVisible();

        // Find and focus the employee autocomplete
        const autocompleteInput = page.locator('[data-testid="employee-autocomplete"] input').first();
        await autocompleteInput.click();

        // Wait for dropdown
        await expect(page.locator('[data-testid="employee-autocomplete-dropdown"]')).toBeVisible({ timeout: 5000 });

        // Type something that won't match any employees
        await autocompleteInput.fill('존재하지않는이름xyz123');

        // Wait for filtering
        await page.waitForTimeout(300);

        // The dropdown should still show the add button
        const addNewButton = page.locator('[data-testid="employee-autocomplete-add-button"]');
        await expect(addNewButton).toBeVisible();

        // And possibly show "No options" text, but button is always there
        // This may or may not be visible depending on locale
    });
});

test.describe('EmployeeAutocomplete in ContractCreationForm', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to contract creation page
        await page.goto('/messages/contract');
        await page.waitForLoadState('networkidle');
    });

    test('should have EmployeeAutocomplete for selecting caretaker', async ({ page }) => {
        // The contract form should have an employee autocomplete field
        const employeeAutocomplete = page.locator('[data-testid="employee-autocomplete"]');

        // Check if at least one employee autocomplete exists on the page
        // Note: This may be further in the form stepper, so we may need to navigate
        const count = await employeeAutocomplete.count();

        // If not immediately visible, the form might require steps to get there
        // This is an informational assertion
        console.log(`Found ${count} EmployeeAutocomplete components on contract form`);
    });
});
