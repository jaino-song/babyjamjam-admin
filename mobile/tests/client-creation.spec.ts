import { expect, test, type Page } from "@playwright/test";

const VOUCHER_TYPE = "A가1형";
const VOUCHER_DURATION = "10";

const EMPLOYEES = [
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

const BANK_ACCOUNT_INFOS = [
  {
    area: "area-incheon",
    bankName: "국민은행",
    accNum: "123-456-7890",
  },
];

const VOUCHER_PRICE_INFOS = [
  {
    id: 2,
    type: VOUCHER_TYPE,
    duration: VOUCHER_DURATION,
    fullPrice: "1300000",
    grant: "1000000",
    actualPrice: "300000",
  },
];

type CreateClientPayload = Record<string, unknown>;

async function mockClientsWizardRoutes(page: Page, options?: { onCreate?: (payload: CreateClientPayload) => void }) {
  await page.route("**/api/notifications/vapid-key**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "test-vapid-key" }),
    });
  });

  await page.route("**/api/employees", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EMPLOYEES),
    });
  });

  await page.route("**/api/bank-account-infos", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(BANK_ACCOUNT_INFOS),
    });
  });

  await page.route("**/api/clients/check-phone**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ exists: false }),
    });
  });

  await page.route("**/api/voucher-price-infos/type**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const type = requestUrl.searchParams.get("type");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(type === VOUCHER_TYPE ? VOUCHER_PRICE_INFOS : []),
    });
  });

  await page.route("**/api/clients", async (route) => {
    if (route.request().method() === "POST") {
      options?.onCreate?.(route.request().postDataJSON() as CreateClientPayload);

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: 501,
          name: "홍테스트 고객",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

async function fillStepZero(page: Page) {
  await page.getByPlaceholder("홍길동").fill("홍테스트 고객");
  await page.getByPlaceholder("010-1234-5678").fill("01011112222");
  await page.getByPlaceholder("YYMMDD").nth(0).fill("950101");
  await page.getByPlaceholder("YYMMDD").nth(1).fill("260615");
  await page.getByPlaceholder("서울시 강남구...").fill("인천광역시 연수구 테스트로 10");

  await expect(
    page.locator('[data-component="clients-new-basic-contact-card"] [data-component="clients-new-form-helper"]')
  ).toContainText("등록 가능한 번호입니다.");
}

async function goToStepOne(page: Page) {
  await fillStepZero(page);
  await page.locator('[data-component="clients-new-actions"] button').nth(1).click();
  await expect(page.locator('[data-component="clients-new-voucher-card"]')).toBeVisible();
  await expect(page.locator('[data-component="clients-new-step-count"]')).toHaveText("2 / 3 단계");
}

async function fillDeterministicVoucherFields(page: Page) {
  const voucherTypeSelect = page.locator('[data-component="clients-new-voucher-card"] select').first();
  await voucherTypeSelect.selectOption(VOUCHER_TYPE);

  const durationSelect = page.locator('[data-component="clients-new-duration-select-wrap"] select');
  await expect(durationSelect.locator(`option[value="${VOUCHER_DURATION}"]`)).toHaveCount(1);
  await durationSelect.selectOption(VOUCHER_DURATION);

  await expect(page.locator('[data-component="clients-new-full-price-input-wrap"] input')).toHaveValue("1,300,000");
  await expect(page.locator('[data-component="clients-new-grant-input-wrap"] input')).toHaveValue("1,000,000");
  await expect(page.locator('[data-component="clients-new-actual-price-input-wrap"] input')).toHaveValue("300,000");
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("clients/new wizard", () => {
  test("renders the wizard shell and the initial basic-info step", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await expect(page.locator('[data-component="clients-new-page-shell"]')).toBeVisible();
    await expect(page.locator('[data-component="clients-new-wizard"]')).toBeVisible();
    await expect(page.locator('[data-component="clients-new-navbar-title"]')).toHaveText("새 고객 추가");
    await expect(page.locator('[data-component="clients-new-step-count"]')).toHaveText("1 / 3 단계");
    await expect(page.getByText("기본 정보")).toBeVisible();
    await expect(page.getByPlaceholder("홍길동")).toBeVisible();
    await expect(page.getByPlaceholder("010-1234-5678")).toBeVisible();
  });

  test("blocks advancing from step 0 while required fields are empty", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    const primaryButton = page.locator('[data-component="clients-new-actions"] button').nth(1);

    await expect(primaryButton).toBeDisabled();
    await expect(page.locator('[data-component="clients-new-step-count"]')).toHaveText("1 / 3 단계");
    await expect(page.locator('[data-component="clients-new-voucher-card"]')).toHaveCount(0);
  });

  test("advances to step 1 after filling the basic info step", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await fillStepZero(page);

    const primaryButton = page.locator('[data-component="clients-new-actions"] button').nth(1);
    await expect(primaryButton).toBeEnabled();
    await primaryButton.click();

    await expect(page.locator('[data-component="clients-new-step-count"]')).toHaveText("2 / 3 단계");
    await expect(page.getByText("서비스 설정")).toBeVisible();
    await expect(page.locator('[data-component="clients-new-voucher-card"]')).toBeVisible();
    await expect(page.locator('[data-component="clients-new-pricing-card"]')).toBeVisible();
  });

  test("renders voucher selects on step 1 and auto-fills prices from mocked voucher data", async ({ page }) => {
    await mockClientsWizardRoutes(page);
    await page.goto("/clients/new");

    await goToStepOne(page);
    await fillDeterministicVoucherFields(page);

    await expect(page.locator('[data-component="clients-new-pricing-card"]')).toContainText("자동입력");
  });

  test("submits the minimal valid wizard payload and navigates back to /clients", async ({ page }) => {
    let createdPayload: CreateClientPayload | null = null;

    await mockClientsWizardRoutes(page, {
      onCreate: (payload) => {
        createdPayload = payload;
      },
    });
    await page.goto("/clients/new");

    await fillStepZero(page);
    await page.locator('[data-component="clients-new-actions"] button').nth(1).click();

    await fillDeterministicVoucherFields(page);
    await page.locator('[data-component="clients-new-bank-account-select"]').selectOption("area-incheon");
    await page.locator('[data-component="clients-new-actions"] button').nth(1).click();

    await expect(page.locator('[data-component="clients-new-step-count"]')).toHaveText("3 / 3 단계");
    await expect(page.locator('[data-component="clients-new-contract-status-card"]')).toBeVisible();

    await page.locator('[data-component="clients-new-actions"] button').nth(1).click();

    await expect(page).toHaveURL(/\/clients$/);
    expect(createdPayload).toEqual(
      expect.objectContaining({
        name: "홍테스트 고객",
        birthday: "950101",
        dueDate: "2026-06-15",
        address: "인천광역시 연수구 테스트로 10",
        phone: "010-1111-2222",
        type: VOUCHER_TYPE,
        duration: 10,
        fullPrice: "1300000",
        grant: "1000000",
        actualPrice: "300000",
        careCenter: false,
        voucherClient: true,
        breastPump: false,
        serviceStatus: "waiting",
        areaId: "area-incheon",
      })
    );
  });
});
