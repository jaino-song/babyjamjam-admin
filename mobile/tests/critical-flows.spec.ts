import { expect, test } from '@playwright/test';

/**
 * Critical business flows against the REAL backend (no route mocks).
 *
 * These tests MUTATE backend state (sender-approval status transitions,
 * webhook-driven document completion + alimtalk log rows), so they only run
 * in CI where the database is a throwaway per-job container seeded by
 * backend/test/e2e-env/seed-e2e.ts. Never run them against a shared dev DB.
 *
 * Serial: flow 1 transitions the branch through "pending" before restoring
 * "approved"; flow 2's completion alimtalk must not race that window.
 */
const BACKEND_URL = process.env.DEVELOPMENT_API_BASE_URL || 'http://127.0.0.1:3001';
const WEBHOOK_SECRET = process.env.EFORMSIGN_WEBHOOK_SECRET || 'e2e-webhook-secret';
const COMPANY_ID = process.env.EFORMSIGN_COMPANY_ID || 'e2e-stub-company';
const BRANCH_ID = '33dbe950-1574-4951-b7b4-92d97ab29512';

test.describe.configure({ mode: 'serial' });

test.describe('Critical flows (real backend)', () => {
  test.skip(!process.env.CI, 'mutates backend state — CI throwaway database only');

  test('sender approval lifecycle: approved gate open → request → re-approve', async ({
    page,
    context,
  }) => {
    // 1. Seeded state: branch approved → the sender-approval page shows it
    //    and the message composer is not blocked by the approval gate.
    await page.goto('/messages/sender-approval');
    await expect(page.getByText('승인 완료').first()).toBeVisible({ timeout: 15000 });

    // 2. Drive the backend transitions directly (the admin approve UI lives
    //    in the staff frontend app, not this mobile app): request → pending,
    //    owner approve → approved. Auth via the storage-state JWT.
    const authToken = (await context.cookies()).find((c) => c.name === 'auth_token')?.value;
    expect(authToken).toBeTruthy();
    const headers = { Authorization: `Bearer ${authToken}` };

    const requestRes = await page.request.post(
      `${BACKEND_URL}/settings/message-sender-approval/request`,
      { headers, data: { senderPhone: '01099998888' } },
    );
    expect(requestRes.ok()).toBeTruthy();

    const pendingRes = await page.request.get(
      `${BACKEND_URL}/settings/message-sender-approval`,
      { headers },
    );
    expect(pendingRes.ok()).toBeTruthy();
    expect(await pendingRes.json()).toMatchObject({ approvalStatus: 'pending', isApproved: false });

    const approveRes = await page.request.post(
      `${BACKEND_URL}/settings/message-sender-approval/${BRANCH_ID}/approve`,
      { headers, data: {} },
    );
    expect(approveRes.ok()).toBeTruthy();

    const approvedRes = await page.request.get(
      `${BACKEND_URL}/settings/message-sender-approval`,
      { headers },
    );
    expect(await approvedRes.json()).toMatchObject({ approvalStatus: 'approved', isApproved: true });

    // 3. The UI gate reflects the restored approval.
    await page.goto('/messages/sender-approval');
    await expect(page.getByText('승인 완료').first()).toBeVisible({ timeout: 15000 });
  });

  test('eformsign completion webhook delivers exactly one alimtalk (replay is idempotent)', async ({
    page,
    context,
  }) => {
    const authToken = (await context.cookies()).find((c) => c.name === 'auth_token')?.value;
    expect(authToken).toBeTruthy();
    const authHeaders = { Authorization: `Bearer ${authToken}` };

    const logCount = async (): Promise<number> => {
      const res = await page.request.get(`${BACKEND_URL}/alimtalk-logs`, { headers: authHeaders });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const rows: unknown[] = Array.isArray(body) ? body : (body?.data ?? []);
      return rows.length;
    };

    const webhookPayload = {
      webhook_id: 'e2e-idempotency-check',
      event_type: 'ready_document_pdf',
      company_id: COMPANY_ID,
      ready_document_pdf: {
        document_id: 'doc-keep-1',
        document_status: 'doc_complete',
        workflow_seq: 1,
        workflow_name: '완료',
      },
    };
    const webhookHeaders = {
      Authorization: `Bearer ${WEBHOOK_SECRET}`,
      'Content-Type': 'application/json',
    };

    const before = await logCount();

    // First completion webhook: claims the completion and sends the
    // contract-signed alimtalk (recorded as a log row; vendor call stubbed).
    const first = await page.request.post(`${BACKEND_URL}/webhooks/eformsign`, {
      headers: webhookHeaders,
      data: webhookPayload,
    });
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ success: true });

    await expect.poll(logCount, { timeout: 15000 }).toBe(before + 1);

    // Replayed webhook: the completion claim is already taken — the document
    // update reports "duplicate" and NO second alimtalk is sent.
    const replay = await page.request.post(`${BACKEND_URL}/webhooks/eformsign`, {
      headers: webhookHeaders,
      data: webhookPayload,
    });
    expect(replay.status()).toBe(200);

    // Give any (incorrect) duplicate send time to land before asserting.
    await page.waitForTimeout(3000);
    expect(await logCount()).toBe(before + 1);

    // An unauthenticated webhook is rejected outright (guard fail-closed).
    const badAuth = await page.request.post(`${BACKEND_URL}/webhooks/eformsign`, {
      headers: { 'Content-Type': 'application/json' },
      data: webhookPayload,
    });
    expect([401, 403]).toContain(badAuth.status());
  });
});
