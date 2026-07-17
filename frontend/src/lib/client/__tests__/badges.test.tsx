import { render, screen } from "@testing-library/react";

import { StatusBadge } from "@/components/app/v3/StatusBadge";
import { getClientBadgeAvatarClassName } from "@/lib/client/badges";

describe("pre-booking client badge", () => {
  it("uses the neutral gray badge and avatar treatment", () => {
    render(<StatusBadge status="preBooking" />);

    expect(screen.getByText("예약 전")).toHaveClass("bg-[hsl(220,20%,97%)]");
    expect(getClientBadgeAvatarClassName({
      key: "service_status",
      status: "preBooking",
      tone: "neutral",
    })).toContain("bg-[hsl(220,20%,97%)]");
  });
});
