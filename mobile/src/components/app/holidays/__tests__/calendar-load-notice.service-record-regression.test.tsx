import { render, screen } from "@testing-library/react";

import { ServiceRecordCalendarBanner } from "@/components/app/service-record/ServiceRecordCalendarBanner";

describe("service-record calendar loading compatibility", () => {
  it("keeps the existing visible loading text when the banner does not opt in", () => {
    const { container } = render(
      <ServiceRecordCalendarBanner
        data-component="mobile_service-record_calendar-banner"
        error={null}
        loading
        onRetry={jest.fn()}
      />,
    );

    const text = screen.getByText("공휴일 정보를 불러오는 중이에요…");
    expect(text.tagName).toBe("P");
    expect(text).toBeVisible();
    expect(text).not.toHaveClass("sr-only");
    expect(screen.getByRole("status")).toContainElement(text);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
  });
});
