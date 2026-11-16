import { render, screen } from "@testing-library/react";

import { ContractStatsBar } from "./ContractStatsBar";
import { DocumentJobsStatMini } from "./DocumentJobsStatMini";
import { ContractDocumentJobsList } from "./ContractDocumentJobsList";

let mockIsSummaryFetching = false;
const mockRegisterCard = jest.fn(() => () => {});
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({
    summary: undefined, summaryError: new Error("offline"), total: 0, unresolvedCount: 0,
    isSummaryLoading: false, isSummaryFetching: mockIsSummaryFetching,
    refetchSummary: jest.fn(), registerCard: mockRegisterCard,
  }),
}));
jest.mock("./ContractDocumentJobsPopover", () => ({
  ContractDocumentJobsPopover: () => null,
}));

it("lets the loading label name the stats retry, retaining the idle aria-label", () => {
  const props = { items: [], name: "desktop_contracts", showDocumentJobs: false, statsError: new Error("offline"), onRetryStats: jest.fn() };
  const { rerender } = render(<ContractStatsBar {...props} />);
  expect(screen.getByRole("button", { name: "계약 통계 다시 시도" })).toBeEnabled();
  rerender(<ContractStatsBar {...props} isStatsRefreshing />);
  expect(screen.getByRole("button", { name: "다시 시도 중" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "계약 통계 다시 시도" })).not.toBeInTheDocument();
});

it("lets the loading label name the document summary retry, retaining the idle aria-label", () => {
  mockIsSummaryFetching = false;
  const { rerender } = render(<DocumentJobsStatMini mode="always" name="desktop_contracts" />);
  expect(screen.getByRole("button", { name: "전자문서 처리 현황 다시 시도" })).toBeEnabled();
  mockIsSummaryFetching = true;
  rerender(<DocumentJobsStatMini mode="always" name="desktop_contracts" />);
  expect(screen.getByRole("button", { name: "다시 시도 중" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "전자문서 처리 현황 다시 시도" })).not.toBeInTheDocument();
});

it("preserves the caller context on the document list loading state", () => {
  render(<ContractDocumentJobsList data-component="desktop_contracts_tests_jobs-list" isLoading collapsed={{ processing: false, attention: false, recent: false }} onToggle={jest.fn()} onSelect={jest.fn()} />);
  expect(screen.getByRole("status", { name: "전자문서 작업 불러오는 중" }))
    .toHaveAttribute("data-component", "desktop_contracts_tests_jobs-list_loading");
});
