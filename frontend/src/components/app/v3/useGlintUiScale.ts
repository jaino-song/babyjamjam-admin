"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const GLINT_UI_BASE_VIEWPORT_WIDTH = 1600;
const GLINT_UI_MOBILE_BREAKPOINT = 768;
const GLINT_UI_MIN_DESKTOP_SCALE = 0.765;
const GLINT_UI_MAX_DESKTOP_SCALE = 0.99;
const GLINT_UI_VIEWPORT_SCALE_CSS_VALUE = "var(--glint-ui-viewport-scale, 1)";
// Page-zoom steps offered by Chrome/Edge and Safari. Firefox-only steps are left
// out on purpose: every extra step makes it likelier that a docked DevTools pane
// or browser side panel (which also widens outerWidth) is mistaken for zoom.
const BROWSER_ZOOM_LEVELS = [
  0.5, 0.63, 0.67, 0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;
const BROWSER_ZOOM_MATCH_TOLERANCE = 0.015;

export type GlintUiScaleStyle = CSSProperties & {
  "--glint-ui-scale": string;
};

export function getGlintUiScaleForViewport(width: number, _height?: number): number {
  // Keep the second argument for existing callers while intentionally sizing from width only.
  void _height;

  if (width < GLINT_UI_MOBILE_BREAKPOINT) {
    return 1;
  }

  return Number((
    Math.min(
      GLINT_UI_MAX_DESKTOP_SCALE,
      Math.max(GLINT_UI_MIN_DESKTOP_SCALE, width / GLINT_UI_BASE_VIEWPORT_WIDTH),
    )
  ).toFixed(4));
}

/**
 * Width the UI should be sized from, with browser zoom taken out.
 *
 * Page zoom shrinks innerWidth (CSS px) but leaves outerWidth (the browser
 * window) unchanged in Chrome/Edge/Safari, so outerWidth / innerWidth is the
 * zoom factor. Sizing from the unzoomed width keeps the scale constant under
 * zoom, so zooming always enlarges (or shrinks) the UI instead of being undone
 * by a smaller scale. The ratio only counts as zoom when it matches a real
 * zoom step; anything else (DevTools docked, a side panel, a browser that
 * reports outerWidth in zoomed pixels) falls back to innerWidth, which is the
 * previous behaviour.
 */
export function getUnzoomedViewportWidth(innerWidth: number, outerWidth: number): number {
  if (!(innerWidth > 0) || !(outerWidth > 0)) return innerWidth;

  const ratio = outerWidth / innerWidth;
  const zoom = BROWSER_ZOOM_LEVELS.find(
    (level) => Math.abs(ratio - level) / level <= BROWSER_ZOOM_MATCH_TOLERANCE,
  );
  // A panel whose width happens to produce a zoom-step ratio is read as zoom;
  // the result is then about the full window width, which is harmless.
  return zoom === undefined ? innerWidth : Math.round(innerWidth * zoom);
}

export function getGlintUiScaleForWindow(
  target: Pick<Window, "innerWidth" | "outerWidth">,
): number {
  // The handset breakpoint is a CSS-pixel layout decision, so it stays on innerWidth.
  if (target.innerWidth < GLINT_UI_MOBILE_BREAKPOINT) {
    return 1;
  }
  return getGlintUiScaleForViewport(
    Math.max(GLINT_UI_MOBILE_BREAKPOINT, getUnzoomedViewportWidth(target.innerWidth, target.outerWidth)),
  );
}

function getGlintUiViewportScaleValue(): string {
  return String(getGlintUiScaleForWindow(window));
}

function useStableGlintUiScaleValue(enabled: boolean): string {
  const [scaleValue, setScaleValue] = useState(GLINT_UI_VIEWPORT_SCALE_CSS_VALUE);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let animationFrameId = 0;

    const updateViewportScale = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        const nextScaleValue = getGlintUiViewportScaleValue();
        setScaleValue((currentScaleValue) => currentScaleValue === nextScaleValue ? currentScaleValue : nextScaleValue);
      });
    };

    updateViewportScale();
    window.addEventListener("resize", updateViewportScale);
    window.visualViewport?.addEventListener("resize", updateViewportScale);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", updateViewportScale);
      window.visualViewport?.removeEventListener("resize", updateViewportScale);
    };
  }, [enabled]);

  return enabled ? scaleValue : "1";
}

export function useGlintUiScaleStyle(enabled: boolean): GlintUiScaleStyle | undefined {
  const scaleValue = useStableGlintUiScaleValue(enabled);

  return useMemo<GlintUiScaleStyle | undefined>(
    () => enabled
      ? {
          "--glint-ui-scale": scaleValue,
        }
      : undefined,
    [enabled, scaleValue],
  );
}
