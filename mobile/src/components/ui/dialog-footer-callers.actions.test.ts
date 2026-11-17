import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The shared footer owns the width rules; callers own the semantic DOM order.
const callers: Array<[string, string[][]]> = [
  ["components/app/clients/ClientFormDialog.tsx", [["common.cancel", "common.save"]]],
  ["components/app/clients/ClientDetailModal.tsx", [["common.delete", "common.edit"]]],
  ["components/app/employees/EmployeeDetailModal.tsx", [["common.delete", "common.edit"]]],
  ["components/app/settings/PriceEditModal.tsx", [["취소", "저장"]]],
  ["components/app/documents/DocumentsTable.tsx", [["common.cancel"], ["common.cancel", "common.delete"]]],
  ["components/app/documents/add-category-modal.tsx", [["취소", "추가"]]],
  ["components/app/documents/document-edit-modal.tsx", [["취소", "저장"]]],
  ["components/app/documents/document-preview-modal.tsx", [["인쇄", "다운로드"]]],
  ["features/system-templates/components/VersionHistory.tsx", [["닫기"], ["취소", "복원"]]],
  ["components/app/clients/contract-link-confirm-sheet.tsx", [["취소", "확정"]]],
];

it.each(callers)("keeps the non-proceeding action first in %s", (path, expectedFooters) => {
  const source = readFileSync(resolve(process.cwd(), "src", path), "utf8");
  const footers = [...source.matchAll(/<DialogFooter\b[\s\S]*?<\/DialogFooter>/g)];
  expect(footers).toHaveLength(expectedFooters.length);
  footers.forEach(([footer], footerIndex) => {
    const buttons = [...footer.matchAll(/<Button\b[\s\S]*?<\/Button>/g)];
    expect(buttons).toHaveLength(expectedFooters[footerIndex].length);
    expectedFooters[footerIndex].forEach((label, buttonIndex) => {
      expect(buttons[buttonIndex][0]).toContain(label);
    });
  });
});
