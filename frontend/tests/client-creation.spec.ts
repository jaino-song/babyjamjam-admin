import { test, expect } from '@playwright/test';
import {
    clientFormPanel,
    E2E_EMPLOYEES,
    E2E_VOUCHER_PRICE,
    E2E_VOUCHER_TYPE,
    fillRequiredClientFields,
    goToNextStep,
    openClientForm,
} from './helpers/client-form';

/**
 * Client creation form E2E tests.
 *
 * "고객 추가" opens a four-step panel on /clients:
 *   1. 이용자 정보  2. 제공인력 정보  3. 바우처 정보  4. 계약 정보
 * Field problems are shown in each field's label-row slot (`data-slot="field-error-message"`),
 * not in a top alert. All lookups (prices, areas, employees, holidays) are mocked in
 * ./helpers/client-form so the specs do not depend on seeded data.
 */

test.describe('Client Creation Flow', () => {
    // ============================================
    // Panel Open/Close
    // ============================================
    test.describe('Panel Opening', () => {
        test('opens the new-client form panel with the four steps', async ({ page }) => {
            const panel = await openClientForm(page);

            await expect(panel.getByText('고객의 기본 정보와 서비스 조건을 단계별로 입력합니다.')).toBeVisible();
            for (const step of ['이용자 정보', '제공인력 정보', '바우처 정보', '계약 정보']) {
                await expect(panel.getByText(step, { exact: true })).toBeVisible();
            }

            // Step 1 shows the identity fields.
            for (const label of ['이름*', '생년월일*', '연락처*', '주소*']) {
                await expect(panel.getByLabel(label)).toBeVisible();
            }
        });

        test('closes the panel when clicking cancel', async ({ page }) => {
            const panel = await openClientForm(page);

            await panel.getByRole('button', { name: '취소' }).click();

            await expect(panel.getByRole('heading', { name: '새 고객 등록' })).toHaveCount(0);
        });
    });

    // ============================================
    // Form Validation
    // ============================================
    test.describe('Form Validation', () => {
        test('shows a label-row error for every missing required field and stays on step 1', async ({ page }) => {
            const panel = await openClientForm(page);

            await goToNextStep(panel);

            const fieldErrors = panel.locator('[data-slot="field-error-message"]');
            await expect(fieldErrors.first()).toBeVisible();
            // 이름, 생년월일, 연락처, 주소 are required.
            await expect(fieldErrors).toHaveCount(4);

            // Still on step 1: the identity inputs are on screen, the employee step is not.
            await expect(panel.getByLabel('이름*')).toBeVisible();
            await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toHaveCount(0);
        });

        test('keeps the remaining required fields flagged after filling only the name', async ({ page }) => {
            const panel = await openClientForm(page);

            await panel.getByLabel('이름*').fill('테스트 산모');
            await goToNextStep(panel);

            const fieldErrors = panel.locator('[data-slot="field-error-message"]');
            await expect(fieldErrors).toHaveCount(3);
            await expect(panel.getByLabel('이름*')).toHaveValue('테스트 산모');
            await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toHaveCount(0);
        });

        test('shows the phone format hint when the number is incomplete', async ({ page }) => {
            const panel = await openClientForm(page);

            await panel.getByLabel('연락처*').fill('0101234');
            await goToNextStep(panel);

            await expect(panel.locator('[data-slot="field-error-message"]', { hasText: '010-1234-5678로 입력해 주세요' })).toBeVisible();
        });
    });

    // ============================================
    // Step 1: Basic Info
    // ============================================
    test.describe('Basic Info Step', () => {
        test('accepts name input', async ({ page }) => {
            const panel = await openClientForm(page);

            const nameInput = panel.getByLabel('이름*');
            await nameInput.fill('홍길동');
            await expect(nameInput).toHaveValue('홍길동');
        });

        test('formats birthday as YYYY-MM-DD', async ({ page }) => {
            const panel = await openClientForm(page);

            // Birthday is typed as digits; hyphens are inserted automatically.
            const birthdayInput = panel.getByLabel('생년월일*');
            await birthdayInput.fill('19900515');
            await expect(birthdayInput).toHaveValue('1990-05-15');

            // Extra digits are not accepted beyond YYYY-MM-DD.
            await birthdayInput.fill('199005151234');
            const value = await birthdayInput.inputValue();
            expect(value.length).toBeLessThanOrEqual(10);
        });

        test('formats the phone number as XXX-XXXX-XXXX', async ({ page }) => {
            const panel = await openClientForm(page);

            const phoneInput = panel.getByLabel('연락처*');
            await phoneInput.fill('01012345678');

            await expect(phoneInput).toHaveValue('010-1234-5678');
        });

        test('accepts address input', async ({ page }) => {
            const panel = await openClientForm(page);

            const addressInput = panel.getByLabel('주소*');
            await addressInput.fill('인천광역시 연수구 테스트동 123');

            await expect(addressInput).toHaveValue('인천광역시 연수구 테스트동 123');
        });

        test('offers the branch areas in the area select', async ({ page }) => {
            const panel = await openClientForm(page);

            const area = panel.getByRole('combobox', { name: '관할 지역' });
            await expect(area.getByRole('option', { name: '인천' })).toHaveCount(1);
            await area.selectOption({ label: '인천' });
            await expect(area).toHaveValue('area-incheon');
        });

        test('advances to the employee step once the required fields are filled and goes back', async ({ page }) => {
            const panel = await openClientForm(page);

            await fillRequiredClientFields(panel);
            await goToNextStep(panel);

            await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toBeVisible();

            await panel.getByRole('button', { name: '이전' }).click();
            // Earlier answers are kept.
            await expect(panel.getByLabel('이름*')).toHaveValue('테스트 산모');
            await expect(panel.getByLabel('연락처*')).toHaveValue('010-1234-5678');
        });
    });

    // ============================================
    // Step 2: Employee Selection
    // ============================================
    test.describe('Employee Selection', () => {
        test.beforeEach(async ({ page }) => {
            const panel = await openClientForm(page);
            await fillRequiredClientFields(panel);
            await goToNextStep(panel);
            await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toBeVisible();
        });

        test('has primary and secondary employee pickers', async ({ page }) => {
            const panel = clientFormPanel(page);

            await expect(panel.getByRole('combobox', { name: '주 담당 인력', exact: true })).toBeVisible();
            await expect(panel.getByRole('combobox', { name: '보조 담당 인력', exact: true })).toBeVisible();
            await expect(panel.locator('[data-testid="employee-autocomplete"]')).toHaveCount(2);
        });

        test('excludes the selected primary employee from the secondary options', async ({ page }) => {
            const primary = page.getByRole('combobox', { name: '주 담당 인력', exact: true });
            await primary.click();
            await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill('김');
            await page.getByRole('option', { name: /김제공/ }).click();
            await expect(primary).toContainText('김제공');

            const secondary = page.getByRole('combobox', { name: '보조 담당 인력', exact: true });
            await secondary.click();
            await page.getByRole('combobox', { name: '보조 담당 인력 검색' }).fill('김');

            // 김보조 still matches, 김제공 (already the primary) does not.
            await expect(page.getByRole('option', { name: /김보조/ })).toBeVisible();
            await expect(page.getByRole('option', { name: /김제공/ })).toHaveCount(0);
        });
    });

    // ============================================
    // Step 3: Voucher / Pricing
    // ============================================
    test.describe('Voucher Step', () => {
        test.beforeEach(async ({ page }) => {
            const panel = await openClientForm(page);
            await fillRequiredClientFields(panel);
            await goToNextStep(panel);
            await goToNextStep(panel);
            await expect(panel.getByRole('tablist', { name: '고객 유형' })).toBeVisible();
        });

        test('defaults to a self-pay client with out-of-pocket durations', async ({ page }) => {
            await expect(page.getByRole('tab', { name: '자부담 고객' })).toHaveAttribute('aria-selected', 'true');
            await expect(page.getByRole('tab', { name: '바우처 고객' })).toHaveAttribute('aria-selected', 'false');

            const duration = page.getByRole('combobox', { name: '서비스 기간' });
            await expect(duration.getByRole('option', { name: '1주 (5일)' })).toHaveCount(1);
            await expect(duration.getByRole('option', { name: '2주 (10일)' })).toHaveCount(1);

            await duration.selectOption({ label: '2주 (10일)' });
            await expect(page.getByLabel('총 서비스 금액')).toHaveValue('1,620,000');
        });

        test('keeps the duration locked until a voucher type is chosen, then auto-fills the prices', async ({ page }) => {
            await page.getByRole('tab', { name: '바우처 고객' }).click();

            const type = page.getByRole('combobox', { name: '바우처 유형' });
            const duration = page.getByRole('combobox', { name: '서비스 기간' });
            await expect(type).toBeVisible();
            // Voucher types are grouped (예: 단태아 첫째아).
            await expect(type.locator('optgroup').first()).toBeAttached();
            await expect(duration).toBeDisabled();

            await type.selectOption({ label: E2E_VOUCHER_TYPE });
            await expect(duration).toBeEnabled();
            // Voucher durations come from the price table for the chosen type.
            await expect(duration.getByRole('option', { name: '10일' })).toHaveCount(1);
            await duration.selectOption({ label: '10일' });

            // Prices come from the voucher price table for that type and duration.
            await expect(page.getByLabel('총 서비스 금액')).toHaveValue('1,000,000');
            await expect(page.getByLabel('정부지원금')).toHaveValue('700,000');
            await expect(page.getByLabel('본인부담금')).toHaveValue('300,000');
        });

        test('lets the user override an auto-filled price', async ({ page }) => {
            await page.getByRole('tab', { name: '바우처 고객' }).click();
            await page.getByRole('combobox', { name: '바우처 유형' }).selectOption({ label: E2E_VOUCHER_TYPE });
            await page.getByRole('combobox', { name: '서비스 기간' }).selectOption({ label: '10일' });

            const fullPrice = page.getByLabel('총 서비스 금액');
            await expect(fullPrice).toHaveValue('1,000,000');
            await fullPrice.fill('1200000');

            await expect(fullPrice).toHaveValue('1,200,000');
        });
    });

    // ============================================
    // Step 4: Contract Info
    // ============================================
    test.describe('Contract Step', () => {
        test.beforeEach(async ({ page }) => {
            const panel = await openClientForm(page);
            await fillRequiredClientFields(panel);
            for (let step = 0; step < 3; step += 1) {
                await goToNextStep(panel);
            }
            await expect(panel.getByRole('combobox', { name: '계약 상태' })).toBeVisible();
        });

        test('formats the start and end dates as YYYY-MM-DD', async ({ page }) => {
            const startDate = page.getByLabel('시작일');
            await startDate.fill('20261201');
            await expect(startDate).toHaveValue('2026-12-01');

            const endDate = page.getByLabel('종료일');
            await endDate.fill('20261219');
            await expect(endDate).toHaveValue('2026-12-19');
        });

        test('offers every service status', async ({ page }) => {
            const status = page.getByRole('combobox', { name: '계약 상태' });

            await expect(status.getByRole('option')).toHaveText([
                '계약 상태',
                '예약 전',
                '대기',
                '교체 요청',
                '진행중',
                '완료',
                '중단',
            ]);
            await expect(status).toHaveValue('pre_booking');
        });

        test('toggles the optional service flags', async ({ page }) => {
            const careCenter = page.getByRole('switch', { name: '산후조리원' });
            const breastPump = page.getByRole('switch', { name: '유축기 대여' });
            const automation = page.getByRole('switch', { name: '메시지 자동 전송' });

            await expect(careCenter).not.toBeChecked();
            await expect(breastPump).not.toBeChecked();
            // Message automation is on by default for a new client.
            await expect(automation).toBeChecked();

            await careCenter.click();
            await breastPump.click();
            await automation.click();

            await expect(careCenter).toBeChecked();
            await expect(breastPump).toBeChecked();
            await expect(automation).not.toBeChecked();
        });
    });
});

// ============================================
// Complete Client Creation Flow Test
// ============================================
test.describe('Complete Client Creation Flow', () => {
    test('creates a client with the filled-in values', async ({ page }) => {
        let createdBody: Record<string, unknown> | null = null;
        await page.route('**/api/clients', async (route) => {
            if (route.request().method() !== 'POST') {
                await route.fallback();
                return;
            }
            createdBody = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ id: 901, ...createdBody }),
            });
        });

        const panel = await openClientForm(page);
        await fillRequiredClientFields(panel);
        await goToNextStep(panel);

        // Step 2: primary employee
        await panel.getByRole('combobox', { name: '주 담당 인력', exact: true }).click();
        await page.getByRole('combobox', { name: '주 담당 인력 검색' }).fill('김제공');
        await page.getByRole('option', { name: /김제공/ }).click();
        await goToNextStep(panel);

        // Step 3: voucher client with type + duration
        await panel.getByRole('tab', { name: '바우처 고객' }).click();
        await panel.getByRole('combobox', { name: '바우처 유형' }).selectOption({ label: E2E_VOUCHER_TYPE });
        await panel.getByRole('combobox', { name: '서비스 기간' }).selectOption({ label: '10일' });
        await goToNextStep(panel);

        // Step 4: service dates (10 business days, Mon 2026-12-07 .. Fri 2026-12-18)
        await panel.getByLabel('시작일').fill('20261207');
        await panel.getByLabel('종료일').fill('20261218');
        await panel.getByRole('button', { name: '생성' }).click();

        await expect.poll(() => createdBody).not.toBeNull();
        expect(createdBody).toMatchObject({
            name: '테스트 산모',
            birthday: '1990-05-15',
            phone: '010-1234-5678',
            address: '인천광역시 연수구 테스트동 123',
            primaryEmployeeId: E2E_EMPLOYEES[0].id,
            type: E2E_VOUCHER_TYPE,
            duration: 10,
            fullPrice: E2E_VOUCHER_PRICE.fullPrice,
            grant: E2E_VOUCHER_PRICE.grant,
            actualPrice: E2E_VOUCHER_PRICE.actualPrice,
            voucherClient: true,
            startDate: '2026-12-07',
            endDate: '2026-12-18',
        });

        // The panel closes after a successful save.
        await expect(panel.getByRole('heading', { name: '새 고객 등록' })).toHaveCount(0);
    });
});
