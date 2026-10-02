import type { Page, Route } from '@playwright/test';
import { holidayCalendarResponse } from './client-form';

/**
 * Helpers for specs that mock every `/api/**` call themselves.
 *
 * `enableE2EAuth` signs the browser in with the `e2e_auth` bypass (dev server started with
 * NEXT_PUBLIC_E2E_TEST=true). `fulfillShellDefaults` answers the requests the desktop shell
 * (sidebar, notifications, clients page chrome) makes on every page, with the response shapes the
 * app expects. Without it a catch-all `{}` crashes the page: the shell reads arrays and counters
 * from those endpoints.
 */

export async function enableE2EAuth(page: Page) {
    const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
    const tokenPayload = Buffer.from(JSON.stringify({
        exp: 4_102_444_800,
        sub: 'e2e-user',
        sid: 'e2e-session',
        type: 'access',
        branchId: 'branch-1',
        role: 'admin',
    })).toString('base64url');
    const authToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${tokenPayload}.e2e`;

    await page.context().addCookies([
        { name: 'auth_token', value: authToken, url: baseURL, sameSite: 'Lax' },
        { name: 'e2e_auth', value: '1', url: baseURL, sameSite: 'Lax' },
    ]);
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
        sessionStorage.clear();
    });
}

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Summary counters for the clients page header; `total` clients, all in the "waiting" tab. */
export function clientsListSummary(total: number) {
    return {
        total,
        byTab: { all: total, pre_booking: 0, waiting: total, replacement_requested: 0, active: 0, completed: 0, terminated: 0 },
        dueDate: { thisMonth: 0, nextMonth: 0 },
        serviceEnd: { count: 0, from: '2026-10-02', to: '2026-10-05' },
    };
}

/**
 * Answer the shell's background requests. Returns true when the request was handled, so callers can
 * `if (await fulfillShellDefaults(route)) return;` before their own spec-specific routes.
 */
export async function fulfillShellDefaults(route: Route): Promise<boolean> {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (route.request().method() !== 'GET') return false;

    if (pathname === '/api/auth/me') {
        await json(route, { id: 'e2e-user', name: 'E2E Tester', role: 'admin', branchName: '테스트 지점' });
        return true;
    }
    if (pathname === '/api/consultation-inquiries') {
        await json(route, { data: [], total: 0, page: 1, limit: 1, totalPages: 1 });
        return true;
    }
    if (pathname === '/api/notifications/unread/count') {
        await json(route, { count: 0 });
        return true;
    }
    if (pathname === '/api/settings/client-registration-policy') {
        await json(route, { clientAutoRegistration: false, greetingOnAutoRegistration: false });
        return true;
    }
    if (/^\/api\/branches\/[^/]+\/holidays$/.test(pathname)) {
        await json(route, holidayCalendarResponse(Number(url.searchParams.get('year'))));
        return true;
    }
    const emptyLists = [
        '/api/notifications',
        '/api/clients/alerts',
        '/api/message-trigger-jobs/upcoming',
        '/api/eformsign-docs/client',
        '/api/voucher-price-infos/years',
        '/api/out-of-pocket-price-infos',
        '/api/area-templates',
        '/api/area-templates/available-areas',
    ];
    if (emptyLists.includes(pathname)) {
        await json(route, []);
        return true;
    }
    return false;
}
