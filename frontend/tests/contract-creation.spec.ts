import { expect, Page, test } from "@playwright/test";
import { KOREAN_HOLIDAY_CALENDAR } from "@babyjamjam/shared/utils/business-days";

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

const MOCK_CLIENT = {
  id: 1,
  name: "홍테스트",
  phone: "01012345678",
  birthday: "1990-01-01",
  address: "인천 남동구 테스트로 123",
  dueDate: "2026-05-30",
};
const MOCK_EMPLOYEES = [
  {
    id: 1,
    name: "테스트직원",
    workArea: ["남동구"],
    phone: "01000000000",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-01-01T00:00:00.000Z",
    status: "available",
  },
  {
    id: 2,
    name: "보조직원",
    workArea: ["남동구"],
    phone: "01000000001",
    grade: "A",
    openToNextWork: true,
    registeredDate: "2026-01-02T00:00:00.000Z",
    status: "available",
  },
];
const MOCK_AREA_TEMPLATES = [
  {
    id: "area-template-1",
    areaId: "namdong",
    templateId: "tpl-create-test",
    templateName: "남동구 계약서",
  },
];
const MOCK_AREA_TEMPLATE_DISPLAY_LABEL = "남동구";
const MOCK_VOUCHER_PRICE_INFOS = [
  {
    id: 2,
    type: "A가1형",
    duration: "10",
    fullPrice: "1234567",
    grant: "1000000",
    actualPrice: "234567",
  },
];
const MOCK_DOCUMENT_LIST: {
  documents: unknown[];
  total_rows: number;
  limit: number;
  skip: number;
} = {
  documents: [],
  total_rows: 0,
  limit: 100,
  skip: 0,
};
const MOCK_EXISTING_DOCUMENT = {
  id: "doc-existing-test",
  document_number: "BJJ-2026-001",
  template: { id: "tpl-existing-test", name: "남동구 계약서" },
  document_name: "기존 전자문서",
  creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
  created_date: Date.parse("2026-05-01T09:00:00.000Z"),
  last_editor: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
  updated_date: Date.parse("2026-05-01T09:00:00.000Z"),
  recipients: [{ recipient_type: "02", name: "기존고객", sms: "01099998888" }],
  current_status: {
    status_type: "060",
    status_doc_type: "대기",
    status_doc_detail: "대기",
    step_type: "05",
    step_index: "2",
    step_name: "이용자 서명",
    step_recipients: [{ recipient_type: "02", name: "기존고객", sms: "01099998888" }],
    step_group: 1,
    expired_date: Date.parse("2026-06-01T09:00:00.000Z"),
    _expired: false,
  },
  fields: [],
  next_status: [],
  previous_status: [],
  histories: [],
};

async function installCommonRoutes(
  page: Page,
  options: {
    documentList?: typeof MOCK_DOCUMENT_LIST;
    detailDocument?: typeof MOCK_EXISTING_DOCUMENT;
  } = {},
) {
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

    return route.fallback();
  });

  // The form waits for the branch holiday calendar before it computes or saves
  // dates. Serve the built-in list for whichever year is requested. Registered
  // after the catch-all above because Playwright matches the last route first.
  await page.route("**/api/branches/*/holidays*", (route) => {
    const year = Number(new URL(route.request().url()).searchParams.get("year"));
    const dates = KOREAN_HOLIDAY_CALENDAR[year] ?? [];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        year,
        revision: "e2e-builtin",
        supported: dates.length > 0,
        synced: false,
        lastSyncedAt: null,
        holidays: dates.map((date) => ({ date, name: "공휴일", source: "builtin", excluded: false, overrideId: null })),
        inactiveOverrides: [],
      }),
    });
  });

  await page.route("**/api/eformsign/auth-status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ hasAppAuthToken: true, hasAccessToken: true, hasRefreshToken: true }),
    })
  );
  await page.route("**/api/eformsign/documents**", (route) => {
    const url = new URL(route.request().url());
    if (options.detailDocument && url.pathname.endsWith(`/api/eformsign/documents/${options.detailDocument.id}`)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(options.detailDocument),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.documentList ?? MOCK_DOCUMENT_LIST),
    });
  });
  await page.route("**/api/eformsign-docs/client-names", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/clients/1", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CLIENT) })
  );
  await page.route("**/api/clients", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([MOCK_CLIENT]),
      });
    }

    return route.fallback();
  });
  await page.route("**/api/employees", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_EMPLOYEES) })
  );
  await page.route("**/api/voucher-price-infos/years", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([2026]) })
  );
  await page.route("**/api/voucher-price-infos/type**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_VOUCHER_PRICE_INFOS),
    })
  );
  await page.route("**/api/area-templates", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_AREA_TEMPLATES),
    })
  );
  await page.route("**/api/bank-account-infos", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/access-token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) })
  );
}


async function gotoContractsPage(page: Page) {
  await page.goto("/contracts");
}

const CREATION_FORM = '[data-component="desktop_contracts_creation_form"]';
const STEPPER = '[data-component="desktop_v3_stepped-wizard_stepper-desktop"]';
const STEP_CONTENT = '[data-component="desktop_v3_stepped-wizard_step-content"]';

async function openContractCreationForm(page: Page) {
  await gotoContractsPage(page);
  await page.getByRole("button", { name: "전자문서 발송" }).click();
  await expect(page.locator(CREATION_FORM)).toBeVisible();
  await expect(page.getByRole("heading", { name: "전자계약서 작성" })).toBeVisible();
  await expect(page.locator(STEPPER)).toBeVisible();
  await expect(page.locator(STEPPER)).toContainText("전자문서 생성");
}

async function selectClient(page: Page, name: string) {
  const trigger = page.getByRole("combobox", { name: "산모님 성함", exact: true });
  await trigger.click();
  await page.getByRole("combobox", { name: "산모님 성함 검색" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(trigger).toContainText(name);
}

async function selectDocType(page: Page, label: string) {
  const trigger = page.getByRole("combobox", { name: "계약서 선택" });
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toContainText(label);
}

async function selectEmployee(page: Page, index: number, name: string) {
  const label = `제공인력 ${index + 1} 선택`;
  const trigger = page.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("combobox", { name: `${label} 검색` }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(trigger).toContainText(name);
}

async function fillVoucherStep(page: Page) {
  // The three voucher selects have no accessible names yet, so address them by position.
  const selects = page.locator(`${STEP_CONTENT} select`);
  await selects.nth(0).selectOption("2026");
  await selects.nth(1).selectOption("A가1형");
  await expect(selects).toHaveCount(3);
  await selects.nth(2).selectOption("10");
  await expect(page.locator('input[value="1,234,567"]')).toBeVisible();
  await expect(page.locator('input[value="1,000,000"]')).toBeVisible();
  await expect(page.locator('input[value="234,567"]')).toBeVisible();
}

async function fillContractDates(page: Page, values: { startDate: string; endDate: string; paymentDate: string }) {
  // Dates are typed as YYYY-MM-DD (auto-hyphenated text inputs with example placeholders).
  await page.locator('[data-component="desktop_contracts_creation_form_start-date-input"]').fill(values.startDate);
  await page.locator('[data-component="desktop_contracts_creation_form_end-date-input"]').fill(values.endDate);
  await page.locator('[data-component="desktop_contracts_creation_form_payment-date-input"]').fill(values.paymentDate);
}

async function completeContractWizard(page: Page) {
  await selectClient(page, MOCK_CLIENT.name);
  await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
  await page.getByTestId("contract-creation-next").click();

  await selectEmployee(page, 0, MOCK_EMPLOYEES[0].name);
  await page.getByTestId("contract-creation-next").click();

  await fillVoucherStep(page);
  await page.getByTestId("contract-creation-next").click();

  await fillContractDates(page, {
    startDate: "2026-06-01",
    endDate: "2026-06-15",
    paymentDate: "2026-06-03",
  });
}

/**
 * Submit the contract info step. The mocked client record has none of the contract's area, provider,
 * voucher or date values, so the app asks whether to copy them to the client record too.
 */
async function submitContractCreation(page: Page, choice: "contract-only" | "update-client" = "update-client") {
  await page.getByTestId("contract-creation-submit").click();
  const mismatchDialog = page.getByRole("dialog", { name: "고객 정보와 다른 내용이 있어요" });
  await expect(mismatchDialog).toBeVisible();
  await mismatchDialog
    .getByRole("button", { name: choice === "update-client" ? "고객 정보도 수정" : "계약서에만 반영" })
    .click();
  await expect(mismatchDialog).toBeHidden();
}

// Contract creation is queue-only: the form PATCHes the client record (when the staff member keeps the
// contract's values), POSTs one job to /api/eformsign-docs/jobs/creation, shows a toast and closes.
// The backend job creates and sends the document, so the browser never opens the eformsign editor,
// never calls dispatch-headless / generate-document and never saves the document record itself.
const JOB_CREATION_ROUTE = "**/api/eformsign-docs/jobs/creation";
const JOB_CREATION_PATH = "/api/eformsign-docs/jobs/creation";
const QUEUED_JOB = { jobId: "job-create-test", status: "queued", existing: false };
// ContractCreationForm.tsx:1337 (no supersedeDocumentId)
const CREATION_STARTED_TOAST = "전자문서 생성을 시작했어요";
// ContractCreationForm.tsx:1325 (an enqueue that is not known to have been rejected)
const UNCERTAIN_ENQUEUE_MESSAGE = "전송 여부를 확인하지 못했어요. 처리중 목록에서 이 고객의 작업을 확인해 주세요.";
// ContractCreationForm.tsx:1347 (generic fallback for a rejected enqueue without a registered problem message)
const GENERIC_CREATION_FAILURE_MESSAGE = "계약서 생성 중 오류가 발생했어요.";
const CREATION_ERROR_ALERT = '[data-component="desktop_messages_sections_contract-form-error"]';
const WIZARD_STEP_CIRCLE = '[data-component="desktop_v3_stepped-wizard_stepper-desktop_item_step_circle"]';

async function stubClientPatch(page: Page, onPatch?: (body: Record<string, unknown>) => void) {
  await page.route("**/api/clients/1", async (route) => {
    if (route.request().method() === "PATCH") {
      onPatch?.(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_CLIENT) });
    }
    return route.fallback();
  });
}

/** Requests the removed iframe / headless creation path used to make; the queue flow must make none of them. */
function trackLegacyCreationRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (
      pathname === "/api/generate-document"
      || pathname.startsWith("/api/eformsign-docs/dispatch-headless")
      || (pathname === "/api/eformsign-docs" && method === "POST")
    ) {
      hits.push(`${method} ${pathname}`);
    }
  });
  return hits;
}

test.describe("Contract creation queue flow", () => {

  test("persists the selected provider assignment before queueing the electronic document job", async ({ page }) => {
    await installCommonRoutes(page);

    const requestOrder: string[] = [];
    let capturedClientUpdateBody: Record<string, unknown> | null = null;
    await stubClientPatch(page, (body) => {
      requestOrder.push("assignment");
      capturedClientUpdateBody = body;
    });
    await page.route(JOB_CREATION_ROUTE, (route) => {
      requestOrder.push("document");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUEUED_JOB) });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    await expect.poll(() => requestOrder).toEqual(["assignment", "document"]);
    expect(capturedClientUpdateBody).toEqual(expect.objectContaining({
      primaryEmployeeId: MOCK_EMPLOYEES[0].id,
      secondaryEmployeeId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-15",
    }));
  });

  test("keeps voucher duration and price fields visible but disabled before voucher selections", async ({ page }) => {
    await installCommonRoutes(page);
    await openContractCreationForm(page);
    await selectClient(page, MOCK_CLIENT.name);
    await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
    await page.getByTestId("contract-creation-next").click();

    await selectEmployee(page, 0, MOCK_EMPLOYEES[0].name);
    await page.getByTestId("contract-creation-next").click();

    const stepContent = page.locator(STEP_CONTENT);
    const selects = stepContent.locator("select");
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(2)).toBeVisible();
    await expect(selects.nth(2)).toBeDisabled();

    const priceFields = page.locator('[data-component="desktop_contracts_creation_price-fields"]');
    await expect(priceFields).toBeVisible();

    const priceInputs = priceFields.locator("input");
    await expect(priceInputs).toHaveCount(3);
    await expect(priceInputs.nth(0)).toBeDisabled();
    await expect(priceInputs.nth(1)).toBeDisabled();
    await expect(priceInputs.nth(2)).toBeDisabled();

    await selects.nth(1).selectOption("A가1형");
    await expect(selects.nth(2)).toBeEnabled();
    await expect(priceInputs.nth(0)).toBeDisabled();
    await expect(priceInputs.nth(1)).toBeDisabled();
    await expect(priceInputs.nth(2)).toBeDisabled();

    await selects.nth(2).selectOption("10");
    await expect(priceInputs.nth(0)).toBeEnabled();
    await expect(priceInputs.nth(1)).toBeEnabled();
    await expect(priceInputs.nth(2)).toBeEnabled();
  });

  test("walks the wizard, queues one creation job with the contract data, and closes the form", async ({ page }) => {
    let capturedClientUpdateBody: Record<string, unknown> | null = null;
    const capturedJobRequests: Array<{ method: string; pathname: string; body: Record<string, unknown> }> = [];

    await installCommonRoutes(page);
    const legacyRequests = trackLegacyCreationRequests(page);
    await stubClientPatch(page, (body) => {
      capturedClientUpdateBody = body;
    });
    await page.route(JOB_CREATION_ROUTE, (route) => {
      capturedJobRequests.push({
        method: route.request().method(),
        pathname: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUEUED_JOB) });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
    await submitContractCreation(page);

    await expect.poll(() => capturedClientUpdateBody).not.toBeNull();
    expect(capturedClientUpdateBody).toEqual(expect.objectContaining({
      primaryEmployeeId: MOCK_EMPLOYEES[0].id,
      secondaryEmployeeId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-15",
    }));

    await expect.poll(() => capturedJobRequests.length).toBe(1);
    const [jobRequest] = capturedJobRequests;
    expect(jobRequest.method).toBe("POST");
    expect(jobRequest.pathname).toBe(JOB_CREATION_PATH);
    expect(jobRequest.body).toEqual({
      requestKey: expect.any(String),
      clientId: MOCK_CLIENT.id,
      contractData: expect.objectContaining({
        customerName: MOCK_CLIENT.name,
        customerContact: "010-1234-5678",
        customerDOB: MOCK_CLIENT.birthday,
        customerAddress: MOCK_CLIENT.address,
        caretaker1Name: MOCK_EMPLOYEES[0].name,
        caretaker1Contact: "010-0000-0000",
        type: "A가1형",
        days: "10",
        area: MOCK_AREA_TEMPLATES[0].areaId,
        fullPrice: MOCK_VOUCHER_PRICE_INFOS[0].fullPrice,
        grant: MOCK_VOUCHER_PRICE_INFOS[0].grant,
        actualPrice: MOCK_VOUCHER_PRICE_INFOS[0].actualPrice,
        startDate: "2026-06-01",
        paymentYear: "26",
        paymentMonth: "06",
        paymentDay: "03",
      }),
    });
    expect((jobRequest.body.requestKey as string).length).toBeGreaterThan(0);

    // Accepted: the toast replaces the old success modal, and the form closes by itself.
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toBeVisible();
    await expect(page.locator(CREATION_FORM)).toHaveCount(0);

    // The job — not the browser — creates the document and saves its record.
    expect(legacyRequests).toEqual([]);
  });

  test("shows the 전자문서 생성 step without actions while the job is being accepted, then closes the form", async ({ page }) => {
    await installCommonRoutes(page);
    await stubClientPatch(page);

    let releaseJob: () => void = () => undefined;
    const jobCanFinish = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    await page.route(JOB_CREATION_ROUTE, async (route) => {
      await jobCanFinish;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUEUED_JOB) });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    // The wizard sits on its last step (전자문서 생성) with every navigation / submit action hidden.
    await expect(page.locator(WIZARD_STEP_CIRCLE).nth(4)).toHaveClass(/scale-110/);
    await expect(page.getByTestId("contract-creation-next")).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-back")).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-submit")).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-retry")).toHaveCount(0);
    await expect(page.getByTestId("contract-creation-new-send")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "취소" })).toHaveCount(0);
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toHaveCount(0);

    releaseJob();
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toBeVisible();
    await expect(page.locator(CREATION_FORM)).toHaveCount(0);
  });

  test("step 1 keeps 다음 disabled until the required selections are complete", async ({ page }) => {
    await installCommonRoutes(page);

    await openContractCreationForm(page);

    const nextButton = page.getByTestId("contract-creation-next");
    await expect(nextButton).toBeDisabled();

    await selectClient(page, MOCK_CLIENT.name);
    await expect(nextButton).toBeDisabled();

    await selectDocType(page, MOCK_AREA_TEMPLATE_DISPLAY_LABEL);
    await expect(nextButton).toBeEnabled();
  });

  test("returns to the in-progress creation detail instead of starting a new send session", async ({ page }) => {
    await installCommonRoutes(page, {
      documentList: {
        documents: [MOCK_EXISTING_DOCUMENT],
        total_rows: 1,
        limit: 100,
        skip: 0,
      },
      detailDocument: MOCK_EXISTING_DOCUMENT,
    });
    await stubClientPatch(page);

    let releaseJob: () => void = () => undefined;
    const jobCanFinish = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });
    await page.route(JOB_CREATION_ROUTE, async (route) => {
      await jobCanFinish;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "rejected after retained-session assertion" }),
      });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    await expect(page.locator(WIZARD_STEP_CIRCLE).nth(4)).toHaveClass(/scale-110/);
    // The list shows the CRM client name (none is mapped here), so find the row by its document name.
    await page.getByRole("button", { name: /기존 전자문서/ }).click();
    await expect(page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]')).toBeVisible();
    await expect(page.locator(CREATION_FORM)).toBeHidden();

    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]').click();
    await expect(page.locator(CREATION_FORM)).toBeVisible();
    await expect(page.locator(WIZARD_STEP_CIRCLE).nth(4)).toHaveClass(/scale-110/);
    await expect(page.getByTestId("contract-creation-submit")).toHaveCount(0);

    // The retained session, not a new one, receives the outcome: a rejected job lands on 계약 정보.
    releaseJob();
    await expect(page.locator(CREATION_ERROR_ALERT)).toContainText(GENERIC_CREATION_FAILURE_MESSAGE);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
  });

  test("keeps the same request key when the unconfirmed job is sent again", async ({ page }) => {
    await installCommonRoutes(page);
    await stubClientPatch(page);

    const jobBodies: Array<Record<string, unknown>> = [];
    await page.route(JOB_CREATION_ROUTE, (route) => {
      jobBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      // A 5xx leaves it unknown whether the job was accepted, so the form must not claim it was not.
      return jobBodies.length === 1
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(QUEUED_JOB) });
    });

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    await expect(page.locator(CREATION_ERROR_ALERT)).toContainText(UNCERTAIN_ENQUEUE_MESSAGE);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toHaveCount(0);

    await page.getByTestId("contract-creation-submit").click();
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toBeVisible();
    await expect(page.locator(CREATION_FORM)).toHaveCount(0);

    // The resend is the same request, so the server can recognise a job it already accepted.
    expect(jobBodies).toHaveLength(2);
    expect(jobBodies[1]).toEqual(jobBodies[0]);
  });

  test("a rejected job shows an error and does not close the form", async ({ page }) => {
    await installCommonRoutes(page);
    await stubClientPatch(page);
    const legacyRequests = trackLegacyCreationRequests(page);
    await page.route(JOB_CREATION_ROUTE, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    );

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    await expect(page.locator(CREATION_ERROR_ALERT)).toContainText(GENERIC_CREATION_FAILURE_MESSAGE);
    await expect(page.locator(CREATION_FORM)).toBeVisible();
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toHaveCount(0);
    // There is no editor fallback any more: a failed job never opens eformsign or another endpoint.
    expect(legacyRequests).toEqual([]);
  });

  test("a rejected job returns to the contract info step", async ({ page }) => {
    await installCommonRoutes(page);
    await stubClientPatch(page);
    await page.route(JOB_CREATION_ROUTE, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
    );

    await openContractCreationForm(page);
    await completeContractWizard(page);
    await submitContractCreation(page);

    await expect(page.locator(
      [
        '[data-component="desktop_contracts_creation_form_start-date-input"]',
        '[data-component="desktop_contracts_creation_form_end-date-input"]',
        '[data-component="desktop_contracts_creation_form_payment-date-input"]',
      ].join(", ")
    )).toHaveCount(3);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();
  });
});
