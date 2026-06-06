import { render } from "@testing-library/react";

import { ListCountSkeleton, ListRowsSkeleton } from "../primitives";

describe("mobile redesign list skeletons", () => {
  it("uses the provided data-component prefix for count and row skeletons", () => {
    const { container } = render(
      <>
        <ListCountSkeleton dataComponentPrefix="mobile-employees" />
        <ListRowsSkeleton dataComponentPrefix="mobile-employees" rowCount={2} />
      </>
    );

    expect(container.querySelector('[data-component="mobile-employees-count-skeleton"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="mobile-employees-loading-skeleton"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component="mobile-employees-row-skeleton"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-component="mobile-employees-row-skeleton-info"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-component="mobile-employees-row-skeleton-right"]')).toHaveLength(2);
  });

  it("matches the shared list row structure", () => {
    const { container } = render(<ListRowsSkeleton dataComponentPrefix="mobile-clients" rowCount={1} />);
    const row = container.querySelector('[data-component="mobile-clients-row-skeleton"]');
    const info = container.querySelector('[data-component="mobile-clients-row-skeleton-info"]');
    const right = container.querySelector('[data-component="mobile-clients-row-skeleton-right"]');

    expect(row).toHaveClass("list-item");
    expect(info).toHaveClass("list-info", "flex", "flex-col");
    expect(right).toHaveClass("list-right");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });
});
