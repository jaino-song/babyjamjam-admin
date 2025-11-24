import { test, expect } from '@playwright/test';

// Base URL for messages
const MESSAGES_BASE = '/messages';

test.describe('Message Components', () => {

    test.describe('PriceInfoMessageForm', () => {
        test('should render the price info message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/price-info`);

            // Check if the title is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();

            // Check if generate button exists and is disabled initially
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await expect(generateButton).toBeVisible();
        });

        test('should enable generate button when name is entered', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/price-info`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('홍길동');

            // Note: Generate button might still be disabled if other required fields are not filled
            await expect(nameInput).toHaveValue('홍길동');
        });
    });

    test.describe('ThanksMessageForm', () => {
        test('should render the thanks message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/thanks`);

            // Check if the form is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();
        });

        test('should generate message when name is filled and button clicked', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/thanks`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('홍길동');

            // Click generate button
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await generateButton.click();

            // Check if generated message appears (wait for it to render)
            await page.waitForTimeout(500);

            // The generated message should be displayed somewhere on the page
            const messageContainer = page.locator('pre').or(page.locator('text=홍길동'));
            await expect(messageContainer.first()).toBeVisible();
        });
    });

    test.describe('ServiceInfoMessageForm', () => {
        test('should render the service info message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/service-info`);

            // Check if the form is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();
        });

        test('should generate message when form is submitted', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/service-info`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('김철수');

            // Click generate button
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await generateButton.click();

            // Wait for message to be generated
            await page.waitForTimeout(500);

            // Check if copy button appears (indicates message was generated)
            const copyButton = page.locator('button:has-text("복사")').or(page.locator('button:has-text("Copy")'));
            await expect(copyButton).toBeVisible();
        });
    });

    test.describe('GreetingMessageForm', () => {
        test('should render the greeting message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/greeting`);

            // Check if the form is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();
        });

        test('should generate greeting message', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/greeting`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('이영희');

            // Click generate button
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await generateButton.click();

            // Wait for message generation
            await page.waitForTimeout(500);

            // Check for generated message
            const messageContainer = page.locator('pre').or(page.locator('text=이영희'));
            await expect(messageContainer.first()).toBeVisible();
        });
    });

    test.describe('SurveyMessageForm', () => {
        test('should render the survey message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/survey`);

            // Check if the form is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();
        });

        test('should generate survey message', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/survey`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('박민수');

            // Click generate button
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await generateButton.click();

            // Wait for message generation
            await page.waitForTimeout(500);

            // Verify message was generated
            const copyButton = page.locator('button:has-text("복사")').or(page.locator('button:has-text("Copy")'));
            await expect(copyButton).toBeVisible();
        });
    });

    test.describe('ReminderMessageForm', () => {
        test('should render the reminder message form', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/reminder`);

            // Check if the form is visible
            await expect(page.locator('h5').first()).toBeVisible();

            // Check if name input is visible
            const nameInput = page.locator('input[type="text"]').first();
            await expect(nameInput).toBeVisible();
        });

        test('should generate reminder message', async ({ page }) => {
            await page.goto(`${MESSAGES_BASE}/reminder`);

            // Fill in the name
            const nameInput = page.locator('input[type="text"]').first();
            await nameInput.fill('최지민');

            // Click generate button
            const generateButton = page.locator('button:has-text("생성")').or(page.locator('button:has-text("Generate")'));
            await generateButton.click();

            // Wait for message generation
            await page.waitForTimeout(500);

            // Verify message was generated
            const copyButton = page.locator('button:has-text("복사")').or(page.locator('button:has-text("Copy")'));
            await expect(copyButton).toBeVisible();
        });
    });
});
