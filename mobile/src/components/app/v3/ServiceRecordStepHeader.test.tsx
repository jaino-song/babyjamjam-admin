import { render, screen } from "@testing-library/react";

import { ServiceRecordStepHeader } from "./ServiceRecordStepHeader";

const BASE = "mobile_test_step-header";

describe("ServiceRecordStepHeader", () => {
  it("renders the title as h1 with meta and crumbs", () => {
    render(
      <ServiceRecordStepHeader
        data-component={BASE}
        title="산모·신생아 건강관리 서비스 제공기록지"
        meta="베이비잼잼 고양파주점"
        crumbs={<><b>3회차</b> · 산모 (1/4)</>}
        progress={0.4}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "산모·신생아 건강관리 서비스 제공기록지" }),
    ).toBeInTheDocument();
    expect(screen.getByText("베이비잼잼 고양파주점")).toBeInTheDocument();
    expect(screen.getByText("3회차")).toBeInTheDocument();
  });

  it("exposes a progressbar with rounded percent and the default name", () => {
    render(<ServiceRecordStepHeader data-component={BASE} title="제목" progress={0.404} />);

    const bar = screen.getByRole("progressbar", { name: "진행률" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("clamps progress to 0..100 and tolerates NaN", () => {
    const { rerender } = render(<ServiceRecordStepHeader data-component={BASE} title="제목" progress={1.7} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    rerender(<ServiceRecordStepHeader data-component={BASE} title="제목" progress={-0.5} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    rerender(<ServiceRecordStepHeader data-component={BASE} title="제목" progress={Number.NaN} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("accepts a custom progress label", () => {
    render(<ServiceRecordStepHeader data-component={BASE} title="제목" progress={0.5} progressLabel="작성 진행률" />);
    expect(screen.getByRole("progressbar", { name: "작성 진행률" })).toBeInTheDocument();
  });

  it("names its children from the root data-component", () => {
    const { container } = render(
      <ServiceRecordStepHeader data-component={BASE} title="제목" meta="지점" crumbs="1단계" progress={0.2} />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-component", BASE);
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ServiceRecordStepHeader");
    for (const suffix of ["title", "meta-row", "meta", "crumbs", "progress", "progress_fill"]) {
      expect(container.querySelector(`[data-component="${BASE}_${suffix}"]`)).not.toBeNull();
    }
  });
});
