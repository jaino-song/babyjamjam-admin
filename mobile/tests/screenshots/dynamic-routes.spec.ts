import { test, type Page, type Route, type Request } from "@playwright/test";

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
  await page.route("**/api/admin/feedback/feedback-1", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(feedbackDetailFixture),
    });
  });

  await page.route("**/api/system-templates/THANKS", async (route: Route, request: Request) => {
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
        await page.waitForLoadState("networkidle", { timeout: 15000 });

        await page.screenshot({
          path: `tests/screenshots/dynamic/${viewportName}/${route.slug}.png`,
          fullPage: true,
        });
      });
    }
  });
}
