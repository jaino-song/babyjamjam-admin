import { expect, test, type Page, type Route, type Request } from "@playwright/test";

import { mobileDynamicScreenshotRoutes } from "./route-manifest";

const templateFixture = {
  id: "tpl-1",
  templateKey: "THANKS",
  name: "감사 템플릿",
  description: "감사 메시지",
  content: "감사합니다 {{name}}님",
  variables: [
    {
      key: "name",
      label: "이름",
      type: "text",
      required: true,
    },
  ],
} as const;

const systemTemplateFixture = {
  id: "tpl-thanks",
  templateKey: "THANKS",
  name: "감사",
  description: "감사 메시지",
  content: "감사합니다 {{name}}님",
  requiredVariables: [
    {
      key: "name",
      label: "이름",
      type: "string",
      required: true,
    },
  ],
  updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
} as const;

const feedbackDetailFixture = {
  id: "feedback-1",
  type: "negative",
  comment: "답변이 부정확합니다",
  createdAt: "2024-01-15T11:00:00.000Z",
  user: { id: "user-2", name: "김철수", email: "kim@example.com" },
  message: {
    id: "msg-2",
    content: "다른 답변입니다",
    role: "assistant",
    timestamp: "2024-01-15T10:59:00.000Z",
  },
  session: {
    id: "session-1",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "안녕하세요",
        timestamp: "2024-01-15T10:58:00.000Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "다른 답변입니다",
        timestamp: "2024-01-15T10:59:00.000Z",
      },
    ],
  },
} as const;

async function mockDynamicRouteData(page: Page) {
  // The app shell opens one long-lived server-sent-event stream
  // (useRealtimeInvalidation, since 5fdc1aecf) that the BFF proxy holds open for
  // up to 50s. Playwright counts an open request as network activity, so
  // "networkidle" can never settle while it is live. Fail the stream instead:
  // the realtime hook just schedules a retry (3s apart), leaving the network
  // idle between attempts, and nothing this capture renders depends on it.
  await page.route("**/api/realtime/events", async (route: Route) => {
    await route.abort("failed");
  });

  await page.route("**/api/admin/feedback/feedback-1", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(feedbackDetailFixture),
    });
  });

  // The detail page reads the branch-effective template, with the session's
  // branch in the query string (expectedBranchId); the global
  // /api/system-templates/THANKS endpoint is no longer requested.
  await page.route("**/api/branch-system-templates/THANKS*", async (route: Route, request: Request) => {
    if (request.method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(systemTemplateFixture),
    });
  });

  await page.route("**/api/system-templates/THANKS/versions", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/message-templates/tpl-1", async (route: Route, request: Request) => {
    if (request.method() !== "GET") {
      return route.continue();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(templateFixture),
    });
  });
}

// A capture of an error or loading state would "pass" silently, so each route
// must show its fixture's known content before the screenshot is taken.
const contentAssertions: Record<string, (page: Page) => Promise<void>> = {
  "admin-feedback-detail": async (page) => {
    await expect(page.locator('[data-component="mobile_admin_feedback-detail_content_info"]')).toContainText(
      feedbackDetailFixture.comment,
      { timeout: 15000 },
    );
  },
  "messages-system-template-detail": async (page) => {
    await expect(
      page.locator(
        '[data-component="mobile_messages_system-templates_template-key-detail_detail-panel_info-card_content"]',
      ),
    ).toContainText(systemTemplateFixture.content, { timeout: 15000 });
  },
  "messages-template-edit": async (page) => {
    await expect(
      page.locator('[data-component="mobile_messages_templates_edit_page_content_body_text"]'),
    ).toHaveText(templateFixture.content, { timeout: 15000 });
  },
};

const viewports = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
} as const;

for (const [viewportName, viewportSize] of Object.entries(viewports)) {
  test.describe(`dynamic ${viewportName}`, () => {
    test.use({ viewport: viewportSize });

    for (const route of mobileDynamicScreenshotRoutes) {
      test(`capture ${route.slug}`, async ({ page }) => {
        await mockDynamicRouteData(page);
        await page.goto(route.path);
        const assertContent = contentAssertions[route.slug];
        if (!assertContent) {
          throw new Error(`No content assertion registered for dynamic route ${route.slug}`);
        }
        await assertContent(page);
        await page.waitForLoadState("networkidle", { timeout: 15000 });

        await page.screenshot({
          path: `tests/screenshots/dynamic/${viewportName}/${route.slug}.png`,
          fullPage: true,
        });
      });
    }
  });
}
