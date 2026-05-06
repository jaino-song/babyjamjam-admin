"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import Image from "next/image";
import { Document as PdfDocument, Page } from "react-pdf";
import { Download, Eye, Printer, X } from "lucide-react";
import "@/lib/pdf-config";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { HwpDocumentPreview } from "./hwp-document-preview";

export type PreviewKind = "pdf" | "image" | "hwp" | "unsupported";

export interface PreviewMetaItem {
  label: string;
  value: ReactNode;
  className?: string;
}

interface SharedDocumentPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  badges?: ReactNode[];
  srDescription?: string;
  metaItems: PreviewMetaItem[];
  metaAction?: ReactNode;
  metaExtra?: ReactNode;
  previewKind: PreviewKind;
  previewUrl: string;
  downloadUrl?: string;
  downloadFileName?: string;
  imageAlt?: string;
  overlayLabel?: string;
  unsupportedMessage?: ReactNode;
  previewKey?: string;
  contentClassName?: string;
}

const DEFAULT_ZOOM_PERCENT = 100;
const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 180;
const ZOOM_STEP = 5;
const PINCH_WHEEL_DELTA_PER_STEP = 40;
const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;
const IS_TEST_ENVIRONMENT = process.env.NODE_ENV === "test";

interface PointerPosition {
  x: number;
  y: number;
}

function clampZoomPercent(value: number): number {
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, value));
}

function normalizeWheelDeltaY(event: Pick<WheelEvent, "deltaMode" | "deltaY">): number {
  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    return event.deltaY * 100;
  }
  return event.deltaY;
}

export function SharedDocumentPreviewDialog({
  open,
  onClose,
  title,
  badges = [],
  srDescription,
  metaItems,
  metaAction,
  metaExtra,
  previewKind,
  previewUrl,
  downloadUrl,
  downloadFileName,
  imageAlt,
  overlayLabel,
  unsupportedMessage = "Preview not available for this file type",
  previewKey,
  contentClassName,
}: SharedDocumentPreviewDialogProps) {
  const previewDialogContentRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const pinchWheelRemainderRef = useRef(0);
  const lastPointerPositionRef = useRef<PointerPosition | null>(null);
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_ZOOM_PERCENT);
  const [numPages, setNumPages] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(0);
  const isPdf = previewKind === "pdf";
  const isImage = previewKind === "image";
  const isHwp = previewKind === "hwp";
  const isZoomablePreview = isPdf || isImage || isHwp;
  const zoomScale = zoomPercent / 100;
  const pageWidth = Math.max(previewWidth, 320) * zoomScale;

  const applyPinchZoomDelta = (event: Pick<WheelEvent, "deltaMode" | "deltaY">) => {
    pinchWheelRemainderRef.current += normalizeWheelDeltaY(event);
    const steps = Math.trunc(pinchWheelRemainderRef.current / PINCH_WHEEL_DELTA_PER_STEP);
    if (steps === 0) {
      return;
    }

    pinchWheelRemainderRef.current -= steps * PINCH_WHEEL_DELTA_PER_STEP;
    setZoomPercent((currentZoomPercent) => clampZoomPercent(currentZoomPercent - steps * ZOOM_STEP));
  };

  const getNodeAtPointerPosition = (pointerPosition: PointerPosition | null): Node | null => {
    if (!pointerPosition) {
      return null;
    }

    const elementAtPointer = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
    return elementAtPointer instanceof Node ? elementAtPointer : null;
  };

  useEffect(() => {
    const node = previewViewportRef.current;
    if (!open || (!isPdf && !isHwp) || !node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePreviewWidth = () => {
      setPreviewWidth(Math.max(node.clientWidth - 48, 320));
    };

    const frameId = window.requestAnimationFrame(updatePreviewWidth);
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updatePreviewWidth);
    });

    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isHwp, isPdf, open]);

  useEffect(() => {
    const dialogNode = previewDialogContentRef.current;
    if (!open || !dialogNode) {
      return;
    }

    const updateLastPointerPosition = (event: PointerEvent | MouseEvent) => {
      lastPointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handleDialogPinchWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      const eventTarget = event.target instanceof Node ? event.target : null;
      const pointerTarget = getNodeAtPointerPosition(
        event.clientX !== 0 || event.clientY !== 0
          ? { x: event.clientX, y: event.clientY }
          : lastPointerPositionRef.current
      );
      const dialogTarget = [eventTarget, pointerTarget].find(
        (candidate): candidate is Node => candidate instanceof Node && dialogNode.contains(candidate)
      );

      if (!dialogTarget) {
        return;
      }

      event.preventDefault();
      if (!isZoomablePreview) {
        return;
      }

      const previewCanvasNode = previewCanvasRef.current;
      const previewTarget = [eventTarget, pointerTarget].find(
        (candidate): candidate is Node => candidate instanceof Node && Boolean(previewCanvasNode?.contains(candidate))
      );

      if (!previewTarget) {
        return;
      }

      applyPinchZoomDelta(event);
    };

    document.addEventListener("pointermove", updateLastPointerPosition, { passive: true, capture: true });
    document.addEventListener("mousemove", updateLastPointerPosition, { passive: true, capture: true });
    document.addEventListener("wheel", handleDialogPinchWheel, { passive: false, capture: true });

    return () => {
      document.removeEventListener("pointermove", updateLastPointerPosition, true);
      document.removeEventListener("mousemove", updateLastPointerPosition, true);
      document.removeEventListener("wheel", handleDialogPinchWheel, true);
    };
  }, [isZoomablePreview, open]);

  const handleClose = () => {
    setZoomPercent(DEFAULT_ZOOM_PERCENT);
    pinchWheelRemainderRef.current = 0;
    setNumPages(0);
    onClose();
  };

  const handlePreviewWheelForTest = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isZoomablePreview || !event.ctrlKey) {
      return;
    }

    applyPinchZoomDelta(event);
  };

  const handlePrint = () => {
    const iframe = window.document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = previewUrl;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (error) {
        console.error("Failed to print preview", error);
      }
      setTimeout(() => {
        window.document.body.removeChild(iframe);
      }, 2000);
    };
    window.document.body.appendChild(iframe);
  };

  const handleDownload = () => {
    if (!downloadUrl) {
      return;
    }

    const link = window.document.createElement("a");
    link.href = downloadUrl;
    if (downloadFileName) {
      link.download = downloadFileName;
    }
    link.target = "_blank";
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        ref={previewDialogContentRef}
        data-component="contracts-document-preview"
        className={cn("h-[90vh] max-h-[90vh] max-w-4xl flex-col p-0", contentClassName)}
        showCloseButton={false}
      >
        <DialogHeader
          data-component="contracts-document-preview-header"
          className="flex-row items-start justify-between border-b border-border px-6 py-4"
        >
          <div>
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            {badges.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {badges.map((badge, index) => (
                  <Fragment key={`preview-badge-${index}`}>{badge}</Fragment>
                ))}
              </div>
            )}
            {srDescription && <DialogDescription className="sr-only">{srDescription}</DialogDescription>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            data-component="contracts-document-preview-meta"
            className="border-b border-border bg-muted/30 px-6 py-4"
          >
            <div className="mb-2 flex flex-wrap gap-6">
              {metaItems.map((item, index) => (
                <div key={`preview-meta-${index}`} className={item.className}>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <div className="mt-0.5 text-sm">{item.value}</div>
                </div>
              ))}
              {metaAction && <div className="ml-auto self-center">{metaAction}</div>}
            </div>
            {metaExtra}
          </div>

          <div
            data-component="document-preview-canvas"
            ref={previewCanvasRef}
            className="relative flex min-h-[400px] flex-1 flex-col overflow-hidden bg-muted/50"
            onWheel={IS_TEST_ENVIRONMENT ? handlePreviewWheelForTest : undefined}
          >
            {isPdf && (
              <div ref={previewViewportRef} className="h-full overflow-auto px-6 py-6">
                <PdfDocument
                  key={previewKey}
                  file={previewUrl}
                  loading={
                    <div className="flex min-h-full items-center justify-center">
                      <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-text shadow-sm">
                        <Spinner size="sm" className="text-v3-primary" />
                        PDF를 불러오는 중입니다
                      </div>
                    </div>
                  }
                  error={
                    <div className="flex min-h-full items-center justify-center">
                      <div className="rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-burgundy shadow-sm">
                        PDF 미리보기를 불러오지 못했습니다.
                      </div>
                    </div>
                  }
                  onLoadSuccess={({ numPages: nextNumPages }) => setNumPages(nextNumPages)}
                >
                  <div className="flex min-h-full flex-col items-center gap-6">
                    {Array.from({ length: numPages }, (_, index) => (
                      <div
                        key={`${previewKey ?? title}-page-${index + 1}`}
                        className="overflow-hidden rounded-[20px] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                      >
                        <Page
                          pageNumber={index + 1}
                          width={pageWidth}
                          renderAnnotationLayer={false}
                          renderTextLayer={false}
                        />
                      </div>
                    ))}
                  </div>
                </PdfDocument>
              </div>
            )}

            {isImage && (
              <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
                <Image
                  src={previewUrl}
                  alt={imageAlt ?? title}
                  width={1600}
                  height={1600}
                  unoptimized
                  className="max-h-full max-w-full object-contain transition-transform duration-200"
                  style={{
                    transform: `scale(${zoomScale})`,
                    transformOrigin: "center center",
                  }}
                />
              </div>
            )}

            {isHwp && (
              <div ref={previewViewportRef} className="h-full overflow-auto px-6 py-6">
                <HwpDocumentPreview
                  key={previewKey}
                  previewUrl={previewUrl}
                  previewKey={previewKey}
                  title={title}
                  pageWidth={pageWidth}
                />
              </div>
            )}

            {!isPdf && !isImage && !isHwp && (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted-foreground">{unsupportedMessage}</div>
              </div>
            )}

            {overlayLabel && (
              <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-v3-text-muted shadow-sm">
                <Eye className="h-3.5 w-3.5" />
                {overlayLabel}
              </div>
            )}

            {isZoomablePreview && (
              <div className="absolute bottom-4 right-4 z-10 flex items-center gap-3 rounded-[18px] border border-border bg-white/95 px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm">
                <div className="min-w-[3rem] text-right text-xs font-semibold text-v3-text-muted">
                  확대
                </div>
                <input
                  type="range"
                  min={MIN_ZOOM_PERCENT}
                  max={MAX_ZOOM_PERCENT}
                  step={ZOOM_STEP}
                  value={zoomPercent}
                  onChange={(event) => setZoomPercent(Number(event.target.value))}
                  className="h-2 w-32 cursor-pointer accent-[hsl(214,100%,34%)]"
                  aria-label={`${isPdf ? "PDF" : isHwp ? "한글 문서" : "이미지"} 미리보기 확대/축소`}
                />
                <div className="min-w-[3.5rem] rounded-full bg-v3-dim-white px-2.5 py-1 text-center text-xs font-semibold text-v3-dark">
                  {zoomPercent}%
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          data-component="contracts-document-preview-footer"
          className="justify-end border-t border-border px-6 py-4"
        >
          {!isHwp && (
            <Button variant="ghost" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              인쇄
            </Button>
          )}
          {downloadUrl && (
            <Button onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              다운로드
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
