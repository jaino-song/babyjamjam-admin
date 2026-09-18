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

const createdBranch: SystemAdminBranchRequest = {
  id: "branch-created",
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

function renderPage(item?: string) {
  mockSearchParams = new URLSearchParams({ section: "branches" });
  if (item) mockSearchParams.set("item", item);
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SystemAdminPage />
    </QueryClientProvider>,
  );

  return {
    ...view,
    rerenderPage: () =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SystemAdminPage />
        </QueryClientProvider>,
      ),
  };
}

async function openCreation(view: { rerenderPage: () => void }) {
  fireEvent.click(screen.getByRole("button", { name: "지점 추가" }));
  expect(mockPush).toHaveBeenCalledWith(
    "/system-admin?section=branches&item=new-branch",
    { scroll: false },
  );
  mockSearchParams = new URLSearchParams({ section: "branches", item: "new-branch" });
  view.rerenderPage();
  await screen.findByLabelText("이메일");
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("지점명"), {
    target: { value: "강남점" },
  });
  fireEvent.change(screen.getByLabelText("식별자"), {
    target: { value: "gangnam" },
  });
}

describe("SystemAdminPage branch creation navigation", () => {
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
    mockedGetBranches.mockResolvedValue([createdBranch]);
    mockedGetUsers.mockResolvedValue(users);
    mockedCreateBranch.mockResolvedValue(createdBranch);
  });

  it("replaces the creation detail with the created branch detail", async () => {
    const view = renderPage("new-branch");
    await screen.findByLabelText("이메일");
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() => expect(mockedCreateBranch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/system-admin?section=branches&item=branch-created",
        { scroll: false },
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();

    mockSearchParams = new URLSearchParams({ section: "branches", item: createdBranch.id });
    view.rerenderPage();
    expect(await screen.findByRole("heading", { name: createdBranch.name })).toBeInTheDocument();
  });

  it("keeps the created detail open when the active search excludes the branch", async () => {
    const view = renderPage();
    await screen.findByLabelText("지점 검색");
    fireEvent.change(screen.getByLabelText("지점 검색"), {
      target: { value: "없는 지점" },
    });
    await openCreation(view);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/system-admin?section=branches&item=branch-created",
        { scroll: false },
      ),
    );
    mockSearchParams = new URLSearchParams({ section: "branches", item: createdBranch.id });
    view.rerenderPage();

    expect(document.querySelector('[data-slot="detail-pane"]')).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("heading", { name: createdBranch.name })).toBeInTheDocument();
  });

  it("keeps the created detail open when the active status filter excludes the branch", async () => {
    const view = renderPage();
    await screen.findByLabelText("지점 검색");
    fireEvent.click(screen.getByRole("button", { name: /승인 완료/ }));
    await openCreation(view);
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/system-admin?section=branches&item=branch-created",
        { scroll: false },
      ),
    );
    mockSearchParams = new URLSearchParams({ section: "branches", item: createdBranch.id });
    view.rerenderPage();

    expect(document.querySelector('[data-slot="detail-pane"]')).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByRole("heading", { name: createdBranch.name })).toBeInTheDocument();
  });

  it("closes the creation detail safely when the response has no branch id", async () => {
    mockedCreateBranch.mockResolvedValueOnce({ ...createdBranch, id: "" });
    renderPage("new-branch");
    await screen.findByLabelText("이메일");
    fillRequiredFields();

    fireEvent.click(screen.getByRole("button", { name: "지점 저장" }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/system-admin?section=branches",
        { scroll: false },
      ),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("keeps the entered form values and route after a rejected save", async () => {
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
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("지점명")).toHaveValue("강남점");
    expect(screen.getByLabelText("식별자")).toHaveValue("gangnam");
    expect(screen.getByLabelText("이메일")).toHaveValue("entered@example.com");
  });
});
