import { render } from "@testing-library/react";

import { ServiceRecordHeaderCard } from "@/features/service-records/components/ServiceRecordHeaderCard";
import { InfoCard } from "../InfoCard";

describe("InfoCard surfaces", () => {
  it("renders a white, strongly outlined card without a shadow", () => {
    const { container } = render(
      <InfoCard data-component="desktop_clients-detail_panel_info-card" title="기본 정보">
        내용
      </InfoCard>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-source-component", "InfoCard");
    expect(container.firstElementChild).toHaveClass(
      "bg-white", "border", "border-[#818b98]", "rounded-[16px]", "shadow-none",
    );
    expect(container.firstElementChild).not.toHaveClass("bg-v3-dim-white");
    expect(container.firstElementChild).not.toHaveClass("rounded-[18px]");
  });

  it("preserves the muted ServiceRecordHeaderCard surface", () => {
    const { container } = render(
      <ServiceRecordHeaderCard data-component="desktop_clients-detail_panel_header-card" header={null} />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceRecordHeaderCard");
    expect(container.firstElementChild).toHaveClass("bg-v3-dim-white", "rounded-[18px]");
    expect(container.firstElementChild).not.toHaveClass("bg-white");
    expect(container.firstElementChild).not.toHaveClass("border-[#818b98]");
    expect(container.firstElementChild).not.toHaveClass("rounded-[16px]");
  });
});
