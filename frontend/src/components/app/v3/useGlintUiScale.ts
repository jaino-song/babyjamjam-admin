"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const GLINT_UI_BASE_VIEWPORT_WIDTH = 1920;
const GLINT_UI_BASE_VIEWPORT_HEIGHT = 1080;
const GLINT_UI_SCALE_MULTIPLIER = 1.1;
const GLINT_UI_VIEWPORT_SCALE_CSS_VALUE = `calc(min(calc(100vw / ${GLINT_UI_BASE_VIEWPORT_WIDTH}px), calc(100vh / ${GLINT_UI_BASE_VIEWPORT_HEIGHT}px)) * ${GLINT_UI_SCALE_MULTIPLIER})`;
const GLINT_UI_DPR_CHANGE_EPSILON = 0.001;

export type GlintUiScaleStyle = CSSProperties & {
  "--glint-ui-scale": string;
};

export function getGlintUiScaleForViewport(width: number, height: number): number {
  return Number((
    Math.min(
      width / GLINT_UI_BASE_VIEWPORT_WIDTH,
      height / GLINT_UI_BASE_VIEWPORT_HEIGHT,
    ) * GLINT_UI_SCALE_MULTIPLIER
  ).toFixed(4));
}

function getGlintUiViewportScaleValue(): string {
  return String(getGlintUiScaleForViewport(window.innerWidth, window.innerHeight));
}

function useStableGlintUiScaleValue(enabled: boolean): string {
  const lastDprRef = useRef<number | null>(null);
  const [scaleValue, setScaleValue] = useState(GLINT_UI_VIEWPORT_SCALE_CSS_VALUE);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    lastDprRef.current = window.devicePixelRatio || 1;
    let animationFrameId = 0;

    const updateViewportScale = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        const previousDpr = lastDprRef.current || window.devicePixelRatio || 1;
        const currentDpr = window.devicePixelRatio || previousDpr;

        if (Math.abs(currentDpr - previousDpr) > GLINT_UI_DPR_CHANGE_EPSILON) {
          lastDprRef.current = currentDpr;
          return;
        }

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
