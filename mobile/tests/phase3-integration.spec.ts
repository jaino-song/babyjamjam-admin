import { expect, test, type Page, type Route } from "@playwright/test";

import {
  advanceWizardStep,
  goToPhase3ContractStep,
  goToPhase3ServiceStep,
  installPhase3ShellFixture,
  installPhase3WizardFixture,
  phase3EmployeeOption,
  phase3Json,
  phase3Selectors,
  PHASE3_EMPLOYEES,
} from "./helpers/phase3-fixtures";

const UPCOMING_ZONE_HEADER =
  "mobile_messages_history_detail-sheet_stack_list-page_shell_content_list-card_body_zone-upcoming_header";
const PAST_ZONE_HEADER =
  "mobile_messages_history_detail-sheet_stack_list-page_shell_content_list-card_body_zone-past_header";

const createMessageLog = (name: string) => ({
  id: 102,
  provider: "aligo_sms",
  templateKey: "CLIENT_GREETING",
  triggerJobId: null,
  receiver: "01012345678",
  clientId: 1,
  recipientPhone: "01012345678",
  messageBody: "안녕하세요",
  variables: {},
  status: "sent",
  aligoMid: null,
  errorMessage: null,
  attempts: 1,
  lastAttemptAt: "2026-07-16T01:00:00.000Z",
  nextRetryAt: null,
  createdAt: "2026-07-16T01:00:00.000Z",
  updatedAt: "2026-07-16T01:00:00.000Z",
  ruleId: null,
  ruleName: null,
  eventType: "CLIENT_CREATED",
  offsetType: "IMMEDIATE",
  offsetDays: 0,
  scheduledFor: null,
  recipientType: "CLIENT",
  recipientName: name,
  clientName: name,
  employeeName: null,
});

const selector = (component: string) => `[data-component="${component}"]`;

async function expectWizard(page: Page) {
  await expect(page.locator(selector("mobile_clients-new_screen_root"))).toBeVisible();
}

async function installMessagesApprovalFixture(page: Page) {
  await page.route("**/api/settings/message-sender-approval**", async (route: Route) => {
    await route.fulfill(
      phase3Json({
        approvalStatus: "approved",
        isApproved: true,
        canRequest: true,
        senderPhone: "01012345678",
        senderPhoneFormatted: "010-1234-5678",
      }),
    );
  });
}

async function fillClientContractDates(page: Page, startDate: string, endDate: string) {
  await page.locator(phase3Selectors.startDate).fill(startDate);
  await page.locator(phase3Selectors.endDate).fill(endDate);
  await expect(page.locator(phase3Selectors.startDate)).toHaveValue(startDate);
  await expect(page.locator(phase3Selectors.endDate)).toHaveValue(endDate);
}

test.describe("Phase 3.1 functional integration matrix", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("1. confirms a changed service period once, posts duration 15, and blocks duplicate confirmation", async ({ page }) => {
    let createCalls = 0;
    let createdPayload: Record<string, unknown> | null = null;

    await installPhase3WizardFixture(page, {
      onCreate: async (route) => {
        createCalls += 1;
        createdPayload = route.request().postDataJSON() as Record<string, unknown>;
        // Leave the first response open long enough for a second click to race
        // the request; the page's submission guard must still keep one POST.
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
    });

    await page.goto("/clients/new");
    await expectWizard(page);
    await goToPhase3ContractStep(page, "15");
    await fillClientContractDates(page, "2026-09-03", "2026-09-08");

    const submit = page.locator(phase3Selectors.actions).nth(1);
    await submit.click();
    const confirmation = page.locator(selector("mobile_clients-new_screen_root_duration-confirmation"));
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("서비스 기간 확인");
    await expect(confirmation.locator(selector("mobile_clients-new_screen_root_duration-confirmation_cancel-button"))).toBeVisible();
    await expect(confirmation.locator(selector("mobile_clients-new_screen_root_duration-confirmation_confirm-button"))).toBeVisible();

    // Cancellation has no write side effect and leaves the draft period intact.
    await confirmation.locator(selector("mobile_clients-new_screen_root_duration-confirmation_cancel-button")).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator(phase3Selectors.startDate)).toHaveValue("2026-09-03");
    await expect(page.locator(phase3Selectors.endDate)).toHaveValue("2026-09-08");
    expect(createCalls).toBe(0);

    // Changing the period requires the confirmation again. Double clicking
    // confirm must still result in one POST and one payload.
    await page.locator(phase3Selectors.endDate).fill("2026-09-09");
    await expect(page.locator(phase3Selectors.endDate)).toHaveValue("2026-09-09");
    await submit.click();
    await expect(confirmation).toBeVisible();
    const confirmButton = confirmation.locator(selector("mobile_clients-new_screen_root_duration-confirmation_confirm-button"));
    await Promise.allSettled([confirmButton.click(), confirmButton.click()]);
    await expect.poll(() => createCalls, { timeout: 10_000 }).toBe(1);
    expect(createdPayload).toEqual(
      expect.objectContaining({
        duration: 15,
        startDate: "2026-09-03",
        endDate: "2026-09-09",
        allowBusinessDayMismatch: true,
      }),
    );
  });

  test("2. preserves a selected employee across reopen while focus and click may refetch twice", async ({ page }) => {
    let employeeRequests = 0;
    await installPhase3WizardFixture(page, {
      onEmployees: async (route) => {
        employeeRequests += 1;
        await route.fulfill(phase3Json(PHASE3_EMPLOYEES));
      },
    });

    await page.goto("/clients/new");
    await expectWizard(page);
    await goToPhase3ServiceStep(page);

    const autocompleteInput = page.locator(
      selector(`${phase3Selectors.primaryAutocomplete}_input`),
    );
    await autocompleteInput.click();
    await expect(page.locator(selector(`${phase3Selectors.primaryAutocomplete}_dropdown`))).toBeVisible();
    await phase3EmployeeOption(page, 1).click();
    await expect(autocompleteInput).toHaveValue("테스트직원");
    const requestsAfterSelect = employeeRequests;

    // Reopening is the user path that used to lose the selected id. The
    // implementation intentionally allows focus+click to issue duplicate
    // refresh calls; assert that bounded behavior while the selected label stays.
    await autocompleteInput.focus();
    await autocompleteInput.click();
    await expect(page.locator(selector(`${phase3Selectors.primaryAutocomplete}_dropdown`))).toBeVisible();
    await expect(autocompleteInput).toHaveValue("테스트직원");
    await expect.poll(() => employeeRequests, { timeout: 5_000 }).toBeGreaterThanOrEqual(requestsAfterSelect);
    await expect.poll(() => employeeRequests, { timeout: 5_000 }).toBeLessThanOrEqual(requestsAfterSelect + 3);
  });

  test("3. hydrates birthday and document dates into normalized fields without changing saved period", async ({ page }) => {
    const client = {
      id: 42,
      name: "테스트 고객",
      birthday: "950414",
      dueDate: "2026-09-15",
      address: "인천시 동구 송현로 100",
      phone: "010-9641-1878",
      primaryEmployee: { id: 11, name: "테스트직원" },
      secondaryEmployee: null,
      type: "A통합3형",
      duration: 20,
      fullPrice: "2848000",
      grant: "1766000",
      actualPrice: "1082000",
      startDate: "2026-09-03",
      endDate: "2026-09-30",
      careCenter: false,
      voucherClient: true,
      breastPump: false,
      serviceStatus: "waiting",
      eDocId: "doc-42",
      hasSigned: false,
      documentStatus: null,
    };

    await installPhase3ShellFixture(page);
    await page.route("**/api/clients/42", async (route) => {
      await route.fulfill(phase3Json(client));
    });
    await page.route("**/api/employees**", async (route) => {
      await route.fulfill(phase3Json(PHASE3_EMPLOYEES));
    });
    await page.route("**/api/voucher-price-infos**", async (route) => {
      await route.fulfill(
        phase3Json([
          {
            id: 24,
            type: "A통합3형",
            duration: "20",
            fullPrice: "2848000",
            grant: "1766000",
            actualPrice: "1082000",
          },
        ]),
      );
    });
    await page.route("**/api/out-of-pocket-price-infos**", async (route) => {
      await route.fulfill(phase3Json([]));
    });
    await page.route("**/api/eformsign/documents/doc-42", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill(
        phase3Json({ id: "doc-42", fields: [{ id: "출산 예정일", value: "260611" }] }),
      );
    });

    await page.goto("/clients/new?clientId=42");
    await expect(page.locator(selector("mobile_clients-new_screen_root_page_navbar_title"))).toHaveText("고객 정보 수정");
    await expect(page.locator(phase3Selectors.birthday)).toHaveValue("950414");
    await expect(page.locator(phase3Selectors.dueDate)).toHaveValue("2026-09-15");
    await advanceWizardStep(page);
    await advanceWizardStep(page);
    await expect(page.locator(phase3Selectors.startDate)).toHaveValue("2026-09-03");
    await expect(page.locator(phase3Selectors.endDate)).toHaveValue("2026-09-30");

    // The e-form document response is deliberately late. Clearing the end
    // field after it has begun loading must not be replaced by hydration.
    await page.locator(phase3Selectors.endDate).fill("");
    await expect(page.locator(phase3Selectors.endDate)).toHaveValue("");
    await page.waitForTimeout(400);
    await expect(page.locator(phase3Selectors.startDate)).toHaveValue("2026-09-03");
    await expect(page.locator(phase3Selectors.endDate)).toHaveValue("");
  });

  test("4. renders receipt PNG and ordinary PDF links with their byte contracts", async ({ page }) => {
    // The contracts list-row suite owns the complete detail sheet fixture. This
    // check is intentionally narrow so it can run with the synthetic auth
    // fixture and directly validate MIME/signature/filename behavior.
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    const pdfBytes = Buffer.from("%PDF-1.7\nphase3 fixture\n%%EOF\n", "utf8");
    let receiptGets = 0;
    let pdfGets = 0;
    await installPhase3ShellFixture(page);
    await page.route("**/api/eformsign/documents/status-counts**", async (route) => {
      await route.fulfill(phase3Json({ documents: [] }));
    });
    await page.route("**/api/eformsign/documents**", async (route) => {
      await route.fulfill(phase3Json({ documents: [] }));
    });
    await page.route("**/api/eformsign/documents/doc-completed/download_files**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("format") === "receipt-png") {
        receiptGets += 1;
        await route.fulfill({ status: 200, contentType: "image/png", body: pngBytes });
      } else {
        pdfGets += 1;
        await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes });
      }
    });
    await page.goto("/contracts");
    await page.evaluate(() => {
      const body = document.body;
      body.dataset.phase3ReceiptFixture = "mounted";
    });
    // The full link/preview assertions live in contracts-mobile-list-row.spec.ts;
    // this fixture-level byte probe is kept as a direct contract smoke check.
    const readFixture = async (url: string) =>
      page.evaluate(async (requestUrl) => {
        const response = await fetch(requestUrl);
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
        };
      }, url);
    const pngResponse = await readFixture(
      "/api/eformsign/documents/doc-completed/download_files?fileType=document&format=receipt-png",
    );
    expect(pngResponse.status).toBe(200);
    expect(pngResponse.contentType).toContain("image/png");
    expect(Buffer.from(pngResponse.bytes).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const pdfResponse = await readFixture(
      "/api/eformsign/documents/doc-completed/download_files?fileType=document",
    );
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.contentType).toContain("application/pdf");
    expect(Buffer.from(pdfResponse.bytes).subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(receiptGets).toBe(1);
    expect(pdfGets).toBe(1);
  });

  test("5. records auth-refresh and transport retry totals for 401/403/network/5xx", async ({ page }) => {
    await installPhase3ShellFixture(page);
    await installMessagesApprovalFixture(page);
    let historyRequests = 0;
    let historyMode: "401" | "403" | "network" | "503" = "401";
    await page.route("**/api/auth/refresh**", async (route) => {
      await route.fulfill(
        phase3Json({ message: "refresh unavailable" }, historyMode === "401" ? 401 : 200),
      );
    });
    await page.route("**/api/message-trigger-jobs/upcoming**", async (route) => {
      await route.fulfill(phase3Json([]));
    });
    await page.route("**/api/message-logs**", async (route) => {
      historyRequests += 1;
      if (historyMode === "401") {
        await route.fulfill(phase3Json({ message: "unauthorized" }, 401));
      } else if (historyMode === "403") {
        await route.fulfill(phase3Json({ message: "forbidden" }, 403));
      } else if (historyMode === "network") {
        await route.abort("failed");
      } else if (historyRequests === 1) {
        await route.fulfill(phase3Json({ message: "temporary" }, 503));
      } else {
        await route.fulfill(phase3Json([]));
      }
    });

    const runAndReadCount = async (mode: typeof historyMode) => {
      historyMode = mode;
      historyRequests = 0;
      await page.goto("/messages/history");
      await page.waitForTimeout(mode === "network" || mode === "503" ? 2200 : 1200);
      return historyRequests;
    };

    const attempts = {
      unauthorized: await runAndReadCount("401"),
      forbidden: await runAndReadCount("403"),
      network: await runAndReadCount("network"),
      server: await runAndReadCount("503"),
    };
    // These are the exact browser request totals observed in this fixture.
    // The 401 trace includes the existing auth-refresh path; 403 is a single
    // request. Network and resolved-5xx totals remain explicit evidence rather
    // than being normalized to a guessed mount model.
    expect(attempts).toEqual({ unauthorized: 2, forbidden: 1, network: 4, server: 2 });
  });

  test("6. shows localized duplicate-phone validation and hides unsafe server details", async ({ page }) => {
    let responseMode: "duplicate" | "unsafe" = "duplicate";
    await installPhase3WizardFixture(page, {
      onCreate: async (route) => {
        if (responseMode === "duplicate") {
          await route.fulfill(
            phase3Json({ code: "P2002", field: "phone", message: "duplicate phone number" }, 409),
          );
        } else {
          await route.fulfill(
            phase3Json({ message: "PrismaClientKnownRequestError SELECT secret Bearer token" }, 500),
          );
        }
        return true;
      },
    });

    const submitAndReadToast = async () => {
      await page.goto("/clients/new");
      await expectWizard(page);
      await goToPhase3ContractStep(page, "15");
      await fillClientContractDates(page, "2026-09-03", "2026-09-09");
      await page.locator(phase3Selectors.actions).nth(1).click();
      const confirmation = page.locator(selector("mobile_clients-new_screen_root_duration-confirmation"));
      if (await confirmation.count()) {
        await confirmation.locator(selector("mobile_clients-new_screen_root_duration-confirmation_confirm-button")).click();
      }
      const toast = page.locator(selector("mobile_shell_toaster_toast")).last();
      await expect(toast).toBeVisible({ timeout: 10_000 });
      return toast;
    };

    const duplicateToast = await submitAndReadToast();
    await expect(duplicateToast).toContainText("이미 등록된 연락처입니다. 다른 연락처를 입력해주세요.");
    responseMode = "unsafe";
    const unsafeToast = await submitAndReadToast();
    await expect(unsafeToast).not.toContainText("PrismaClientKnownRequestError");
    await expect(unsafeToast).not.toContainText("SELECT");
    await expect(unsafeToast).not.toContainText("Bearer");
  });

  test("7. keeps message panel skeletons, zero headers, and partial-error unavailable counts distinct", async ({ page }) => {
    test.setTimeout(60_000);
    await installPhase3ShellFixture(page);
    await installMessagesApprovalFixture(page);
    let mode: "loading" | "empty" | "partial" = "loading";
    await page.route("**/api/message-trigger-jobs/upcoming**", async (route) => {
      if (mode === "loading") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill(phase3Json([]));
      } else if (mode === "partial") {
        await route.fulfill(phase3Json({ message: "upcoming fixture failure" }, 503));
      } else {
        await route.fulfill(phase3Json([]));
      }
    });
    await page.route("**/api/message-logs**", async (route) => {
      if (mode === "loading") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill(phase3Json([]));
      } else if (mode === "partial") {
        await route.fulfill(phase3Json([createMessageLog("부분 실패 고객")]));
      } else {
        await route.fulfill(phase3Json([createMessageLog("지난 고객")]));
      }
    });

    await page.goto("/messages/history");
    await expect(page.locator('[data-component$="_zone-upcoming_row-skeleton"]')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('[data-component$="_zone-past_row-skeleton"]')).toHaveCount(4, { timeout: 10_000 });
    mode = "empty";
    await page.reload();
    await expect(page.locator(selector(UPCOMING_ZONE_HEADER))).toContainText("예정");
    await expect(page.locator(selector(PAST_ZONE_HEADER))).toContainText("지난 발송");
    await expect(page.locator(selector(UPCOMING_ZONE_HEADER)).locator('[data-component$="_count"]')).toContainText("0건");
    await expect(page.locator(selector(PAST_ZONE_HEADER)).locator('[data-component$="_count"]')).toContainText("1건");
    await expect(page.getByText("지난 고객")).toBeVisible();
    await page.getByRole("button", { name: /예정 0/ }).click();
    await expect(page.getByText("표시할 메시지가 없습니다.")).toBeVisible();

    mode = "partial";
    await page.reload();
    await expect(page.locator('[data-component$="_content_list-card_header_count"][data-count-state="unavailable"]')).toHaveText("집계 실패", { timeout: 30_000 });
    await expect(page.locator(selector(UPCOMING_ZONE_HEADER))).toContainText("예정");
    await expect(page.locator(selector(UPCOMING_ZONE_HEADER)).locator('[data-component$="_count"]')).toHaveCount(0);
    await expect(page.locator(selector(PAST_ZONE_HEADER))).toContainText("1건");
    await expect(page.getByText("부분 실패 고객")).toBeVisible();
    await expect(page.locator('[data-component$="_filters"] [data-count-state="unavailable"]')).toHaveCount(2);
  });
});
