import { expect, test, type Page, type Route } from "@playwright/test";

async function enableE2EAuth(page: Page) {
    const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
    const tokenPayload = Buffer.from(JSON.stringify({
        exp: 4_102_444_800,
        sub: "e2e-user",
        sid: "e2e-session",
        type: "access",
        branchId: "branch-1",
        role: "admin",
    })).toString("base64url");
    const authToken = `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${tokenPayload}.e2e`;
    await page.context().addCookies([
        { name: "auth_token", value: authToken, url: baseURL, sameSite: "Lax" },
        { name: "e2e_auth", value: "1", url: baseURL, sameSite: "Lax" },
    ]);
    await page.addInitScript(() => {
        (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
        sessionStorage.clear();
    });
}

test("changes the next service session from the client dropdown", async ({ page }) => {
    await enableE2EAuth(page);
    let appliedBody: unknown = null;

    await page.route("**/api/**", async (route: Route) => {
        const pathname = new URL(route.request().url()).pathname;

        if (pathname === "/api/auth/me") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: "e2e-user",
                    name: "E2E Tester",
                    role: "admin",
                    branchName: "테스트 지점",
                }),
            });
        }
        if (pathname === "/api/clients") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    data: [{
                        id: 1,
                        name: "일정 변경 고객",
                        phone: "010-3333-4444",
                        address: "인천 남동구",
                        serviceStatus: "active",
                        startDate: "2026-07-15",
                        endDate: "2026-07-31",
                        dueDate: "2026-07-01",
                    }],
                    total: 1,
                    page: 1,
                    limit: 50,
                    totalPages: 1,
                }),
            });
        }
        if (pathname === "/api/clients/1") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 1,
                    name: "일정 변경 고객",
                    phone: "010-3333-4444",
                    address: "인천 남동구",
                    serviceStatus: "active",
                    startDate: "2026-07-15",
                    endDate: "2026-07-31",
                    dueDate: "2026-07-01",
                }),
            });
        }
        if (pathname === "/api/admin/service-records/client/1") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    record: null,
                    assignments: [{
                        scheduleId: 51,
                        startDate: "2026-07-15",
                        endDate: "2026-07-31",
                        replaced: false,
                        employee: { id: 30, name: "관리사", phone: "010-1111-2222" },
                        link: { status: "sent", scheduledFor: null, sentCount: 1, lastSentAt: null, token: null },
                        header: null,
                        totalSessions: 10,
                        sessions: [],
                        signatureDoc: null,
                    }],
                }),
            });
        }
        if (pathname === "/api/schedule-change-requests/schedules/51/preview") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    sessionIndex: 3,
                    fromDate: "2026-07-20",
                    minimumDate: "2026-07-20",
                }),
            });
        }
        if (pathname === "/api/schedule-change-requests/schedules/51/apply") {
            appliedBody = route.request().postDataJSON();
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({ status: "approved" }),
            });
        }
        if (pathname === "/api/eformsign-docs/client") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (pathname === "/api/clients/alerts" || pathname === "/api/message-trigger-jobs/upcoming") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (pathname === "/api/notifications/unread/count") {
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"count":0}' });
        }
        if (pathname === "/api/settings/client-registration-policy") {
            return route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":false}' });
        }

        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/clients?id=1");
    await expect(page.getByText("일정 변경 고객", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "고객 작업 메뉴 열기" }).click();
    await page.getByText("서비스 일정 변경", { exact: true }).click();

    const modal = page.locator('[data-component="clients-detail-service-schedule-change-modal"]');
    const dateInput = modal.getByLabel("변경할 서비스 제공일");
    await expect(modal).toBeVisible();
    await expect(dateInput).toHaveAttribute("min", "2026-07-20");
    await expect(dateInput).toHaveValue("2026-07-20");
    await expect(modal.getByRole("button", { name: "일정 변경" })).toBeDisabled();

    await dateInput.fill("2026-07-23");
    await modal.getByRole("button", { name: "일정 변경" }).click();

    await expect(modal).toBeHidden();
    expect(appliedBody).toEqual({ toDate: "2026-07-23" });
});
