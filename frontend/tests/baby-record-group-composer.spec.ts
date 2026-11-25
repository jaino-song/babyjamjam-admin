import { expect, test, type Page } from "@playwright/test";
import { enableE2EAuth, fulfillShellDefaults } from "./helpers/e2e-shell";

const caseIds = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
];
const employees = [
    { id: 31, name: "테스트 주관리사", phone: "010-1111-2222" },
    { id: 32, name: "테스트 보조관리사", phone: "010-3333-4444" },
];
const client = { id: 62, name: "테스트 산모", phone: "010-5555-6666", address: "인천" };
const template = {
    id: "tpl-group-record-link", templateKey: "SERVICE_RECORD_LINK",
    name: "제공기록지 작성 링크", description: "서비스 시작 전날 정오(한국 시간)",
    content: "{{serviceRecordLinks}}", customVariables: [],
    requiredVariables: [{ key: "serviceRecordLinks", label: "제공기록지 링크", type: "string", required: true }],
    updatedAt: "2026-11-01T00:00:00.000Z",
};
const members = caseIds.map((caseId, index) => {
    const preparedLinkToken = `efl_${(index === 0 ? "A" : "B").repeat(43)}`;
    return {
        caseId, babyId: `20000000-0000-4000-8000-00000000000${index + 1}`, activeRank: index + 1,
        assignmentVersion: index === 0 ? 3 : 7,
        serviceRecordUrl: `https://example.test/service-record/${preparedLinkToken}`,
        preparedLinkToken, expiresAt: "2099-12-20T15:00:00.000Z",
    };
});
const preview = (selection: typeof members) => selection
    .map((member) => `${member.activeRank === 1 ? "첫째" : "둘째"} 아기 제공기록지\n${member.serviceRecordUrl}`)
    .join("\n\n");

async function openComposer(page: Page, options: {
    split?: boolean;
    waitForPrimary?: Promise<void>;
} = {}) {
    await enableE2EAuth(page);
    await page.context().addCookies([{
        name: "selected_branch_id", value: "e2e-branch",
        url: process.env.BASE_URL ?? "http://localhost:3000", sameSite: "Lax",
    }]);
    const prepareRequests: unknown[] = [];
    const sendRequests: unknown[] = [];
    await page.route("**/api/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (await fulfillShellDefaults(route)) return;
        if (pathname === "/api/settings/message-sender-approval") return route.fulfill({ json: { isApproved: true } });
        if (pathname === "/api/message-templates" || pathname === "/api/message-logs") return route.fulfill({ json: [] });
        if (pathname === "/api/branch-system-templates") return route.fulfill({ json: [template] });
        if (pathname === "/api/branch-system-templates/SERVICE_RECORD_LINK") return route.fulfill({ json: template });
        if (pathname === "/api/employees") return route.fulfill({ json: employees.map((employee) => ({
            ...employee, workArea: ["인천"], grade: "A", openToNextWork: true, registeredDate: "2026-01-01", status: "available",
        })) });
        if (pathname === "/api/clients") return route.fulfill({ json: [client] });
        if (pathname === "/api/admin/service-records/client/62") return route.fulfill({
            json: { record: null, assignments: [], legacyLinkAssignment: null, cases: members.map((member, index) => {
                const employee = employees[options.split ? index : 0];
                return {
                    caseId: member.caseId, babyId: member.babyId, rank: member.activeRank,
                    babyCount: 2, legacyName: null, retired: false, status: "IN_PROGRESS",
                    submittedSessions: 0, totalSessions: 5, assignees: [{ id: employee.id, name: employee.name }],
                    linkAssignments: [{ scheduleId: 51, employeeId: employee.id, assignmentVersion: member.assignmentVersion }],
                };
            }) },
        });
        if (pathname === "/api/admin/service-records/schedules/51/prepare-link") {
            const data = route.request().postDataJSON() as { employeeId: number; caseIds: string[] };
            prepareRequests.push(data);
            const authorized = options.split ? [members[data.employeeId === 31 ? 0 : 1]] : members;
            const selected = authorized.filter(({ caseId }) => data.caseIds.includes(caseId));
            if (data.employeeId === 31) await options.waitForPrimary;
            return route.fulfill({
                status: 201, json: { kind: "group", employeeId: data.employeeId, householdBabyCount: 2,
                    members: selected, previewContent: preview(selected), buttonUrl: null },
            });
        }
        if (pathname === "/api/admin/service-records/schedules/51/send-link") {
            sendRequests.push(route.request().postDataJSON());
            return route.fulfill({ status: 201, json: { ok: true, jobId: "qa-local", status: "sent" } });
        }
        return route.fulfill({ json: {} });
    });
    await page.goto("/messages", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^제공기록지 작성 링크/ }).click();
    return { prepareRequests, sendRequests };
}

async function chooseEmployee(page: Page, name: string) {
    await page.getByRole("combobox", { name: "관리사님 성함", exact: true }).click();
    await page.getByRole("combobox", { name: "관리사님 성함 검색" }).fill(name);
    await page.getByRole("option", { name: new RegExp(name) }).click();
}

async function chooseClient(page: Page) {
    await page.getByRole("combobox", { name: "산모님 성함", exact: true }).click();
    await page.getByRole("combobox", { name: "산모님 성함 검색" }).fill(client.name);
    await page.getByRole("option", { name: /010-5555-6666/ }).click();
}

test("one prepared caregiver message shows two independent links", async ({ page }) => {
    const { prepareRequests, sendRequests } = await openComposer(page);
    const send = page.getByRole("button", { name: "즉시 발송" });
    await expect(send).toBeDisabled();
    await chooseEmployee(page, employees[0].name);
    await chooseClient(page);
    const body = page.locator('[data-component="desktop_messages_sections_msg-field"]');
    await expect(body).toHaveValue(preview(members));
    await expect(page.getByRole("checkbox", { name: "첫째 아기" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "둘째 아기" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: /관리사님 전화번호/ })).toBeDisabled();
    expect(prepareRequests).toEqual([{ employeeId: 31, caseIds, recipientPhone: "01011112222" }]);

    await send.click();
    await expect.poll(() => sendRequests).toEqual([{
        employeeId: 31, recipientPhone: "01011112222",
        members: members.map(({ caseId, assignmentVersion, preparedLinkToken }) => ({
            caseId, assignmentVersion, preparedLinkToken,
        })),
    }]);
});

test("switching caregivers discards an in-flight preparation and sends only the second baby's link", async ({ page }) => {
    let releasePrimary!: () => void;
    const waitForPrimary = new Promise<void>((resolve) => { releasePrimary = resolve; });
    const { prepareRequests, sendRequests } = await openComposer(page, { split: true, waitForPrimary });
    try {
        await chooseEmployee(page, employees[0].name);
        await chooseClient(page);
        await expect.poll(() => prepareRequests.length).toBe(1);
        const send = page.getByRole("button", { name: "즉시 발송" });
        await expect(send).toBeDisabled();
        await page.getByRole("button", { name: "제공인력 선택 해제" }).click();
        await expect(send).toBeDisabled();
        await chooseEmployee(page, employees[1].name);
        const body = page.locator('[data-component="desktop_messages_sections_msg-field"]');
        await expect(body).toHaveValue(preview([members[1]]));
        const primary = page.waitForResponse((response) => response.url().endsWith("/prepare-link")
            && response.request().postDataJSON().employeeId === 31);
        releasePrimary();
        await primary;
        await expect(body).toHaveValue(preview([members[1]]));
        await expect(page.getByRole("checkbox", { name: "첫째 아기" })).toHaveCount(0);
        await expect(page.getByRole("checkbox", { name: "둘째 아기" })).toBeChecked();
        expect(prepareRequests[1]).toEqual({ employeeId: 32, caseIds: [caseIds[1]], recipientPhone: "01033334444" });
        await send.click();
        await expect.poll(() => sendRequests).toEqual([{
            employeeId: 32, recipientPhone: "01033334444", members: [{
                caseId: caseIds[1], assignmentVersion: 7, preparedLinkToken: members[1].preparedLinkToken,
            }],
        }]);
    } finally {
        releasePrimary();
    }
});
