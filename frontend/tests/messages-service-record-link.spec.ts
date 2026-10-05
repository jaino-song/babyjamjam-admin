import { expect, test, type Route } from "@playwright/test";
import { enableE2EAuth, fulfillShellDefaults } from "./helpers/e2e-shell";

const SERVICE_RECORD_URL = "https://mobile.test/service-record/efl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PREPARED_LINK_TOKEN = SERVICE_RECORD_URL.split("/").at(-1)!;

const serviceRecordTemplate = `송진호 관리사님, 송진호 산모님의 {{serviceStartDate}} 시작 서비스 제공기록지 작성 링크입니다.

제공기록지 링크
{{serviceRecordUrl}}`;

const serviceRecordSystemTemplate = {
    id: "tpl-service-record-link",
    templateKey: "SERVICE_RECORD_LINK",
    name: "제공기록지 작성 링크",
    description: "제공기록지 작성 링크",
    content: serviceRecordTemplate,
    customVariables: [],
    requiredVariables: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
};

test("shows the exact prepared service-record URL and sends the same token", async ({ page }) => {
    await enableE2EAuth(page);
    // Branch-scoped template queries only run once the branch cookie matches the active branch.
    await page.context().addCookies([{
        name: "selected_branch_id",
        value: "e2e-branch",
        url: process.env.BASE_URL ?? "http://localhost:3000",
        sameSite: "Lax",
    }]);
    let sendBody: unknown = null;

    await page.route("**/api/**", async (route: Route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;

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
        if (pathname === "/api/settings/message-sender-approval") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ isApproved: true }),
            });
        }
        if (pathname === "/api/message-templates" || pathname === "/api/message-logs") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        // The 전송하기 list comes from the branch-scoped template endpoints.
        if (pathname === "/api/branch-system-templates") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([serviceRecordSystemTemplate]),
            });
        }
        if (pathname === "/api/branch-system-templates/SERVICE_RECORD_LINK") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(serviceRecordSystemTemplate),
            });
        }
        if (pathname === "/api/employees") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([{
                    id: 30,
                    name: "송진호",
                    phone: "010-1111-2222",
                    workArea: ["인천"],
                    grade: "A",
                    openToNextWork: true,
                    registeredDate: "2026-01-01",
                    status: "available",
                }]),
            });
        }
        if (pathname === "/api/clients/alerts") {
            return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (pathname === "/api/clients") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([{
                    id: 62,
                    name: "송진호",
                    phone: "010-3333-4444",
                    address: "인천",
                }]),
            });
        }
        if (pathname === "/api/admin/service-records/client/62") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    record: null,
                    assignments: [{
                        scheduleId: 51,
                        startDate: "2026-07-13T00:00:00.000Z",
                        replaced: false,
                        employee: {
                            id: 30,
                            name: "송진호",
                            phone: "010-1111-2222",
                        },
                    }],
                }),
            });
        }
        if (pathname === "/api/admin/service-records/schedules/51/prepare-link") {
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                headers: { "Cache-Control": "no-store" },
                body: JSON.stringify({
                    serviceRecordUrl: SERVICE_RECORD_URL,
                    preparedLinkToken: PREPARED_LINK_TOKEN,
                    expiresAt: "2026-07-20T00:00:00.000Z",
                }),
            });
        }
        if (pathname === "/api/admin/service-records/schedules/51/send-link") {
            sendBody = request.postDataJSON();
            return route.fulfill({
                status: 201,
                contentType: "application/json",
                body: JSON.stringify({ ok: true, scheduledFor: "2026-07-13T00:00:00.000Z" }),
            });
        }
        if (pathname === "/api/notifications/unread/count") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ count: 0 }),
            });
        }

        if (await fulfillShellDefaults(route)) return;
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/messages");
    await page.getByRole("button", { name: /^제공기록지 작성 링크/ }).click();

    await page.getByRole("combobox", { name: "관리사님 성함" }).click();
    await page.getByRole("combobox", { name: "관리사님 성함 검색" }).fill("송진호");
    await page.getByRole("option", { name: /송진호/ }).click();

    await page.getByRole("combobox", { name: "산모님 성함" }).click();
    await page.getByRole("combobox", { name: "산모님 성함 검색" }).fill("송진호");
    // The employee has the same name, so pick the client row by its phone number.
    await page.getByRole("option", { name: /010-3333-4444/ }).click();

    const messageField = page.locator('[data-component="desktop_messages_sections_msg-field"]');
    await expect(messageField).toBeVisible();
    await expect(messageField).toHaveValue(/2026-07-13 시작 서비스 제공기록지/);
    await expect(messageField).toHaveValue(new RegExp(SERVICE_RECORD_URL));
    await expect(messageField).not.toHaveValue(/\{\{serviceStartDate\}\}/);
    await expect(messageField).not.toHaveValue(/\{\{serviceRecordUrl\}\}/);

    const renderedStyle = await messageField.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return {
            display: style.display,
            visibility: style.visibility,
            fontSize: Number.parseFloat(style.fontSize),
            width: bounds.width,
            height: bounds.height,
        };
    });
    expect(renderedStyle.display).not.toBe("none");
    expect(renderedStyle.visibility).toBe("visible");
    expect(renderedStyle.fontSize).toBeGreaterThan(0);
    expect(renderedStyle.width).toBeGreaterThan(0);
    expect(renderedStyle.height).toBeGreaterThan(0);

    await page.getByRole("button", { name: "즉시 발송" }).click();
    await expect.poll(() => sendBody).toEqual({
        preparedLinkToken: PREPARED_LINK_TOKEN,
        recipientPhone: "01011112222",
    });
});
