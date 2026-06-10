import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CallInboxPage } from "../CallInboxPage";

const mockUseClientDrafts = jest.fn();
const mockUseCallRecords = jest.fn();
const mockUsePendingDraftCount = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useClientDrafts: (...args: unknown[]) => mockUseClientDrafts(...args),
  useCallRecords: (...args: unknown[]) => mockUseCallRecords(...args),
  usePendingDraftCount: () => mockUsePendingDraftCount(),
  useClientDraft: () => ({ data: undefined }),
  useCallRecord: () => ({ data: undefined }),
  useConfirmDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePatchDraft: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: () => <div data-testid="client-autocomplete-stub" />,
}));

// CallLogSheet uses useCallRecord; stub the whole sheet so we don't need full
// call-record fixtures in this page-level test.
jest.mock("../CallLogSheet", () => ({
  CallLogSheet: () => <div data-testid="call-log-sheet-stub" />,
}));

// CallReviewSheet needs heavy fixture data; stub it too at page level.
jest.mock("../CallReviewSheet", () => ({
  CallReviewSheet: () => <div data-testid="call-review-sheet-stub" />,
}));

const draft = {
  id: "draft-1",
  type: "NEW_CLIENT",
  status: "PENDING",
  requestSummary: "산후도우미 신규 문의",
  callerName: "김서연",
  callerPhone: "01048217763",
  recordedAt: "2026-06-10T05:02:11.000Z",
  createdAt: "2026-06-10T05:10:00.000Z",
  callRecordId: "rec-1",
  client: null,
  hasLowConfidence: true,
  possibleDuplicate: false,
  phoneMatchesExistingClient: false,
};

describe("CallInboxPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePendingDraftCount.mockReturnValue({ data: { count: 1 } });
    mockUseClientDrafts.mockReturnValue({
      data: { data: [draft], total: 1, page: 1, limit: 20, totalPages: 1 },
      isLoading: false,
    });
    mockUseCallRecords.mockReturnValue({ data: undefined, isLoading: true });
  });

  it("renders the queue with type badge, caller, and low-confidence flag", () => {
    render(<CallInboxPage />);
    // Badge label rendered by DraftCard > Badge component
    expect(screen.getByText("신규 상담")).toBeInTheDocument();
    // Caller name inside DraftCard
    expect(screen.getByText(/김서연/)).toBeInTheDocument();
    // Low-confidence warning rendered by DraftCard
    expect(screen.getByText(/확신도 낮음/)).toBeInTheDocument();
  });

  it("switches to the call-log tab and shows its empty state", async () => {
    const user = userEvent.setup();
    mockUseCallRecords.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      isLoading: false,
    });
    render(<CallInboxPage />);

    // FilterPills renders each tab label as a button with a trailing count span.
    // getByText with exact:false matches the button node that contains the label text.
    await user.click(screen.getByText("통화 기록", { exact: false, selector: "button" }));

    expect(screen.getByText("통화 기록이 없습니다")).toBeInTheDocument();
  });
});
