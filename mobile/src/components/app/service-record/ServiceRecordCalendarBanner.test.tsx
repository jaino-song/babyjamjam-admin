import { render, screen } from "@testing-library/react";

import { ServiceRecordCalendarBanner } from "./ServiceRecordCalendarBanner";

describe("ServiceRecordCalendarBanner", () => {
  it("takes its own space after the page content instead of covering the page bottom", () => {
    render(
      <ServiceRecordCalendarBanner
        data-component="test_calendar-banner"
        error="load-failed"
        loading={false}
        onRetry={jest.fn()}
      />,
    );

    const banner = document.querySelector("[data-component='test_calendar-banner']");
    expect(banner).not.toBeNull();
    expect(banner).toHaveAttribute("data-source-component", "ServiceRecordCalendarBanner");
    expect(banner?.className).toContain("sticky");
    expect(banner?.className).not.toMatch(/\bfixed\b/);
    expect(banner?.className).toContain("env(safe-area-inset-bottom)");
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
