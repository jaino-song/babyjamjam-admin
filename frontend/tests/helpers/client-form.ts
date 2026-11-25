import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { KOREAN_HOLIDAY_CALENDAR } from '@babyjamjam/shared/utils/business-days';

/**
 * Shared fixtures for the desktop "새 고객 등록" form on /clients.
 *
 * The form is a four-step panel (이용자 정보 → 바우처 정보 → 제공인력 정보 → 계약 정보).
 * The form's lookups, create response and refreshed client list use synthetic fixtures.
 */

export const E2E_EMPLOYEES = [
    { id: 11, name: '김제공', phone: '01011112222', workArea: ['인천'], grade: '베스트', openToNextWork: true, registeredDate: null, status: 'available' },
    { id: 12, name: '김보조', phone: '01033334444', workArea: ['서울'], grade: '스탠다드', openToNextWork: true, registeredDate: null, status: 'available' },
    { id: 13, name: '이도우', phone: '01055556666', workArea: ['인천'], grade: '프리미엄', openToNextWork: true, registeredDate: null, status: 'available' },
] as const;

export const E2E_VOUCHER_TYPE = 'A가1형';
export const E2E_B_VOUCHER_TYPE = 'B가2형';
export const E2E_VOUCHER_PRICE = { fullPrice: '1000000', grant: '700000', actualPrice: '300000' } as const;
const VOUCHER_YEAR = 2026;
const VOUCHER_PRICES = [
    { id: 1, type: E2E_VOUCHER_TYPE, duration: '10', ...E2E_VOUCHER_PRICE },
    { id: 2, type: E2E_B_VOUCHER_TYPE, duration: '10', fullPrice: '1000000', grant: '800000', actualPrice: '200000' },
];

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

/** Mock the form requests and the client list reads that are refreshed after a create. */
export async function installClientFormRoutes(page: Page) {
    // Keep browser traffic on the app origin and block any write without a fixture.
    let appOrigin: string | undefined;
    await page.route('**/*', (route) => {
        const request = route.request();
        const { origin } = new URL(request.url());
        if (!appOrigin && request.isNavigationRequest() && request.resourceType() === 'document') {
            appOrigin = origin;
        }
        if (origin !== appOrigin) {
            return route.abort();
        }
        return ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
    });
    await installHolidayCalendarRoute(page);
    await page.route('**/api/voucher-price-infos/years', (route) => json(route, [VOUCHER_YEAR]));
    await page.route('**/api/voucher-price-infos/type**', (route) => {
        const { searchParams } = new URL(route.request().url());
        const type = searchParams.get('type');
        const rows = searchParams.get('year') === String(VOUCHER_YEAR)
            ? VOUCHER_PRICES.filter((row) => !type || row.type === type)
            : [];
        return json(route, rows);
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
    await page.route('**/api/clients/list-summary**', (route) => json(route, {
        total: 0,
        byTab: { all: 0, pre_booking: 0, waiting: 0, replacement_requested: 0, active: 0, completed: 0, terminated: 0 },
        dueDate: { thisMonth: 0, nextMonth: 0 },
        serviceEnd: { count: 0, from: '2026-12-07', to: '2026-12-18' },
    }));
    await page.route('**/api/clients/service-record-missing', (route) => json(route, { count: 0, items: [] }));
    await page.route((url) => url.pathname === '/api/clients', (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>;
            return json(route, { id: 901, ...body }, 201);
        }
        if (request.method() === 'GET') {
            const { searchParams } = new URL(request.url());
            const page = searchParams.get('page');
            return json(route, page === null ? [] : {
                data: [],
                total: 0,
                page: Number(page),
                limit: Number(searchParams.get('limit')),
                totalPages: 0,
            });
        }
        return route.fallback();
    });
}

/** The form panel's root, so assertions never match the client list beside it. */
export function clientFormPanel(page: Page): Locator {
    return page.locator('[data-component="desktop_clients_page_sections_section-content_list-section_split-layout_detail-panel-form"]');
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

export async function submitClientForm(page: Page, panel: Locator): Promise<Record<string, unknown>> {
    const [response] = await Promise.all([
        page.waitForResponse((response) =>
            response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/clients'),
        panel.getByRole('button', { name: '생성' }).click(),
    ]);
    expect(response.status()).toBe(201);
    return response.request().postDataJSON() as Record<string, unknown>;
}
