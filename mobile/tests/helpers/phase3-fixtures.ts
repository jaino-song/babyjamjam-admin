import { expect, type Page, type Route } from "@playwright/test";

export const phase3Json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

export const PHASE3_EMPLOYEES = [
  {
    id: 11,
    name: "테스트직원",
    workArea: ["인천"],
    phone: "010-1111-1111",
    grade: "베스트",
    openToNextWork: true,
    registeredDate: "2026-06-01",
    status: "available",
  },
  {
    id: 12,
    name: "보조직원",
    workArea: ["인천"],
    phone: "010-2222-2222",
    grade: "프리미엄",
    openToNextWork: true,
    registeredDate: "2026-06-01",
    status: "available",
  },
];

export const PHASE3_OUT_OF_POCKET_PRICES = [
  { id: 1, duration: 5, fullPrice: "815000" },
  { id: 2, duration: 10, fullPrice: "1620000" },
  { id: 3, duration: 15, fullPrice: "2425000" },
  { id: 4, duration: 20, fullPrice: "3240000" },
];

/**
 * Install deterministic browser-side API responses for the authenticated shell.
 * The fixture deliberately stays in tests: it does not change the E2E auth
 * policy or the application's backend routes.
 */
export async function installPhase3ShellFixture(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    await route.fulfill(phase3Json([]));
  });

  await page.route("**/api/auth/me**", async (route: Route) => {
    await route.fulfill(
      phase3Json({
        id: "e2e-user",
        name: "E2E Owner",
        role: "owner",
        branchName: "테스트 지점",
      }),
    );
  });
  await page.route("**/api/notifications/vapid-key**", async (route: Route) => {
    await route.fulfill(phase3Json({ publicKey: "test-vapid-key" }));
  });
  await page.route("**/api/notifications/unread/count**", async (route: Route) => {
    await route.fulfill(phase3Json({ count: 0 }));
  });
  await page.route("**/api/notifications**", async (route: Route) => {
    await route.fulfill(phase3Json([]));
  });
}

export async function installPhase3WizardFixture(
  page: Page,
  options: {
    onCreate?: (route: Route) => Promise<boolean | void> | boolean | void;
    employees?: unknown[];
    onEmployees?: (route: Route) => Promise<void> | void;
  } = {},
) {
  await installPhase3ShellFixture(page);

  await page.route("**/api/employees**", async (route: Route) => {
    if (options.onEmployees) {
      await options.onEmployees(route);
      return;
    }
    await route.fulfill(phase3Json(options.employees ?? PHASE3_EMPLOYEES));
  });
  await page.route("**/api/bank-account-infos**", async (route: Route) => {
    await route.fulfill(
      phase3Json([{ area: "area-incheon", bankName: "국민은행", accNum: "123-456-7890" }]),
    );
  });
  await page.route("**/api/clients/check-phone**", async (route: Route) => {
    await route.fulfill(phase3Json({ exists: false }));
  });
  await page.route("**/api/voucher-price-infos/type**", async (route: Route) => {
    await route.fulfill(phase3Json([]));
  });
  await page.route("**/api/out-of-pocket-price-infos**", async (route: Route) => {
    await route.fulfill(phase3Json(PHASE3_OUT_OF_POCKET_PRICES));
  });
  await page.route("**/api/clients**", async (route: Route) => {
    if (route.request().method() === "POST") {
      const handled = await options.onCreate?.(route);
      if (handled === true) return;
      await route.fulfill(phase3Json({ id: 501, name: "홍테스트 고객" }, 201));
      return;
    }
    await route.fulfill(phase3Json([]));
  });
}

export const phase3Selectors = {
  actions: '[data-component="mobile_clients-new_screen_root_page_wizard_actions"] button',
  phone:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_phone-field_phone-input"]',
  birthday:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-details-card_birthday-field_birthday-input"]',
  dueDate:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-details-card_due-date-field_due-date-input"]',
  address:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card_address-field_address-input"]',
  employeeCard:
    'mobile_clients-new_screen_root_page_wizard_form-scroll_employee-card',
  primaryAutocomplete:
    'mobile_clients-new_screen_root_page_wizard_form-scroll_employee-card_primary-field_autocomplete',
  durationSelect:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_duration-field_select-wrap_select"]',
  selfPayToggle:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card_customer-type-field_toggle_self-pay-button"]',
  startDate:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_service-period-card_start-date-field_start-date-input"]',
  endDate:
    '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_service-period-card_end-date-field_end-date-input"]',
};

export async function fillPhase3BasicInfo(
  page: Page,
  values: { name?: string; phone?: string; birthday?: string; dueDate?: string; address?: string } = {},
) {
  await page.getByPlaceholder("홍길동").fill(values.name ?? "홍테스트 고객");
  await page.getByPlaceholder("010-1234-5678").fill(values.phone ?? "01011112222");
  await page.locator(phase3Selectors.birthday).fill(values.birthday ?? "950101");
  await page.locator(phase3Selectors.dueDate).fill(values.dueDate ?? "2026-09-01");
  await page.getByPlaceholder("서울시 강남구...").fill(values.address ?? "인천광역시 연수구 테스트로 10");

  await expectPhoneAvailable(page);
}

export async function expectPhoneAvailable(page: Page) {
  await expect(
    page.locator(
      '[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_basic-contact-card"] [data-component$="_phone-field_helper"]',
    ),
  ).toContainText("등록 가능한 번호입니다.");
}

export async function advanceWizardStep(page: Page) {
  await page.locator(phase3Selectors.actions).nth(1).click();
}

export async function goToPhase3ServiceStep(page: Page) {
  await fillPhase3BasicInfo(page);
  await advanceWizardStep(page);
  await page
    .locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_voucher-card"]')
    .waitFor({ state: "visible" });
}

export async function selectPhase3SelfPayDuration(page: Page, duration = "15") {
  const selfPayToggle = page.locator(phase3Selectors.selfPayToggle);
  if ((await selfPayToggle.getAttribute("aria-selected")) !== "true") {
    await selfPayToggle.click();
  }
  const durationSelect = page.locator(phase3Selectors.durationSelect);
  await durationSelect.selectOption(duration);
}

export async function goToPhase3ContractStep(page: Page, duration = "15") {
  await goToPhase3ServiceStep(page);
  await selectPhase3SelfPayDuration(page, duration);
  await advanceWizardStep(page);
  await page
    .locator('[data-component="mobile_clients-new_screen_root_page_wizard_form-scroll_contract-status-card"]')
    .waitFor({ state: "visible" });
}

export function phase3EmployeeOption(page: Page, index = 1) {
  return page.locator(
    `[data-component="${phase3Selectors.primaryAutocomplete}_option-${index}"]`,
  );
}
