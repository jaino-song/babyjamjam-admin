import { fireEvent, render, screen, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { MessageApprovalGate } from "../MessageApprovalGate";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);

const APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

function mockSenderApproval(isApproved: boolean, isLoading = false) {
  mockedUseQuery.mockReturnValue({
    data: isLoading
      ? undefined
      : {
          approvalStatus: isApproved ? "approved" : "not_requested",
          isApproved,
          canRequest: !isApproved,
          requestedAt: null,
          approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
        },
    isLoading,
  } as unknown as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MessageApprovalGate", () => {
  it("renders children when the branch is approved", () => {
    mockSenderApproval(true);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
  });

  it("renders the approval-required notice with the default data-component when unapproved", () => {
    mockSenderApproval(false);

    const { container } = render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.queryByText("approved content")).not.toBeInTheDocument();
    expect(screen.getByText(APPROVAL_MESSAGE)).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_test_message-approval-gate_notice"]'),
    ).toBeInTheDocument();
  });

  it("renders children while the approval query is loading", () => {
    mockSenderApproval(false, true);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
  });

  it("renders a retryable failure state, not the approval-required notice, when the query failed with no data", () => {
    const refetch = jest.fn();
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useQuery>);

    const { container } = render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("발신 승인 상태를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_test_message-approval-gate_notice"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("approved content")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the approval-required notice, with no alert, when the query succeeded with a not-approved answer", () => {
    mockSenderApproval(false);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText(APPROVAL_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the earlier not-approved answer, with no failure state, when a refetch failed", () => {
    mockedUseQuery.mockReturnValue({
      data: {
        approvalStatus: "not_requested",
        isApproved: false,
        canRequest: true,
        requestedAt: null,
        approvedAt: null,
      },
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText(APPROVAL_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders children, with no alert, when approved even if a later refetch failed", () => {
    mockedUseQuery.mockReturnValue({
      data: { approvalStatus: "approved", isApproved: true, canRequest: false },
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate">
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not gate at all when disabled, even if the query failed", () => {
    mockedUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useQuery>);

    render(
      <MessageApprovalGate dataComponent="desktop_test_message-approval-gate" enabled={false}>
        <div>approved content</div>
      </MessageApprovalGate>,
    );

    expect(screen.getByText("approved content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
