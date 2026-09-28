"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const GLINT_UI_BASE_VIEWPORT_WIDTH = 1440;
const GLINT_UI_MOBILE_BREAKPOINT = 768;
const GLINT_UI_MIN_DESKTOP_SCALE = 0.85;
const GLINT_UI_MAX_DESKTOP_SCALE = 1.1;
const GLINT_UI_VIEWPORT_SCALE_CSS_VALUE = "var(--glint-ui-viewport-scale, 1)";

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

function getGlintUiViewportScaleValue(): string {
  return String(getGlintUiScaleForViewport(window.innerWidth));
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
