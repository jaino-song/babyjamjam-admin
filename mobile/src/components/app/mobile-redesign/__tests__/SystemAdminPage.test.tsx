import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SystemAdminPage } from "../SystemAdminPage";
import { getSystemAdminBranchRequests, getSystemAdminUsers, updateSystemAdminBranch } from "@/lib/api/system-admin";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams("section=branches&item=qa-branch"),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/app/mobile-redesign/primitives", () => ({ MobileSectionNav: () => null }));
jest.mock("@/components/app/mobile-redesign/sliding-card", () => ({ SlidingCard: ({ detail }: { detail: ReactNode }) => <div>{detail}</div> }));
jest.mock("@/lib/api/system-admin", () => ({
  getSystemAdminBranchRequests: jest.fn(), getSystemAdminUsers: jest.fn(),
  createSystemAdminBranch: jest.fn(), updateSystemAdminBranch: jest.fn(),
  approveSystemAdminMessageSenderApproval: jest.fn(), approveSystemAdminUser: jest.fn(),
  rejectSystemAdminUser: jest.fn(), updateSystemAdminUserAccount: jest.fn(),
}));

const branch = {
  id: "qa-branch", name: "QA 지점", slug: "qa-test", owner: null,
  region: null, district: null, address: null, phone: null, email: null,
  isActive: false, createdAt: null, updatedAt: null,
  messageSenderApproval: { approvalStatus: "not_requested" as const, requestedAt: null, approvedAt: null, requestedBy: null },
};

it("shows a failed save beside the form, preserves edits, and allows retry", async () => {
  jest.mocked(getSystemAdminBranchRequests).mockResolvedValue([branch]);
  jest.mocked(getSystemAdminUsers).mockResolvedValue([]);
  jest.mocked(updateSystemAdminBranch)
    .mockRejectedValueOnce({ response: { data: { code: "VALIDATION_FAILED", errors: [{ pointer: "/email", code: "INVALID_FORMAT" }] } } })
    .mockResolvedValueOnce({ ...branch, isActive: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { unmount } = render(<QueryClientProvider client={client}><SystemAdminPage /></QueryClientProvider>);

  fireEvent.change(await screen.findByLabelText("지점명"), { target: { value: "QA 수정 유지" } });
  fireEvent.click(screen.getByRole("switch", { name: "운영 중" }));
  fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("이메일 형식을 확인해 주세요");
  expect(screen.getByLabelText("지점명")).toHaveValue("QA 수정 유지");
  expect(screen.getByRole("switch", { name: "운영 중" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));
  await waitFor(() => expect(updateSystemAdminBranch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  unmount();
  client.clear();
});
