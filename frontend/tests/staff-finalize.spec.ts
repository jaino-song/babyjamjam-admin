import { test, expect, Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { KR_BUILTIN_HOLIDAYS } from "../src/lib/date/business-days";

test.beforeEach(async ({ page, baseURL }) => {
  const appUrl = baseURL ?? "http://localhost:3000";
  await page.context().addCookies([
    {
      name: "e2e_auth",
      value: "1",
      url: appUrl,
      sameSite: "Lax",
    },
  ]);

  await page.addInitScript(() => {
    (window as Window & { __E2E_AUTH__?: boolean }).__E2E_AUTH__ = true;
    sessionStorage.clear();
  });
});

const REVIEW_DOC_ID = "doc-finalize-test";
const REVIEW_DOC = {
  id: REVIEW_DOC_ID,
  document_number: "DOC-FT",
  template: { id: "tpl-test", name: "남동구 계약서" },
  document_name: "산모신생아건강관리서비스 계약서",
  creator: { recipient_type: "sender", id: "admin", name: "Admin" },
  created_date: Date.now() - 60_000,
  last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
  updated_date: Date.now() - 30_000,
  current_status: {
    status_type: "060",
    step_index: "3",
    step_type: "06",
    step_name: "제공기관 검토",
    step_recipients: [{ recipient_type: "01", name: "Staff" }],
    expired_date: Date.now() + 7 * 86400000,
  },
  recipients: [
    { recipient_type: "02", name: "송테스트" },
  ],
  fields: [
    { id: "계약 종료 년도", value: "2026" },
    { id: "계약 종료 월", value: "06" },
    { id: "계약 종료 일", value: "03" },
  ],
};

const MOCK_DOCUMENT_LIST = {
  documents: [REVIEW_DOC],
  total_rows: 1,
  limit: 20,
  skip: 0,
};

async function installCommonRoutes(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/api/clients/alerts") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.pathname === "/api/consultation-inquiries") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          total: 0,
          page: 1,
          limit: Number(url.searchParams.get("limit") ?? "1"),
          totalPages: 0,
        }),
      });
    }

    if (url.pathname === "/api/notifications/vapid-key") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ publicKey: "test-public-key" }),
      });
    }

    if (url.pathname === "/api/notifications/unread/count") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ count: 0 }) });
    }

    if (url.pathname === "/api/notifications") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (url.pathname === "/api/eformsign/webhook/stream") {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ":ok\n\n" });
    }

    if (url.pathname === "/api/eformsign-docs/feedback-template-id") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ templateId: null }),
      });
    }

    if (
      url.pathname === "/api/out-of-pocket-price-infos"
      || url.pathname === "/api/voucher-price-infos/years"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }

    return route.fallback();
  });

  // Branch holiday calendar for the apps' business-day maths (built-in list, no branch changes).
  await page.route("**/api/branches/*/holidays**", async (route) => {
      const year = Number(new URL(route.request().url()).searchParams.get("year"));
      const holidays = KR_BUILTIN_HOLIDAYS
          .filter((date) => date.startsWith(`${year}-`))
          .map((date) => ({ date, name: "공휴일", source: "builtin", excluded: false, overrideId: null }));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ year, revision: 1, supported: holidays.length > 0, synced: true, lastSyncedAt: null, holidays, inactiveOverrides: [] }) });
  });

  await page.route("**/api/eformsign/auth-status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true }) })
  );
  await page.route("**/api/eformsign/documents**", (route) => {
    if (route.request().url().includes(REVIEW_DOC_ID)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REVIEW_DOC) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_DOCUMENT_LIST) });
  });
  await page.route("**/api/eformsign-docs/document-id**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ clientId: 1, documentId: REVIEW_DOC_ID }) })
  );
  await page.route("**/api/eformsign-docs/client-names", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ documentId: REVIEW_DOC_ID, clientName: "송테스트" }]) })
  );
  await page.route("**/api/clients/1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        name: "송테스트",
        address: "인천 남동구 테스트로 123",
        phone: "01012345678",
        eDocId: REVIEW_DOC_ID,
      }),
    })
  );
  await page.route("**/api/voucher-price-infos/type**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/access-token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) })
  );
}

async function fillEndDateAndSubmit(page: Page, value: string) {
  const dateInput = page.getByPlaceholder("YYYY-MM-DD");
  await dateInput.fill(value);
  await page.getByRole("button", { name: "완료" }).click();
}

async function gotoContractsPage(page: Page) {
  await page.goto("/contracts");
}

async function createTestPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  return Buffer.from(await document.save());
}


// Finalizing a review-needed document is queue-only: 완료 POSTs one job to
// /api/eformsign-docs/jobs/finalization and the backend finishes the document. The browser never opens
// the eformsign editor (no SDK iframe) and never calls generate-staff-document / finalize-headless.
const FINALIZE_JOB_ROUTE = "**/api/eformsign-docs/jobs/finalization";
const FINALIZE_JOB_PATH = "/api/eformsign-docs/jobs/finalization";
const QUEUED_FINALIZE_JOB = { jobId: "job-finalize-test", status: "queued", existing: false };
// contracts/page.tsx:1526
const FINALIZE_STARTED_TOAST = "전자문서 작업을 시작했어요";
// contracts/page.tsx:1523
const FINALIZE_ALREADY_RUNNING_TOAST = "이 계약서의 검토완료가 이미 처리 중이에요.";
// contracts/page.tsx:1513 and :1534
const FINALIZE_FAILED_TITLE = "최종 확인을 마치지 못했어요";
// contracts/page.tsx:1514
const FINALIZE_JOB_LEFT_BEHIND_DESCRIPTION = "이 계약서의 검토완료 작업이 처리중 목록에 남아 있어요. 처리중 목록에서 확인해 주세요.";
// contracts/page.tsx:1535
const FINALIZE_RETRY_LATER_DESCRIPTION = "잠시 후 다시 시도해 주세요";
const REVIEW_TRIGGER = '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_header_review-trigger"]';

async function openFinalizeDialog(page: Page) {
  await gotoContractsPage(page);
  const reviewItem = page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_list_item"]').filter({ hasText: "검토 필요" }).first();
  await expect(reviewItem).toBeVisible();
  await reviewItem.click();
  await page.locator(REVIEW_TRIGGER).click();
}

/** Requests the removed iframe / headless finalize path used to make; the queue flow must make none of them. */
function trackLegacyFinalizeRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname === "/api/generate-staff-document" || pathname.startsWith("/api/eformsign-docs/finalize-headless")) {
      hits.push(`${request.method()} ${pathname}`);
    }
  });
  return hits;
}

test.describe("Staff finalize queue + prefill flow", () => {
  test("previews a review-needed maternity document without starting finalization", async ({ page }) => {
    await installCommonRoutes(page);

    const previewPdf = await createTestPdf();
    let finalizeJobRequests = 0;
    const legacyRequests = trackLegacyFinalizeRequests(page);

    await page.route(`**/api/eformsign/documents/${REVIEW_DOC_ID}/preview**`, async (route) => {
      if (route.request().method() === "HEAD") {
        return route.fulfill({
          status: 200,
          headers: {
            "content-length": String(previewPdf.byteLength),
            "content-type": "application/pdf",
          },
        });
      }

      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: previewPdf,
      });
    });
    await page.route(FINALIZE_JOB_ROUTE, async (route) => {
      finalizeJobRequests += 1;
      return route.fulfill({ status: 500 });
    });

    await gotoContractsPage(page);

    const reviewItem = page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_list_item"]').filter({ hasText: "검토 필요" }).first();
    await expect(reviewItem).toBeVisible();
    await reviewItem.click();

    const previewTrigger = page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_header_preview-trigger"]');
    await expect(previewTrigger).toHaveRole("button");
    await expect(previewTrigger).toHaveAccessibleName("문서 보기");
    await previewTrigger.click();

    const previewDialog = page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document_dialogs_document-preview"]');
    await expect(previewDialog).toBeVisible();
    await expect(previewDialog.getByRole("heading", { name: REVIEW_DOC.document_name })).toBeVisible();
    await expect(previewDialog.getByLabel("PDF 미리보기 확대/축소")).toBeVisible();
    expect(finalizeJobRequests).toBe(0);
    expect(legacyRequests).toEqual([]);
    await expect(page.getByPlaceholder("YYYY-MM-DD")).not.toBeVisible();
  });

  test("opens dialog, queues the finalize job with prefillEndDate, and closes the dialog", async ({ page }) => {
    const capturedJobRequests: Array<{ method: string; pathname: string; body: Record<string, unknown> }> = [];

    await installCommonRoutes(page);
    const legacyRequests = trackLegacyFinalizeRequests(page);
    await page.route(FINALIZE_JOB_ROUTE, async (route) => {
      capturedJobRequests.push({
        method: route.request().method(),
        pathname: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUEUED_FINALIZE_JOB) });
    });

    await openFinalizeDialog(page);

    // Dialog opens with the existing end date pre-filled in YYYY-MM-DD form.
    const dateInput = page.getByPlaceholder("YYYY-MM-DD");
    await expect(dateInput).toHaveValue("2026-06-03");

    // Type a new date and submit.
    await dateInput.fill("2026-07-15");
    await page.getByRole("button", { name: "완료" }).click();

    // Backend was called once with the new prefillEndDate.
    await expect.poll(() => capturedJobRequests.length).toBe(1);
    const [jobRequest] = capturedJobRequests;
    expect(jobRequest.method).toBe("POST");
    expect(jobRequest.pathname).toBe(FINALIZE_JOB_PATH);
    expect(jobRequest.body).toEqual({
      requestKey: expect.any(String),
      documentId: REVIEW_DOC_ID,
      prefillEndDate: "2026-07-15",
    });
    expect((jobRequest.body.requestKey as string).length).toBeGreaterThan(0);

    // Toast confirms the job was queued, and the dialog closes (there is no iframe modal any more).
    await expect(page.getByText(FINALIZE_STARTED_TOAST, { exact: true })).toBeVisible();
    await expect(dateInput).not.toBeVisible();
    expect(legacyRequests).toEqual([]);
  });

  test("an already running finalize job is reported instead of queueing another", async ({ page }) => {
    await installCommonRoutes(page);
    await page.route(FINALIZE_JOB_ROUTE, async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "job-finalize-existing", status: "processing", existing: true }),
      })
    );

    await openFinalizeDialog(page);
    await fillEndDateAndSubmit(page, "2026-07-15");

    await expect(page.getByText(FINALIZE_ALREADY_RUNNING_TOAST, { exact: true })).toBeVisible();
    await expect(page.getByText(FINALIZE_STARTED_TOAST, { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder("YYYY-MM-DD")).not.toBeVisible();
  });

  test("a finalize job left behind in the 처리중 list surfaces an error toast and keeps the dialog open", async ({ page }) => {
    await installCommonRoutes(page);
    await page.route(FINALIZE_JOB_ROUTE, async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "job-finalize-failed", status: "failed", existing: true }),
      })
    );

    await openFinalizeDialog(page);
    await fillEndDateAndSubmit(page, "2026-07-15");

    await expect(page.getByText(FINALIZE_FAILED_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(FINALIZE_JOB_LEFT_BEHIND_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByText(FINALIZE_STARTED_TOAST, { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder("YYYY-MM-DD")).toBeVisible();
  });

  test("invalid (incomplete) date keeps 완료 disabled", async ({ page }) => {
    await installCommonRoutes(page);

    await openFinalizeDialog(page);

    const dateInput = page.getByPlaceholder("YYYY-MM-DD");
    await dateInput.fill("");
    await dateInput.fill("2026-07");
    await expect(page.getByRole("button", { name: "완료" })).toBeDisabled();
    await dateInput.fill("2026-07-15");
    await expect(page.getByRole("button", { name: "완료" })).toBeEnabled();
  });

  test("backend failure surfaces an error toast and keeps the dialog open", async ({ page }) => {
    await installCommonRoutes(page);
    await page.route(FINALIZE_JOB_ROUTE, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    );

    await openFinalizeDialog(page);
    await fillEndDateAndSubmit(page, "2026-07-15");

    await expect(page.getByText(FINALIZE_FAILED_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(FINALIZE_RETRY_LATER_DESCRIPTION, { exact: true })).toBeVisible();
    // Date dialog remains open so staff can retry.
    await expect(page.getByPlaceholder("YYYY-MM-DD")).toBeVisible();
  });
});
