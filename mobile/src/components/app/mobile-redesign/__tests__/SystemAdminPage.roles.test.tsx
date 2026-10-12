import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { SystemAdminPage } from "../SystemAdminPage";
import { getSystemAdminBranchRequests, getSystemAdminUsers } from "@/lib/api/system-admin";
import type { SystemAdminUser } from "@/lib/api/system-admin";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams("section=accounts"),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/app/mobile-redesign/primitives", () => ({ MobileSectionNav: () => null }));
jest.mock("@/components/app/mobile-redesign/sliding-card", () => ({ SlidingCard: ({ list }: { list?: ReactNode }) => <div>{list}</div> }));
jest.mock("@/lib/api/system-admin", () => ({
  getSystemAdminBranchRequests: jest.fn(), getSystemAdminUsers: jest.fn(),
  createSystemAdminBranch: jest.fn(), updateSystemAdminBranch: jest.fn(),
  approveSystemAdminMessageSenderApproval: jest.fn(), approveSystemAdminUser: jest.fn(),
  rejectSystemAdminUser: jest.fn(), updateSystemAdminUserAccount: jest.fn(),
}));

const account = (id: string, role: string): SystemAdminUser => ({
  id, kakaoId: null, email: `${id}@example.com`, name: id, phone: null, birthDate: null,
  profileImage: null, role, createdAt: "2026-01-01T00:00:00.000Z", emailVerified: true,
  authProvider: "email", branches: [], approvalStatus: "approved", requestedRole: null,
});

/** 권한-04 (BJJ-435): `user` is shown as 회원 and `admin` as 지점장 wherever a role name appears. */
it("names the roles 지점장 / 매니저 / 회원 / 오너 in the account filters and rows", async () => {
  jest.mocked(getSystemAdminBranchRequests).mockResolvedValue([]);
  jest.mocked(getSystemAdminUsers).mockResolvedValue([
    account("a1", "admin"), account("m1", "manager"), account("u1", "user"), account("u2", "user"), account("o1", "owner"),
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(<QueryClientProvider client={client}><SystemAdminPage /></QueryClientProvider>);

  expect(await screen.findByRole("button", { name: "지점장 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "매니저 1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "회원 2" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "오너 1" })).toBeInTheDocument();
  expect(screen.getAllByText(/^회원 · /)).toHaveLength(2);
  expect(screen.getAllByText(/^지점장 · /)).toHaveLength(1);
  expect(screen.queryByText(/직원|상담원|유저/)).not.toBeInTheDocument();
  unmount();
  client.clear();
});
