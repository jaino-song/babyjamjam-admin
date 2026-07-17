import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { OwnerAdminConsole } from "../OwnerAdminConsole";

jest.mock("@/components/app/settings/NotificationTestSection", () => ({
  NotificationTestSection: () => <div>알림 테스트 실행 도구</div>,
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const approveMutate = jest.fn();
const invalidateQueries = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedUseMutation.mockReturnValue({
    mutate: approveMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useMutation>);
  mockedUseQuery.mockImplementation(({ queryKey }) => {
    if (Array.isArray(queryKey) && queryKey[0] === "systemAdminUsers") {
      return {
        data: [
          {
            id: "approved-user",
            kakaoId: null,
            email: "approved@example.com",
            name: "승인된 계정",
            phone: "010-1111-1111",
            birthDate: "19900101",
            profileImage: null,
            role: "manager",
            createdAt: "2026-06-01T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [{ id: "branch-real-gangnam", name: "강남점", role: "manager" }],
            approvalStatus: "approved",
            requestedRole: "manager",
          },
          {
            id: "pending-user",
            kakaoId: null,
            email: "pending@example.com",
            name: "가입 대기 계정",
            phone: "010-2222-2222",
            birthDate: "19920202",
            profileImage: null,
            role: null,
            createdAt: "2026-06-04T00:00:00.000Z",
            emailVerified: true,
            authProvider: "email",
            branches: [{ id: "branch-real-gangnam", name: "강남점", role: null }],
            approvalStatus: "pending",
            requestedRole: "manager",
          },
        ],
        error: null,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (Array.isArray(queryKey) && queryKey[0] === "systemAdminBranchRequests") {
      return {
        data: [
          {
            id: "branch-real-gangnam",
            name: "강남점",
            slug: "gangnam",
            region: "서울",
            district: "강남구",
            address: "서울 강남구",
            phone: "02-1234-5678",
            email: "gangnam@example.com",
            isActive: true,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-04T00:00:00.000Z",
            owner: {
              id: "owner-1",
              name: "김오너",
              email: "owner@example.com",
              phone: "010-1111-2222",
              role: "owner",
            },
            messageSenderApproval: {
              approvalStatus: "pending",
              requestedAt: "2026-06-04T09:00:00.000Z",
              approvedAt: null,
              requestedBy: {
                id: "manager-1",
                name: "박매니저",
                email: "manager@example.com",
                phone: "010-3333-4444",
                role: "manager",
              },
            },
          },
        ],
        error: null,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    return {
      data: [],
      error: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>;
  });
});

describe("OwnerAdminConsole", () => {
  it("starts with live branch data and omits mock-only sections", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "회원가입 관리" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "정부지원금 관리" })).not.toBeInTheDocument();
    expect(screen.queryByText("김서윤")).not.toBeInTheDocument();
    expect(screen.queryByText("2026 돌봄 바우처 단가 반영")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(screen.getByRole("textbox", { name: "지점 관리 검색" })).toBeInTheDocument();
  });

  it("renders branch management from API data instead of branch mock records", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("지점장: 박매니저")).toBeInTheDocument();
    expect(screen.queryByText("신청인: 박매니저")).not.toBeInTheDocument();
    expect(screen.getAllByText("메시지 신청").length).toBeGreaterThan(0);
    expect(screen.queryByText("부평점")).not.toBeInTheDocument();
  });

  it("hides branch status pills on all branches and shows them on the message request tab", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "전체 지점" })).toBeInTheDocument();

    const allBranchesItem = screen.getByRole("button", { name: /강남점/ });
    expect(within(allBranchesItem).queryByText("서울 강남구")).not.toBeInTheDocument();
    expect(within(allBranchesItem).queryByText("메시지 승인 신청")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "메시지 신청" }));

    const messageRequestItem = screen.getByRole("button", { name: /강남점/ });
    expect(within(messageRequestItem).getByText("메시지 승인 신청")).toBeInTheDocument();
  });

  it("approves a pending message sender request from the branch detail", async () => {
    render(<OwnerAdminConsole />);

    await waitFor(() => {
      expect(screen.getAllByText("강남점").length).toBeGreaterThan(0);
    });
    // Select the 강남점 list item to open its detail panel (auto-selection now
    // requires desktop viewport; in tests splitLayoutMode stays null so we must
    // click explicitly).
    fireEvent.click(screen.getByRole("button", { name: /강남점/ }));
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(approveMutate).toHaveBeenCalledWith("branch-real-gangnam");
  });

  it("manages pending accounts inside the same split layout as branch management", () => {
    const { container } = render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "계정 관리" })[0]);

    expect(container.querySelector('[data-component="split-layout"]')).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="system-admin-pending-approvals"]'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "가입 대기" }));
    fireEvent.click(screen.getByRole("button", { name: /가입 대기 계정/ }));

    const roleSelect = screen.getByRole("combobox", {
      name: "가입 대기 계정 승인 권한 선택",
    });
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(approveMutate).toHaveBeenCalledWith({
      id: "pending-user",
      role: "admin",
      branchId: "branch-real-gangnam",
    });
    expect(screen.getByRole("button", { name: "거절" })).toBeInTheDocument();
  });

  it("shows the functional notification tool without placeholder approval actions", async () => {
    render(<OwnerAdminConsole />);

    fireEvent.click(screen.getAllByRole("button", { name: "알림 테스트" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /브라우저 알림 테스트/ }));

    expect(screen.getByText("알림 테스트 실행 도구")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "거부" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "더보기" })).not.toBeInTheDocument();
  });
});
