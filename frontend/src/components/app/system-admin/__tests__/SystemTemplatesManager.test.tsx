import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { SystemTemplatesManager } from "../SystemTemplatesManager";

const mockUseSystemTemplates = jest.fn();
jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplates: () => mockUseSystemTemplates(),
  useSystemTemplate: () => ({ data: undefined, isLoading: false, isError: false }),
}));
// Keep the real AnimatedSlotList/ListPanel: this test exercises the manager's
// grouping connection, while avoiding the unrelated editor's data hooks.
jest.mock("@/components/app/v3", () => ({
  ...jest.requireActual("@/components/app/v3"),
  SplitLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/app/ui/SystemTemplateEditor", () => ({ SystemTemplateEditor: () => null }));
jest.mock("@/features/system-templates/components/VersionHistory", () => ({ VersionHistory: () => null }));
jest.mock("@/components/app/my-templates/template-preview", () => ({ TemplatePreview: () => null }));

it("wires the owner manager's two server groups into the real list in catalog order", () => {
  const entries = [
      ["GREETING", "첫 인사"],
      ["SERVICE_INFO", "서비스 내용 안내"],
      ["PRICE_INFO", "서비스 비용 안내"],
      ["REMINDER", "리마인드"],
      ["THANKS", "입금 확인 및 예약 완료 안내"],
      ["INFO", "산모 정보 요청"],
      ["CONTRACT_GUIDE", "계약서 작성 안내"],
      ["CONTRACT_REMINDER", "계약서 작성 요청"],
      ["MATERNAL_NOTICE", "산모님 안내문"],
      ["SERVICE_END_NOTICE", "서비스 종료 안내"],
      ["SURVEY", "모니터링 설문"],
      ["PROVIDER_NOTICE", "제공인력 안내문"],
      ["SERVICE_RECORD_LINK", "제공기록지 작성 요청"],
      ["SERVICE_RECORD_REMINDER", "제공기록지 미작성 알림"],
  ];
  mockUseSystemTemplates.mockReturnValue({
    data: entries.map(([templateKey, name], index) => ({
      id: templateKey, templateKey, name, group: index < 11 ? "mother" : "provider",
      groupLabel: index < 11 ? "산모 대상" : "제공인력 대상", description: "", content: "",
      requiredVariables: [], customVariables: [], updatedAt: "2026-09-01T00:00:00.000Z",
    })),
    isLoading: false, isError: false,
  });
  const { container } = render(<SystemTemplatesManager dataComponent="desktop_system-admin_template-manager" />);
  const list = container.querySelector('[data-component="desktop_system-admin_template-manager_list"]') as HTMLElement;
  expect(within(list).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["산모 대상", "제공인력 대상"]);
  const rows = within(list).getAllByRole("button");
  expect(rows).toHaveLength(14);
  rows.forEach((row, index) => expect(within(row).getByText(entries[index][1])).toBeInTheDocument());
  expect(screen.getByText("메시지 템플릿")).toBeInTheDocument();
});
