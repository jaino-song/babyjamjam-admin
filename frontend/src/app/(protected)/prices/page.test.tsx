import { render, screen } from "@testing-library/react";

import PricesPage from "./page";

let mockDocumentJobsActive = false;
jest.mock("@/components/app/settings/VoucherPriceTable", () => ({ VoucherPriceTable: () => null }));
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => {
  const actual = jest.requireActual("@/features/document-jobs/DocumentJobsProvider");
  return {
    ...actual,
    useDocumentJobs: () => ({
      ...actual.useDocumentJobs(),
      summary: { activeCount: mockDocumentJobsActive ? 1 : 0, unresolvedCount: 0 },
      total: mockDocumentJobsActive ? 1 : 0,
      unresolvedCount: 0,
    }),
  };
});

describe("prices jobs-only stats", () => {
  it.each([false, true])("renders a first-child jobs-only row only when active: %s", (active) => {
    mockDocumentJobsActive = active;
    const { container } = render(<PricesPage />);
    const row = container.querySelector('[data-component="desktop_prices_page_stats"]');
    if (active) {
      expect(row?.parentElement?.firstElementChild).toBe(row);
      expect(row?.firstElementChild).toBe(screen.getByRole("button", { name: "전자문서 처리중 작업 보기" }));
      expect(row?.children).toHaveLength(1);
    } else {
      expect(row).not.toBeInTheDocument();
    }
  });
});
