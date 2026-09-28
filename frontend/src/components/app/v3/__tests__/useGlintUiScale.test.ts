import { act, renderHook } from "@testing-library/react";
import {
  getGlintUiScaleForViewport,
  useGlintUiScaleStyle,
} from "../useGlintUiScale";

describe("Glint UI Scale", () => {
  const originalViewport = {
    width: window.innerWidth,
    height: window.innerHeight,
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
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalViewport.devicePixelRatio,
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

  it("updates after browser zoom changes the CSS viewport width and DPR", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
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

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1152 });
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.25 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
        queuedFrames.splice(0).forEach((callback) => callback(0));
      });

      expect(result.current?.["--glint-ui-scale"]).toBe("0.85");
    } finally {
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });
});
