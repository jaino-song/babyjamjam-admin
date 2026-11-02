import { render } from "@testing-library/react";

import { useAllConsultationInquiries, useConsultationInquiries } from "@/hooks/useConsultationInquiries";
import type { ConsultationInquiryListResponse } from "@/services/api";
import ConsultationsPage from "./page";

jest.mock("@/hooks/useConsultationInquiries", () => ({
  useConsultationInquiries: jest.fn(),
  useAllConsultationInquiries: jest.fn(),
  useMarkConsultationInquiryRead: () => ({ mutate: jest.fn() }),
}));

const empty: ConsultationInquiryListResponse = { data: [], total: 0, page: 1, limit: 50, totalPages: 1 };
const query = {
  data: empty, isError: false, isLoading: false, isFetching: false, refetch: jest.fn(),
};

describe("ConsultationsPage narrow viewport layout (below md)", () => {
  beforeEach(() => {
    jest.mocked(useConsultationInquiries).mockReturnValue(query as unknown as ReturnType<typeof useConsultationInquiries>);
    jest.mocked(useAllConsultationInquiries).mockReturnValue(query as unknown as ReturnType<typeof useAllConsultationInquiries>);
  });

  it("scrolls the page content below md around a real-box split area", () => {
    const { container } = render(<ConsultationsPage />);
    const region = container.querySelector('[data-slot="page-scroll-region"]') as HTMLElement;
    const splitArea = container.querySelector('[data-slot="split-area"]') as HTMLElement;
    const split = container.querySelector('[data-slot="split-layout"]') as HTMLElement;

    expect(region).toBeInTheDocument();
    expect(region).toHaveClass("contents", "max-md:flex", "max-md:min-h-0", "max-md:flex-1", "max-md:flex-col", "max-md:overflow-y-auto");
    expect(region.className).not.toContain("[&>[data-slot=split-layout]]");
    expect(region.parentElement).toHaveAttribute("data-component", "consultations");
    expect(region.firstElementChild).toBe(container.querySelector('[data-component="consultations_stats"]'));
    expect(region.lastElementChild).toBe(splitArea);

    // SplitLayout sizes its compact panels from its parent's box width, so that parent
    // must never be the `display: contents` scroll region (0px-wide panels at 768-1279px).
    expect(splitArea).toBeInTheDocument();
    expect(splitArea).toHaveClass("flex", "min-h-0", "flex-1", "flex-col", "max-md:min-h-[calc(100vh-calc(160px*var(--glint-ui-scale,1)))]");
    expect(splitArea.className).not.toMatch(/(^|\s)contents(\s|$)/);
    expect(split.parentElement).toBe(splitArea);
    expect(split.parentElement).not.toBe(region);
  });
});
