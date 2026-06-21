"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

const BASE_VIEWPORT_WIDTH = 1920;
const BASE_VIEWPORT_HEIGHT = 1080;
const CONTRACTS_UI_SCALE_MULTIPLIER = 1.1;
const V3_UI_VIEWPORT_SCALE_CSS_VALUE = `calc(min(calc(100vw / ${BASE_VIEWPORT_WIDTH}px), calc(100vh / ${BASE_VIEWPORT_HEIGHT}px)) * ${CONTRACTS_UI_SCALE_MULTIPLIER})`;
const DPR_CHANGE_EPSILON = 0.001;

export type V3ScaleStyle = CSSProperties & {
  "--v3-ui-scale": string;
};

function getViewportScaleValue(): string {
  return String(Number((
    Math.min(
      window.innerWidth / BASE_VIEWPORT_WIDTH,
      window.innerHeight / BASE_VIEWPORT_HEIGHT,
    ) * CONTRACTS_UI_SCALE_MULTIPLIER
  ).toFixed(4)));
}

function useStableV3ScaleValue(enabled: boolean): string {
  const lastDprRef = useRef<number | null>(null);
  const [scaleValue, setScaleValue] = useState(V3_UI_VIEWPORT_SCALE_CSS_VALUE);

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

        if (Math.abs(currentDpr - previousDpr) > DPR_CHANGE_EPSILON) {
          lastDprRef.current = currentDpr;
          return;
        }

        const nextScaleValue = getViewportScaleValue();
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

export function useV3UiScaleStyle(enabled: boolean): V3ScaleStyle | undefined {
  const scaleValue = useStableV3ScaleValue(enabled);

  return useMemo<V3ScaleStyle | undefined>(
    () => enabled
      ? {
          "--v3-ui-scale": scaleValue,
        }
      : undefined,
    [enabled, scaleValue],
  );
}
