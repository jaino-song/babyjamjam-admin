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

  it("scrolls the page content below md and gives the split a viewport-tall area", () => {
    const { container } = render(<ConsultationsPage />);
    const region = container.querySelector('[data-slot="page-scroll-region"]') as HTMLElement;

    expect(region).toBeInTheDocument();
    expect(region).toHaveClass("contents", "max-md:flex", "max-md:min-h-0", "max-md:flex-1", "max-md:flex-col", "max-md:overflow-y-auto");
    expect(region.className).toContain("max-md:[&>[data-slot=split-layout]]:min-h-[calc(100vh-calc(160px*var(--glint-ui-scale,1)))]");
    expect(region.parentElement).toHaveAttribute("data-component", "consultations");
    expect(region.firstElementChild).toBe(container.querySelector('[data-component="consultations_stats"]'));
    expect(region.lastElementChild).toBe(container.querySelector('[data-slot="split-layout"]'));
  });
});
