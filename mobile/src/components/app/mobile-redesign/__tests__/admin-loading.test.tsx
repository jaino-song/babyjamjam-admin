import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import * as systemApi from "@/lib/api/system-admin";
import * as websiteApi from "@/lib/api/website-admin";

import { SystemAdminPage } from "../SystemAdminPage";
import { DEFAULT_RIBBON_CONFIG, WebsiteAdminPage } from "../WebsiteAdminPage";

let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }), useSearchParams: () => mockParams }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/app/mobile-redesign/primitives", () => ({ MobileSectionNav: () => null }));
jest.mock("@/components/app/mobile-redesign/sliding-card", () => ({ SlidingCard: ({ detail }: { detail: ReactNode }) => <>{detail}</> }));
jest.mock("@/lib/api/website-admin", () => ({ getRibbonConfig: jest.fn(), updateRibbonConfig: jest.fn() }));
jest.mock("@/lib/api/system-admin", () => ({
  getSystemAdminBranchRequests: jest.fn(), getSystemAdminUsers: jest.fn(), createSystemAdminBranch: jest.fn(), updateSystemAdminBranch: jest.fn(),
  approveSystemAdminMessageSenderApproval: jest.fn(), approveSystemAdminUser: jest.fn(), rejectSystemAdminUser: jest.fn(), updateSystemAdminUserAccount: jest.fn(),
}));

const branch: systemApi.SystemAdminBranchRequest = {
  id: "qa-branch", name: "QA 지점", slug: "qa-test", admin: null, region: null, district: null, address: null, phone: null, email: null,
  isActive: true, createdAt: null, updatedAt: null,
  messageSenderApproval: { approvalStatus: "pending", requestedAt: null, approvedAt: null, requestedBy: null },
};
const account: systemApi.SystemAdminUser = {
  id: "qa-user", email: "qa@example.invalid", name: "QA 계정", phone: null, birthDate: null, profileImage: null, role: "user",
  createdAt: "2026-11-01T00:00:00Z", emailVerified: true, authProvider: "email", kakaoId: null, branches: [{ id: branch.id, name: branch.name, role: "user" }],
  approvalStatus: "approved", requestedRole: "user",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(systemApi.getSystemAdminBranchRequests).mockResolvedValue([branch]);
  jest.mocked(systemApi.getSystemAdminUsers).mockResolvedValue([account]);
  jest.mocked(systemApi.updateSystemAdminBranch).mockReturnValue(new Promise(() => {}));
  jest.mocked(systemApi.updateSystemAdminUserAccount).mockReturnValue(new Promise(() => {}));
  jest.mocked(systemApi.approveSystemAdminMessageSenderApproval).mockReturnValue(new Promise(() => {}));
  jest.mocked(systemApi.approveSystemAdminUser).mockReturnValue(new Promise(() => {}));
  jest.mocked(websiteApi.getRibbonConfig).mockResolvedValue(DEFAULT_RIBBON_CONFIG);
  jest.mocked(websiteApi.updateRibbonConfig).mockReturnValue(new Promise(() => {}));
});

function mount(page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
  return () => { view.unmount(); client.clear(); };
}

function expectBusy(button: HTMLElement, idleLabel: string) {
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent(idleLabel);
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
}

it("hides branch save copy while persisting edits", async () => {
  mockParams = new URLSearchParams("section=branches&item=qa-branch");
  const cleanup = mount(<SystemAdminPage />);
  fireEvent.change(await screen.findByLabelText("지점명"), { target: { value: "QA 수정" } });
  fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));
  expectBusy(await screen.findByRole("button", { name: "저장 중" }), "지점 저장");
  cleanup();
});

it("hides account save copy while persisting assignments", async () => {
  mockParams = new URLSearchParams("section=accounts&item=qa-user");
  const cleanup = mount(<SystemAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: "계정 정보 저장" }));
  expectBusy(await screen.findByRole("button", { name: "저장 중" }), "계정 정보 저장");
  cleanup();
});

it("announces sender approval using a spinner button", async () => {
  mockParams = new URLSearchParams("section=branches&item=qa-branch");
  const cleanup = mount(<SystemAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: "메시지 신청 승인" }));
  expectBusy(await screen.findByRole("button", { name: "승인 중" }), "메시지 신청 승인");
  cleanup();
});

it("announces account approval using a spinner button", async () => {
  jest.mocked(systemApi.getSystemAdminUsers).mockResolvedValue([{ ...account, approvalStatus: "pending" }]);
  mockParams = new URLSearchParams("section=accounts&item=qa-user");
  const cleanup = mount(<SystemAdminPage />);
  fireEvent.click(await screen.findByRole("button", { name: "가입 승인" }));
  expectBusy(await screen.findByRole("button", { name: "처리 중" }), "가입 승인");
  cleanup();
});

it("uses the shared saving spinner for the website ribbon", async () => {
  mockParams = new URLSearchParams("item=ribbon");
  const cleanup = mount(<WebsiteAdminPage />);
  fireEvent.change(await screen.findByLabelText("메시지"), { target: { value: "QA 알림" } });
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  expectBusy(await screen.findByRole("button", { name: "저장 중" }), "설정 저장");
  cleanup();
});
