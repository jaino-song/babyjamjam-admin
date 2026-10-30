import { expect, test, type Page } from "@playwright/test";

interface SmokeClient {
  id: number;
  name: string;
}

interface SmokeEmployee {
  id: number;
  name: string;
}

interface VoucherPriceInfo {
  duration: string;
}

/** Body of POST /api/eformsign-docs/jobs/creation (EnqueueEformsignDocumentJobResponse in src/services/eformsign.ts). */
interface EnqueuedJobBody {
  jobId?: string;
  status?: string;
  existing?: boolean;
}

/** Subset of EformsignDocumentJobResponse (frontend/src/services/eformsign.ts) that the smoke test reads. */
interface SmokeJob {
  jobId: string;
  status: string;
  documentId: string | null;
  lastErrorCode: string | null;
}

interface SmokeJobList {
  active: SmokeJob[];
  requiresAttention: SmokeJob[];
  recent: SmokeJob[];
}

const REAL_TENANT_SKIP_MESSAGE = "Set RUN_SMOKE_TESTS=1 to run real-tenant smoke tests";
// ContractCreationForm.tsx:1337 — the toast shown once the backend accepted the creation job.
const CREATION_STARTED_TOAST = "전자문서 생성을 시작했어요";
const JOB_CREATION_PATH = "/api/eformsign-docs/jobs/creation";
const MISMATCH_DIALOG_NAME = "고객 정보와 다른 내용이 있어요";
const KEEP_CLIENT_UNCHANGED_BUTTON = "계약서에만 반영";
// The backend job drives a headless eformsign browser, so allow it more time than a plain request.
const JOB_COMPLETION_TIMEOUT_MS = 120_000;
const JOB_POLL_INTERVAL_MS = 2_000;
const STEP_CONTENT = '[data-component="desktop_v3_stepped-wizard_step-content"]';
const CREATION_FORM = '[data-component="desktop_contracts_creation_form"]';
const CONTRACT_ROW_CONTENT = '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item_content"]';

let createdDocumentId: string | null = null;

function formatIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function skipSmoke(message: string): never {
  test.skip(true, message);
  throw new Error(`unreachable after skip: ${message}`);
}

async function fetchJson<T>(page: Page, pathname: string): Promise<T> {
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await result.text();

    return {
      ok: result.ok,
      status: result.status,
      text,
    };
  }, pathname);

  if (!response.ok) {
    throw new Error(`Request to ${pathname} failed with ${response.status}: ${response.text}`);
  }

  return JSON.parse(response.text) as T;
}

async function cleanupCreatedDocument(page: Page, documentId: string): Promise<void> {
  const response = await page.evaluate(async (id) => {
    const result = await fetch("/api/eformsign/documents?is_permanent=true", {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_ids: [id],
      }),
    });

    const text = await result.text();

    return {
      ok: result.ok,
      status: result.status,
      text,
    };
  }, documentId);

  expect(response.ok, `cleanup failed for ${documentId}: ${response.status} ${response.text}`).toBeTruthy();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function selectClient(page: Page, client: SmokeClient): Promise<void> {
  const trigger = page.getByRole("combobox", { name: "산모님 성함", exact: true });
  await trigger.click();
  await page.getByRole("combobox", { name: "산모님 성함 검색" }).fill(client.name);
  await page.getByRole("option", { name: new RegExp(escapeRegExp(client.name)) }).first().click();
  await expect(trigger).toContainText(client.name);
}

async function selectFirstDocType(page: Page): Promise<string> {
  const trigger = page.getByRole("combobox", { name: "계약서 선택" });
  await trigger.click();

  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();

  const label = (await firstOption.textContent())?.trim();
  if (!label) {
    throw new Error("contract doc type dropdown rendered without visible text");
  }

  await firstOption.click();
  await expect(trigger).toContainText(label);

  return label;
}

async function selectEmployee(page: Page, employee: SmokeEmployee): Promise<void> {
  const label = "제공인력 1 선택";
  const trigger = page.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  await page.getByRole("combobox", { name: `${label} 검색` }).fill(employee.name);
  await page.getByRole("option", { name: new RegExp(escapeRegExp(employee.name)) }).first().click();
  await expect(trigger).toContainText(employee.name);
}

async function findVoucherYear(page: Page): Promise<number | null> {
  const availableYears = await fetchJson<number[]>(page, "/api/voucher-price-infos/years");
  const candidateYears = [2026, ...availableYears.filter((year) => year !== 2026)];

  for (const year of candidateYears) {
    const search = new URLSearchParams({
      type: "A가1형",
      year: String(year),
    });
    const prices = await fetchJson<VoucherPriceInfo[]>(
      page,
      `/api/voucher-price-infos/type?${search.toString()}`
    );

    if (prices.some((price) => price.duration === "10")) {
      return year;
    }
  }

  return null;
}

async function fillVoucherStep(page: Page, voucherYear: number): Promise<void> {
  const selects = page.locator(`${STEP_CONTENT} select`);

  await selects.nth(0).selectOption(String(voucherYear));
  await selects.nth(1).selectOption("A가1형");

  await expect.poll(async () => selects.count()).toBe(3);
  await selects.nth(2).selectOption("10");
}

async function fillContractDates(page: Page): Promise<void> {
  const baseDate = new Date();
  baseDate.setHours(0, 0, 0, 0);

  const startDate = addDays(baseDate, 7);
  const endDate = addDays(startDate, 14);
  const paymentDate = addDays(startDate, 3);

  await page.locator('[data-component="desktop_contracts_creation_form_start-date-input"]').fill(formatIsoDate(startDate));
  await page.locator('[data-component="desktop_contracts_creation_form_end-date-input"]').fill(formatIsoDate(endDate));
  await page.locator('[data-component="desktop_contracts_creation_form_payment-date-input"]').fill(formatIsoDate(paymentDate));
}

async function waitForContractsListReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_item_content"]')) ||
      document.body.innerText.includes("계약 문서가 없습니다"),
    null,
    { timeout: 30_000 }
  );
}

/**
 * Submits the contract and, if the app asks whether to copy the contract's values to the client record,
 * keeps the real dev-tenant client unchanged. Resolves with the POST /jobs/creation response.
 */
async function submitAndAwaitQueuedJob(page: Page): Promise<EnqueuedJobBody> {
  const creationResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === JOB_CREATION_PATH,
    { timeout: 60_000 }
  );
  await page.getByTestId("contract-creation-submit").click();

  const mismatchDialog = page.getByRole("dialog", { name: MISMATCH_DIALOG_NAME });
  const outcome = await Promise.race([
    creationResponsePromise.then((response) => ({ kind: "response" as const, response })),
    mismatchDialog.waitFor({ state: "visible", timeout: 15_000 }).then(() => ({ kind: "dialog" as const })),
  ]);
  if (outcome.kind === "dialog") {
    await mismatchDialog.getByRole("button", { name: KEEP_CLIENT_UNCHANGED_BUTTON }).click();
  }

  const creationResponse = outcome.kind === "response" ? outcome.response : await creationResponsePromise;
  expect(creationResponse.ok(), `POST ${JOB_CREATION_PATH} answered ${creationResponse.status()}`).toBeTruthy();
  return (await creationResponse.json()) as EnqueuedJobBody;
}

/** Polls the jobs list until the queued job finishes, then returns it. A failed job fails the test. */
async function waitForCompletedJob(page: Page, jobId: string): Promise<SmokeJob> {
  const deadline = Date.now() + JOB_COMPLETION_TIMEOUT_MS;
  let lastSeen: SmokeJob | null = null;

  while (Date.now() < deadline) {
    const jobs = await fetchJson<SmokeJobList>(page, "/api/eformsign-docs/jobs");
    const job = [...jobs.recent, ...jobs.requiresAttention, ...jobs.active].find((candidate) => candidate.jobId === jobId);
    if (job) {
      lastSeen = job;
      if (job.status === "completed") {
        return job;
      }
      if (job.status === "failed" || job.status === "requires_attention") {
        throw new Error(`creation job ${jobId} ended as ${job.status} (${job.lastErrorCode ?? "no error code"})`);
      }
    }
    await page.waitForTimeout(JOB_POLL_INTERVAL_MS);
  }

  throw new Error(
    `creation job ${jobId} did not complete within ${JOB_COMPLETION_TIMEOUT_MS}ms; last seen: ${JSON.stringify(lastSeen)}`
  );
}

test.describe.serial("contract creation smoke (real tenant)", () => {
  test.skip(!process.env.RUN_SMOKE_TESTS, REAL_TENANT_SKIP_MESSAGE);
  test.setTimeout(240_000);

  test.afterEach(async ({ page }) => {
    if (!createdDocumentId) {
      return;
    }

    await cleanupCreatedDocument(page, createdDocumentId);
    createdDocumentId = null;
  });

  test("creates a real contract end-to-end and the new doc appears in the list", async ({ page }) => {
    createdDocumentId = null;

    await page.goto("/contracts");

    if (page.url().includes("/login")) {
      throw new Error("expected /contracts with globalSetup auth, but the app redirected to /login");
    }

    await expect(page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]')).toBeVisible();
    await waitForContractsListReady(page);

    const clients = await fetchJson<SmokeClient[]>(page, "/api/clients");
    const selectedClient = clients[0] ?? skipSmoke("no clients in dev tenant");

    const employees = await fetchJson<SmokeEmployee[]>(page, "/api/employees");
    const selectedEmployee = employees[0] ?? skipSmoke("no employees in dev tenant");

    const voucherYear = await findVoucherYear(page);
    const usableVoucherYear = voucherYear ?? skipSmoke("no voucher price for A가1형 / 10일 in dev tenant");

    const initialDocumentCount = await page.locator(CONTRACT_ROW_CONTENT).count();

    await page.locator('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_list-panel_header_send-contract"]').click();
    await expect(page.locator(CREATION_FORM)).toBeVisible();

    await selectClient(page, selectedClient);
    await selectFirstDocType(page);
    await page.getByTestId("contract-creation-next").click();

    await selectEmployee(page, selectedEmployee);
    await page.getByTestId("contract-creation-next").click();

    await fillVoucherStep(page, usableVoucherYear);
    await page.getByTestId("contract-creation-next").click();

    await fillContractDates(page);
    await expect(page.getByTestId("contract-creation-submit")).toBeEnabled();

    const enqueuedJob = await submitAndAwaitQueuedJob(page);
    expect(enqueuedJob.existing, "the creation job must be new, not an already running one").toBe(false);
    const jobId = enqueuedJob.jobId ?? "";
    expect(jobId.length).toBeGreaterThan(0);

    // Accepted: the toast replaces the old success modal and the form closes; the backend job does the rest.
    await expect(page.getByText(CREATION_STARTED_TOAST, { exact: true })).toBeVisible();
    await expect(page.locator(CREATION_FORM)).toHaveCount(0);

    const completedJob = await waitForCompletedJob(page, jobId);
    createdDocumentId = completedJob.documentId;

    if (!createdDocumentId) {
      throw new Error("contract creation job completed but no documentId was captured for cleanup");
    }

    await expect
      .poll(async () => page.locator(CONTRACT_ROW_CONTENT).count(), { timeout: 30_000 })
      .toBe(initialDocumentCount + 1);
  });
});
