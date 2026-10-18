import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import { ClientDetailContent } from "./client-detail";
import type { Client } from "@/lib/client/types";
import type { EformsignLinkConfirmation } from "@/services/api";

jest.mock("next/navigation", () => ({ usePathname: () => "/clients", useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useEmployees", () => ({ useEmployees: () => ({ data: [] }) }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { role: "user", branchRole: "manager" } }) }));
jest.mock("@/hooks/useServiceRecords", () => ({ useClientServiceRecords: () => ({ data: undefined }), applyServiceScheduleChange: jest.fn(), fetchClientServiceRecords: jest.fn(), previewServiceScheduleChange: jest.fn(), resetServiceRecordLink: jest.fn() }));
jest.mock("@/hooks/useClients", () => ({ approveScheduleChange: jest.fn(), rejectScheduleChange: jest.fn() }));
jest.mock("@/features/clients", () => ({ useConfirmBooking: () => ({ mutateAsync: jest.fn(), isPending: false }) }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));
jest.mock("@/hooks/use-send-client-receipt", () => ({ useSendClientReceipt: () => ({ isSending: false, sendReceipt: jest.fn() }) }));
jest.mock("@/services/api", () => ({ eformsignApi: { getDocument: jest.fn(), getLinkConfirmations: jest.fn() } }));
jest.mock("./client-service-records", () => ({ ClientServiceRecords: () => null }));
jest.mock("./ServiceScheduleChangeModal", () => ({ ServiceScheduleChangeModal: () => null }));
jest.mock("./ServiceRecordLinkResetResultModal", () => ({ ServiceRecordLinkResetResultModal: () => null }));
jest.mock("./ServiceScheduleContractResendModal", () => ({ ServiceScheduleContractResendModal: () => null }));
jest.mock("./contract-link-confirm-sheet", () => ({ ContractLinkConfirmSheet: ({ entry }: { entry: EformsignLinkConfirmation }) => <div role="dialog">{entry.documentId}</div> }));
jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  DetailTabPills: () => null, MobileDetailActions: () => null, MobileDetailHeader: () => null,
  InfoCard: ({ title, children }: { title: string; children: ReactNode }) => <section><h2>{title}</h2>{children}</section>,
  InfoRow: () => null,
  MobileDetailPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  MobileDetailTabPanel: ({ children, tabId, activeTab }: { children: ReactNode; tabId: string; activeTab: string }) => <div aria-hidden={tabId !== activeTab}>{children}</div>,
}));

const client: Client = {
  id: 7, name: "고객", phone: "01012345678", birthday: null, dueDate: null, birthDate: null, address: null,
  primaryEmployee: null, secondaryEmployee: null, type: null, duration: null, fullPrice: null, grant: null, actualPrice: null,
  startDate: null, endDate: null, careCenter: false, voucherClient: false, breastPump: false, serviceStatus: null,
  bookingConfirmedAt: null, eDocId: null, hasSigned: false, documentStatus: null,
};
const entry: EformsignLinkConfirmation = {
  documentId: "doc-1", documentName: "계약서 A", statusType: "020", statusDetail: "", createdDate: "2026-10-13T00:00:00Z",
  document: { name: "A", phone: "01012345678", birthday: "1990-01-01" },
  client: { id: 7, name: "B", phone: "01012345678", birthday: null }, differences: ["name", "birthday"], canConfirm: true,
};
function mount(props: Partial<ComponentProps<typeof ClientDetailContent>> = {}) {
  return render(<ClientDetailContent data-component="mobile_clients_detail-sheet_content" client={client} activeTab="contracts"
    onTabChange={jest.fn()} onMessage={jest.fn()} onIssueContract={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onClientUpdated={jest.fn()} {...props} />);
}
it("renders every pending document, badge, count, differences and opens the selected sheet", () => {
  mount({ linkConfirmations: [entry, { ...entry, documentId: "doc-2", documentName: null, differences: ["name"] }], refetchLinkConfirmations: jest.fn() });
  expect(screen.getByText("확인 필요 계약서 2건")).toBeInTheDocument();
  expect(screen.getAllByText("연결 확인 필요")).toHaveLength(2);
  expect(screen.getByText("계약서 A")).toBeInTheDocument(); expect(screen.getByText("계약서")).toBeInTheDocument();
  expect(screen.getByText("이름이 다릅니다 · 생년월일이 다릅니다")).toBeInTheDocument();
  expect(screen.getByText("이름이 다릅니다")).toBeInTheDocument();
  expect(screen.queryByText("계약서 정보가 없습니다.")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "확인" })[1]);
  expect(screen.getByRole("dialog")).toHaveTextContent("doc-2");
});
it("birthday-only differences and manager-only restriction", () => {
  mount({ linkConfirmations: [{ ...entry, differences: ["birthday"], canConfirm: false }] });
  expect(screen.getByText("생년월일이 다릅니다")).toBeInTheDocument();
  expect(screen.getByText("지점 관리자만 연결을 확정할 수 있습니다")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "확인" })).not.toBeInTheDocument();
});
it.each(["loading", "paused", "empty"])("%s adds no pending UI and preserves the existing empty card", state => {
  const { container } = mount({ linkConfirmations: state === "empty" ? [] : undefined, isLinkConfirmationsFetching: state === "loading" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(container.querySelector('[data-component$="_link-confirmations"]')).toBeNull();
  expect(screen.getByText("계약서 정보가 없습니다.")).toBeInTheDocument();
});
it("a failed initial load has a retryable alert, not a zero-count result", () => {
  const refetch = jest.fn(); mount({ isLinkConfirmationsError: true, refetchLinkConfirmations: refetch });
  expect(screen.getByRole("alert")).toHaveTextContent("연결 확인이 필요한 계약서를 불러오지 못했습니다");
  fireEvent.click(screen.getByRole("button", { name: /다시 시도/ })); expect(refetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/확인 필요 계약서 0건/)).not.toBeInTheDocument();
});
it("a failed cached refetch retains entries and gives a stale retry", () => {
  const refetch = jest.fn(); mount({ linkConfirmations: [entry], isLinkConfirmationsError: true, refetchLinkConfirmations: refetch });
  expect(screen.getByText("계약서 A")).toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  fireEvent.click(screen.getByRole("button", { name: /다시 시도/ })); expect(refetch).toHaveBeenCalledTimes(1);
});
it("linked contract projection remains alongside pending entries", () => {
  mount({ client: { ...client, eDocId: "linked" }, linkConfirmations: [entry] });
  expect(screen.getAllByText("서비스 계약서").length).toBeGreaterThan(0);
  expect(screen.getByText("계약서 A")).toBeInTheDocument();
});
