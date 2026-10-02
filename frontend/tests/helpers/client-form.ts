import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { KOREAN_HOLIDAY_CALENDAR } from '@babyjamjam/shared/utils/business-days';

/**
 * Shared fixtures for the desktop "새 고객 등록" form on /clients.
 *
 * The form is a four-step panel (이용자 정보 → 제공인력 정보 → 바우처 정보 → 계약 정보).
 * Every API it reads is served from here so the specs do not depend on what the
 * backend happens to have seeded.
 */

export const E2E_EMPLOYEES = [
    { id: 11, name: '김제공', phone: '01011112222', workArea: ['인천'], grade: '베스트', openToNextWork: true, registeredDate: null, status: 'available' },
    { id: 12, name: '김보조', phone: '01033334444', workArea: ['서울'], grade: '스탠다드', openToNextWork: true, registeredDate: null, status: 'available' },
    { id: 13, name: '이도우', phone: '01055556666', workArea: ['인천'], grade: '프리미엄', openToNextWork: true, registeredDate: null, status: 'available' },
] as const;

export const E2E_VOUCHER_TYPE = 'A가1형';
export const E2E_VOUCHER_PRICE = { fullPrice: '1000000', grant: '700000', actualPrice: '300000' } as const;

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** The branch holiday calendar response for `year`, built from the shared built-in Korean list. */
export function holidayCalendarResponse(year: number) {
    const dates = KOREAN_HOLIDAY_CALENDAR[year] ?? [];
    return {
        year,
        revision: 'e2e-builtin',
        supported: dates.length > 0,
        synced: false,
        lastSyncedAt: null,
        holidays: dates.map((date) => ({ date, name: '공휴일', source: 'builtin', excluded: false, overrideId: null })),
        inactiveOverrides: [],
    };
}

/** Serve the built-in Korean holiday list for whichever year is requested. */
export async function installHolidayCalendarRoute(page: Page) {
    await page.route('**/api/branches/*/holidays*', (route) => {
        const year = Number(new URL(route.request().url()).searchParams.get('year'));
        return json(route, holidayCalendarResponse(year));
    });
}

/** Mock the lookups behind the client form: prices, areas, employees and the phone duplicate check. */
export async function installClientFormRoutes(page: Page) {
    await installHolidayCalendarRoute(page);
    await page.route('**/api/voucher-price-infos/years', (route) => json(route, [2026]));
    await page.route('**/api/voucher-price-infos/type**', (route) => {
        const type = new URL(route.request().url()).searchParams.get('type');
        return json(route, type === E2E_VOUCHER_TYPE
            ? [{ id: 1, type: E2E_VOUCHER_TYPE, duration: '10', ...E2E_VOUCHER_PRICE }]
            : []);
    });
    await page.route('**/api/out-of-pocket-price-infos', (route) => json(route, [
        { id: 1, duration: 5, fullPrice: '815000' },
        { id: 2, duration: 10, fullPrice: '1620000' },
    ]));
    await page.route('**/api/area-templates/available-areas', (route) => json(route, [
        { id: 'area-incheon', name: 'INCHEON', koreanName: '인천' },
    ]));
    await page.route('**/api/employees', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return json(route, E2E_EMPLOYEES);
    });
    await page.route('**/api/clients/check-phone**', (route) => json(route, { exists: false }));
}

/** The form panel's root, so assertions never match the client list beside it. */
export function clientFormPanel(page: Page): Locator {
    return page.locator('[data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-panel-form"]');
}

export async function openClientForm(page: Page): Promise<Locator> {
    await installClientFormRoutes(page);
    await page.goto('/clients');
    await page.getByRole('button', { name: '고객 추가' }).click();
    const panel = clientFormPanel(page);
    await expect(panel.getByRole('heading', { name: '새 고객 등록' })).toBeVisible();
    return panel;
}

export async function fillRequiredClientFields(panel: Locator) {
    await panel.getByLabel('이름*').fill('테스트 산모');
    await panel.getByLabel('생년월일*').fill('19900515');
    await panel.getByLabel('연락처*').fill('01012345678');
    await panel.getByLabel('주소*').fill('인천광역시 연수구 테스트동 123');
}

export async function goToNextStep(panel: Locator) {
    await panel.getByRole('button', { name: '다음' }).click();
}
