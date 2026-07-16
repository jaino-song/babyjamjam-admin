import { expect, test } from '@playwright/test';

/**
 * Critical business flows against the REAL backend (no route mocks).
 *
 * These tests MUTATE backend state (sender-approval status transitions), so
 * they only run in CI where the database is a throwaway per-job container
 * seeded by backend/test/e2e-env/seed-e2e.ts. Never run them against a shared
 * dev DB.
 */
const BACKEND_URL = process.env.DEVELOPMENT_API_BASE_URL || 'http://127.0.0.1:3001';
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
});
