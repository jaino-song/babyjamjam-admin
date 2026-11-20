import { render, screen } from "@testing-library/react";

import TemplatesPage from "./page";

const mockUseSystemTemplates = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/messages/templates",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "user", branchRole: "manager" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplates: () => mockUseSystemTemplates(),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 20,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

it("names template list loading without visible wait copy", () => {
  mockUseSystemTemplates.mockReturnValue({ data: undefined, isLoading: true });
  render(<TemplatesPage />);
  const status = screen.getByRole("status", { name: "템플릿을 불러오고 있습니다" });
  expect(status).toHaveAttribute("data-slot", "loading-state");
  expect(status).toHaveAttribute("data-source-component", "LoadingState");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByText("템플릿을 불러오고 있습니다")).toHaveClass("sr-only");
});
