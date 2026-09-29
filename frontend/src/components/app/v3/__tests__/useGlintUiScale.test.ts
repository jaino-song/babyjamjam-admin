import { act, renderHook } from "@testing-library/react";
import {
  getGlintUiScaleForViewport,
  getGlintUiScaleForWindow,
  getUnzoomedViewportWidth,
  useGlintUiScaleStyle,
} from "../useGlintUiScale";

describe("Glint UI Scale", () => {
  const originalViewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    outerWidth: window.outerWidth,
    devicePixelRatio: window.devicePixelRatio,
  };

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalViewport.width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalViewport.height,
    });
    Object.defineProperty(window, "outerWidth", {
      configurable: true,
      value: originalViewport.outerWidth,
    });
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalViewport.devicePixelRatio,
    });
  });

  describe("browser zoom", () => {
    it.each([
      ["100%", 1440, 1440],
      ["110%", 1309, 1440],
      ["125%", 1152, 1440],
      ["150%", 960, 1440],
      ["175%", 823, 1440],
    ])("keeps the 1440px-window scale at %s zoom so zoom always enlarges", (_zoom, innerWidth, outerWidth) => {
      expect(getGlintUiScaleForWindow({ innerWidth, outerWidth })).toBe(1);
    });

    it("zooming out shrinks too: 80% on a 1440px window keeps the unzoomed scale", () => {
      expect(getUnzoomedViewportWidth(1800, 1440)).toBe(1440);
      expect(getGlintUiScaleForWindow({ innerWidth: 1800, outerWidth: 1440 })).toBe(1);
    });

    it("treats a thin window frame (Windows) as 100%, not zoom", () => {
      expect(getUnzoomedViewportWidth(1440, 1456)).toBe(1440);
    });

    it.each([
      ["DevTools docked (400px)", 1040, 1440],
      ["side panel (320px)", 1120, 1440],
      ["side panel (360px) at 125% zoom", 864, 1440],
    ])("falls back to the page width when the ratio is not a zoom step: %s", (_case, innerWidth, outerWidth) => {
      expect(getUnzoomedViewportWidth(innerWidth, outerWidth)).toBe(innerWidth);
    });

    it("falls back to the page width when outerWidth is unavailable", () => {
      expect(getUnzoomedViewportWidth(1300, 0)).toBe(1300);
    });

    it("keeps handsets at full size even when zoomed", () => {
      expect(getGlintUiScaleForWindow({ innerWidth: 700, outerWidth: 875 })).toBe(1);
    });
  });

  it.each([[390, 844], [390, 400], [767, 844]])(
    "keeps handset text at full size for %sx%s",
    (width, height) => {
      expect(getGlintUiScaleForViewport(width, height)).toBe(1);
    },
  );

  it.each([[768, 844], [844, 390], [1024, 600], [1024, 1400]])(
    "keeps desktop shells at the minimum scale when their width is below the reference for %sx%s",
    (width, height) => {
      expect(getGlintUiScaleForViewport(width, height)).toBe(0.85);
    },
  );

  it("clamps the width ratio to the approved desktop range", () => {
    expect(getGlintUiScaleForViewport(1440, 700)).toBe(1);
    expect(getGlintUiScaleForViewport(1300, 900)).toBe(0.9028);
    expect(getGlintUiScaleForViewport(1584, 500)).toBe(1.1);
    expect(getGlintUiScaleForViewport(1920, 1080)).toBe(1.1);
  });

  it("uses width only so changing height preserves scale and scroll capacity", () => {
    expect(getGlintUiScaleForViewport(1280, 720)).toBe(
      getGlintUiScaleForViewport(1280, 400),
    );
  });

  it("starts with the CSS fallback and hydrates to the same width-based value", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const queuedFrames: FrameRequestCallback[] = [];
    const requestFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    try {
      const { result } = renderHook(() => useGlintUiScaleStyle(true));

      expect(result.current?.["--glint-ui-scale"]).toBe(
        "var(--glint-ui-viewport-scale, 1)",
      );

      act(() => {
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });

      expect(result.current?.["--glint-ui-scale"]).toBe("1");
    } finally {
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });

  it("does not resize the scale when only the viewport height changes", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    const queuedFrames: FrameRequestCallback[] = [];
    const requestFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    try {
      const { result } = renderHook(() => useGlintUiScaleStyle(true));
      act(() => {
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });
      expect(result.current?.["--glint-ui-scale"]).toBe("0.8889");

      Object.defineProperty(window, "innerHeight", { configurable: true, value: 420 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });

      expect(result.current?.["--glint-ui-scale"]).toBe("0.8889");
    } finally {
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });

  it("keeps the scale when browser zoom narrows the page, so zoom enlarges the UI", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "outerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    const queuedFrames: FrameRequestCallback[] = [];
    const requestFrameSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        queuedFrames.push(callback);
        return queuedFrames.length;
      });
    const cancelFrameSpy = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    try {
      const { result } = renderHook(() => useGlintUiScaleStyle(true));
      act(() => {
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });
      expect(result.current?.["--glint-ui-scale"]).toBe("1");

      // 125% zoom: the page is 1152 CSS px wide inside the same 1440px window.
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1152 });
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.25 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });

      expect(result.current?.["--glint-ui-scale"]).toBe("1");
    } finally {
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });
});
