import { render, screen } from "@testing-library/react";

import { InfoTooltip } from "./InfoTooltip";

it("keeps the small inline icon and caller spacing with a scaled 44px touch area", () => {
  render(<InfoTooltip text="통계 설명" ariaLabel="방문자 도움말" className="-ml-0.5" dataComponent="desktop_stats_kpi_info" />);
  const trigger = screen.getByRole("button", { name: "방문자 도움말" });
  expect(trigger).toHaveClass("relative", "-ml-0.5", "after:h-[calc(44px*var(--glint-ui-scale,1))]", "after:w-[calc(44px*var(--glint-ui-scale,1))]");
  expect(trigger.querySelector("svg")).toHaveClass("w-3.5", "h-3.5");
});
