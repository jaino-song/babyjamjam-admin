/* eslint-disable @next/next/no-img-element */

"use client";

import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

const RHWP_WASM_PATH = "/vendor/rhwp/rhwp_bg.wasm";

interface HwpDocumentPreviewProps {
  previewUrl: string;
  previewKey?: string;
  title: string;
  pageWidth: number;
}

interface HwpPage {
  pageNumber: number;
  url: string;
}

interface HwpDocumentInstance {
  free?: () => void;
  pageCount: () => number;
  renderPageSvg: (pageNumber: number) => string;
}

interface RhwpCoreModule {
  default: (options: { module_or_path: string }) => Promise<unknown>;
  HwpDocument: new (bytes: Uint8Array) => HwpDocumentInstance;
}

type HwpPreviewState =
  | { status: "loading"; pages: HwpPage[] }
  | { status: "ready"; pages: HwpPage[] }
  | { status: "error"; pages: HwpPage[] };

let rhwpCorePromise: Promise<RhwpCoreModule> | null = null;

function ensureMeasureTextWidth(): void {
  const globalTarget = globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number;
  };

  if (globalTarget.measureTextWidth) {
    return;
  }

  let context: CanvasRenderingContext2D | null = null;
  let lastFont = "";

  globalTarget.measureTextWidth = (font, text) => {
    context ??= document.createElement("canvas").getContext("2d");
    if (!context) {
      return text.length * 10;
    }

    if (font !== lastFont) {
      context.font = font;
      lastFont = font;
    }

    return context.measureText(text).width;
  };
}

async function loadRhwpCore(): Promise<RhwpCoreModule> {
  if (!rhwpCorePromise) {
    rhwpCorePromise = (async () => {
      ensureMeasureTextWidth();
      const rhwpModule = (await import("@rhwp/core")) as unknown as RhwpCoreModule;
      await rhwpModule.default({ module_or_path: RHWP_WASM_PATH });
      return rhwpModule;
    })();
  }

  return rhwpCorePromise;
}

export function HwpDocumentPreview({
  previewUrl,
  previewKey,
  title,
  pageWidth,
}: HwpDocumentPreviewProps) {
  const [state, setState] = useState<HwpPreviewState>({ status: "loading", pages: [] });

  useEffect(() => {
    let isCanceled = false;
    const pageUrls: string[] = [];

    setState({ status: "loading", pages: [] });

    async function renderDocument(): Promise<void> {
      try {
        const [{ HwpDocument }, response] = await Promise.all([
          loadRhwpCore(),
          fetch(previewUrl),
        ]);

        if (!response.ok) {
          throw new Error(`Failed to fetch HWP document: ${response.status}`);
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        const document = new HwpDocument(bytes);

        try {
          const totalPages = document.pageCount();
          const pages = Array.from({ length: totalPages }, (_, index) => {
            const svg = document.renderPageSvg(index);
            const blob = new Blob([svg], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            pageUrls.push(url);

            return {
              pageNumber: index + 1,
              url,
            };
          });

          if (isCanceled) {
            pageUrls.forEach((url) => URL.revokeObjectURL(url));
            return;
          }

          setState({ status: "ready", pages });
        } finally {
          document.free?.();
        }
      } catch {
        if (!isCanceled) {
          pageUrls.forEach((url) => URL.revokeObjectURL(url));
          setState({ status: "error", pages: [] });
        }
      }
    }

    void renderDocument();

    return () => {
      isCanceled = true;
      pageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewKey, previewUrl]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-text shadow-sm">
          <Spinner size="sm" className="text-v3-primary" />
          한글 문서를 불러오는 중입니다
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-burgundy shadow-sm">
          한글 문서 미리보기를 불러오지 못했습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center gap-6">
      {state.pages.map((page) => (
        <div
          key={`${previewKey ?? title}-hwp-page-${page.pageNumber}`}
          data-testid={`hwp-page-${page.pageNumber}`}
          className="overflow-hidden bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
          style={{ width: pageWidth }}
        >
          <img
            src={page.url}
            alt={`${title} ${page.pageNumber}페이지`}
            className="block h-auto w-full"
          />
        </div>
      ))}
    </div>
  );
}
