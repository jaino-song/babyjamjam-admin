import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
  });
});

test.describe("Contracts delete flow", () => {
  test("opens confirm modal, supports cancel, and deletes selected contract", async ({ page }) => {
    const targetId = "doc-delete-target";

    let documents = [
      {
        id: targetId,
        document_number: "DOC-DEL-001",
        template: { id: "tpl-1", name: "Contract" },
        document_name: "삭제 대상 계약서",
        creator: { recipient_type: "sender", id: "admin", name: "Admin" },
        created_date: Date.now(),
        last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
        updated_date: Date.now(),
        current_status: {
          status_type: "002",
          step_recipients: [{ recipient_type: "signer", name: "삭제대상 고객" }],
        },
      },
      {
        id: "doc-keep-1",
        document_number: "DOC-KEEP-001",
        template: { id: "tpl-1", name: "Contract" },
        document_name: "유지 계약서",
        creator: { recipient_type: "sender", id: "admin", name: "Admin" },
        created_date: Date.now() - 86_400_000,
        last_editor: { recipient_type: "sender", id: "admin", name: "Admin" },
        updated_date: Date.now() - 86_400_000,
        current_status: {
          status_type: "002",
          step_recipients: [{ recipient_type: "signer", name: "유지고객" }],
        },
      },
    ];

    let deleteRequestCount = 0;

    await page.route("**/api/access-token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route("**/api/eformsign/documents**", async (route) => {
      const method = route.request().method();

      if (method === "DELETE") {
        deleteRequestCount += 1;

        const body = route.request().postDataJSON() as { document_ids?: string[] };
        const deletedId = body.document_ids?.[0];
        expect(deletedId).toBe(targetId);

        documents = documents.filter((doc) => doc.id !== deletedId);

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            api_ver: "2.0",
            result: {
              success_result: [deletedId],
              fail_result: [],
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          documents,
          total_rows: documents.length,
          limit: 20,
          skip: 0,
        }),
      });
    });

    await page.goto("/contracts");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("삭제대상 고객").first()).toBeVisible();

    await page.getByText("삭제대상 고객").first().click();
    await expect(page.locator('[data-component="contracts-detail"]')).toBeVisible();

    await page.locator('[data-component="contracts-detail-actions"] button').click();
    await expect(page.locator('[data-component="confirm-action-modal"]')).toBeVisible();
    await expect(page.getByText("이 문서를 삭제하시겠습니까?")).toBeVisible();

    await page.locator('[data-component="confirm-action-modal-actions"]').getByRole("button", { name: "취소" }).click();
    await expect(page.locator('[data-component="confirm-action-modal"]')).not.toBeVisible();
    expect(deleteRequestCount).toBe(0);

    await page.locator('[data-component="contracts-detail-actions"] button').click();
    await page.locator('[data-component="confirm-action-modal-actions"]').getByRole("button", { name: "삭제" }).click();

    await expect.poll(() => deleteRequestCount).toBe(1);
    await expect(page.getByText("문서 삭제 완료")).toBeVisible();
    await expect(page.getByText("삭제대상 고객")).not.toBeVisible();
    await expect(page.getByText("계약을 선택해주세요")).toBeVisible();
  });
});
