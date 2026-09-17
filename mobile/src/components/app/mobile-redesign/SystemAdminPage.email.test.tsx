import type {
  SystemAdminBranchRequest,
  SystemAdminUser,
} from "@/lib/api/system-admin";
import {
  approveSystemAdminMessageSenderApproval,
  approveSystemAdminUser,
  createSystemAdminBranch,
  getSystemAdminBranchRequests,
  getSystemAdminUsers,
  rejectSystemAdminUser,
  updateSystemAdminBranch,
  updateSystemAdminUserAccount,
} from "@/lib/api/system-admin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SystemAdminPage } from "./SystemAdminPage";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockToast = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/lib/api/system-admin", () => ({
  approveSystemAdminMessageSenderApproval: jest.fn(),
  approveSystemAdminUser: jest.fn(),
  createSystemAdminBranch: jest.fn(),
  getSystemAdminBranchRequests: jest.fn(),
  getSystemAdminUsers: jest.fn(),
  rejectSystemAdminUser: jest.fn(),
  updateSystemAdminBranch: jest.fn(),
  updateSystemAdminUserAccount: jest.fn(),
}));

const mockedApproveMessageSender = jest.mocked(approveSystemAdminMessageSenderApproval);
const mockedApproveUser = jest.mocked(approveSystemAdminUser);
const mockedCreateBranch = jest.mocked(createSystemAdminBranch);
const mockedGetBranches = jest.mocked(getSystemAdminBranchRequests);
const mockedGetUsers = jest.mocked(getSystemAdminUsers);
const mockedRejectUser = jest.mocked(rejectSystemAdminUser);
const mockedUpdateBranch = jest.mocked(updateSystemAdminBranch);
const mockedUpdateAccount = jest.mocked(updateSystemAdminUserAccount);

const branch: SystemAdminBranchRequest = {
  id: "branch-1",
  name: "강남점",
  slug: "gangnam",
  region: "서울",
  district: "강남구",
  address: "테헤란로 1",
  phone: "02-0000-0000",
  email: null,
  isActive: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  owner: null,
  messageSenderApproval: {
    approvalStatus: "not_requested",
    requestedAt: null,
    approvedAt: null,
    requestedBy: null,
  },
};

const users: SystemAdminUser[] = [];

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

function renderPage(item: string) {
  mockSearchParams = new URLSearchParams({ section: "branches", item });
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SystemAdminPage />
    </QueryClientProvider>,
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("지점명"), {
    target: { value: "강남점" },
  });
  fireEvent.change(screen.getByLabelText("식별자"), {
    target: { value: "gangnam" },
  });
}

function branchFormPayload() {
  const payload = mockedCreateBranch.mock.calls[0]?.[0] ?? mockedUpdateBranch.mock.calls[0]?.[1];
  expect(payload).toBeDefined();
  return payload;
}

describe("SystemAdminPage branch email payloads", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockToast.mockReset();
    mockedApproveMessageSender.mockReset();
    mockedApproveUser.mockReset();
    mockedCreateBranch.mockReset();
    mockedGetBranches.mockReset();
    mockedGetUsers.mockReset();
    mockedRejectUser.mockReset();
    mockedUpdateBranch.mockReset();
    mockedUpdateAccount.mockReset();
    mockedGetBranches.mockResolvedValue([]);
    mockedGetUsers.mockResolvedValue(users);
    mockedCreateBranch.mockResolvedValue(branch);
    mockedUpdateBranch.mockResolvedValue(branch);
  });

  it("omits a blank email from the actual create request", async () => {
    renderPage("new-branch");
    await screen.findByLabelText("이메일");
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() => expect(mockedCreateBranch).toHaveBeenCalledTimes(1));
    const payload = branchFormPayload();
    expect(payload).not.toHaveProperty("email");
  });

  it("omits a blank email from the actual update request", async () => {
    mockedGetBranches.mockResolvedValue([branch]);
    renderPage(branch.id);
    await screen.findByLabelText("이메일");

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() => expect(mockedUpdateBranch).toHaveBeenCalledTimes(1));
    expect(mockedUpdateBranch).toHaveBeenCalledWith(branch.id, expect.any(Object));
    const payload = branchFormPayload();
    expect(payload).not.toHaveProperty("email");
  });

  it("preserves a supplied email in the actual update request", async () => {
    mockedGetBranches.mockResolvedValue([{ ...branch, email: "branch@example.com" }]);
    renderPage(branch.id);
    await screen.findByLabelText("이메일");

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() => expect(mockedUpdateBranch).toHaveBeenCalledTimes(1));
    expect(branchFormPayload()).toEqual(expect.objectContaining({ email: "branch@example.com" }));
  });

  it("retains entered values after a failed create request", async () => {
    mockedCreateBranch.mockRejectedValueOnce(new Error("save failed"));
    renderPage("new-branch");
    await screen.findByLabelText("이메일");
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "entered@example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() => expect(mockedCreateBranch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(screen.getByLabelText("지점명")).toHaveValue("강남점");
    expect(screen.getByLabelText("식별자")).toHaveValue("gangnam");
    expect(screen.getByLabelText("이메일")).toHaveValue("entered@example.com");
  });
});
