import { fireEvent, render, screen } from "@testing-library/react";

import { StatMini } from "../StatMini";

function TestIcon({ className }: { className?: string }) {
  return <svg aria-label="stat icon" className={className} />;
}

const DEFAULT_MIN_HEIGHT = "min-h-[calc(85px*var(--glint-ui-scale,1))]";
const SQUARE_MIN_HEIGHT = "min-h-[calc(96px*var(--glint-ui-scale,1))]";
const DESKTOP_MIN_HEIGHT = "min-[961px]:min-h-[calc(85px*var(--glint-ui-scale,1))]";

function getStatMini(dataComponent: string): HTMLElement {
  const element = document.querySelector(`[data-component="${dataComponent}"]`);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`StatMini ${dataComponent} was not rendered`);
  }

  return element;
}

describe("StatMini", () => {
  it("keeps default regular and interactive cards at the same responsive height", () => {
    const handleClick = jest.fn();

    render(
      <>
        <StatMini
          data-component="desktop_test_regular"
          icon={TestIcon}
          value={12}
          counter="건"
          label="진행 계약"
        />
        <StatMini
          data-component="desktop_test_interactive"
          icon={TestIcon}
          value={12}
          counter="건"
          label="전자문서 처리중"
          interactive
          onClick={handleClick}
        />
      </>,
    );

    const regular = getStatMini("desktop_test_regular");
    const interactive = screen.getByRole("button", { name: "전자문서 처리중" });

    for (const card of [regular, interactive]) {
      expect(card).toHaveClass(
        "h-auto",
        DEFAULT_MIN_HEIGHT,
        "whitespace-normal",
        "rounded-[20px]",
        "animate-v3-pop-up",
      );
      expect(card).toHaveAttribute("data-slot", "stat-mini");
      expect(card.querySelector('[data-slot="stat-mini-content"]')).toBeInTheDocument();
      expect(card.querySelector('[data-slot="stat-mini-icon"]')).toHaveClass("shrink-0");
    }

    expect(interactive).not.toHaveClass("h-10", "whitespace-nowrap");
    expect(interactive).toHaveClass("focus-visible:ring-2", "focus-visible:ring-offset-2");
    expect(interactive).toHaveAttribute("data-slot", "stat-mini");

    fireEvent.click(interactive);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("keeps responsive-square geometry across regular and interactive variants", () => {
    render(
      <>
        <StatMini
          data-component="desktop_test_square_regular"
          icon={TestIcon}
          value={4}
          label="전체"
          density="responsive-square"
        />
        <StatMini
          data-component="desktop_test_square_interactive"
          icon={TestIcon}
          value={4}
          label="전체"
          density="responsive-square"
          interactive
        />
      </>,
    );

    for (const dataComponent of ["desktop_test_square_regular", "desktop_test_square_interactive"]) {
      const card = getStatMini(dataComponent);

      expect(card).toHaveClass("aspect-square", SQUARE_MIN_HEIGHT, DESKTOP_MIN_HEIGHT, "h-auto");
    }
  });

  it("keeps loading and long content inside the density-aware hit target", () => {
    const longValue = "12345678901234567890";
    const longLabel = "전자문서 처리중인 작업을 확인할 수 있습니다";

    render(
      <>
        <StatMini
          data-component="desktop_test_loaded"
          icon={TestIcon}
          value={longValue}
          label={longLabel}
        />
        <StatMini
          data-component="desktop_test_loading"
          icon={TestIcon}
          value={longValue}
          label={longLabel}
          isLoading
          interactive
        />
      </>,
    );

    const loaded = getStatMini("desktop_test_loaded");
    const loading = screen.getByRole("button", { name: longLabel });

    for (const card of [loaded, loading]) {
      expect(card).toHaveClass("h-auto", DEFAULT_MIN_HEIGHT, "whitespace-normal");
      expect(card.querySelector('[data-slot="stat-mini-icon"]')).toBeInTheDocument();
      expect(card.querySelector('[data-slot="stat-mini-content"]')).toHaveClass("min-w-0");
    }

    expect(loaded.querySelector('[data-slot="stat-mini-value"]')).toHaveClass("min-w-0", "break-words");
    expect(loaded.querySelector('[data-slot="stat-mini-label"]')).toHaveClass("break-words");
    expect(loaded).toHaveTextContent(`${longValue}${longLabel}`);
    expect(loading.querySelector('[data-slot="stat-mini-value"]')).toBeInTheDocument();
    expect(loading.querySelector('[data-slot="stat-mini-label"]')).toBeInTheDocument();
    expect(loading.querySelector('[data-slot="stat-mini-value"]')).toHaveClass("h-[calc(33px*var(--glint-ui-scale,1))]");
    expect(loading.querySelector('[data-slot="stat-mini-label"]')).toHaveClass("h-[calc(12px*var(--glint-ui-scale,1))]");
  });
});
