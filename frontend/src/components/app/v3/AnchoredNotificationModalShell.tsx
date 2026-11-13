"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

interface AnchoredNotificationModalShellProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  label: string;
  "data-component"?: string;
  children: React.ReactNode;
  preferredHeight?: number;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  interactionPaused?: boolean;
}

/** Shared notification geometry; callers own the complete page header and body. */
export function AnchoredNotificationModalShell({
  open, onClose, anchorRef, label, "data-component": base, children,
  preferredHeight, onEscapeKeyDown, interactionPaused = false,
}: AnchoredNotificationModalShellProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [panelNode, setPanelNode] = React.useState<HTMLDivElement | null>(null);
  const setPanel = React.useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelNode(node);
  }, []);
  const [position, setPosition] = React.useState({ top: 12, left: 12, maxHeight: 0 });
  const updatePosition = React.useCallback(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportCap = Math.max(0, window.innerHeight - 24);
    // Natural notifications grow with their contents; jobs keep their owner's height.
    panel.style.maxHeight = `${viewportCap}px`;
    const height = Math.min(preferredHeight ?? panel.getBoundingClientRect().height, viewportCap);
    const below = rect.bottom + 12;
    const above = rect.top - 12 - height;
    const candidate = below + height <= window.innerHeight - 12 ? below : above >= 12 ? above : below;
    const top = Math.max(12, Math.min(candidate, window.innerHeight - 12 - height));
    const next = {
      top,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 412)),
      maxHeight: Math.max(0, window.innerHeight - top - 12),
    };
    panel.style.maxHeight = `${next.maxHeight}px`;
    setPosition((current) => (
      current.top === next.top && current.left === next.left && current.maxHeight === next.maxHeight
        ? current : next
    ));
  }, [anchorRef, preferredHeight]);

  // A capped panel can hide content growth from ResizeObserver. Recheck natural
  // layout after React commits; updatePosition keeps equal geometry unchanged.
  React.useLayoutEffect(() => {
    if (open && preferredHeight === undefined) updatePosition();
  });

  React.useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    const observer = typeof ResizeObserver !== "undefined" && preferredHeight === undefined
      ? new ResizeObserver(updatePosition) : null;
    if (panelNode) observer?.observe(panelNode);
    return () => {
      window.removeEventListener("resize", updatePosition);
      observer?.disconnect();
    };
  }, [open, panelNode, preferredHeight, updatePosition]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && !interactionPaused) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component={base ? `${base}_backdrop` : undefined}
          data-slot="anchored-notification-backdrop"
          className="fixed inset-0 z-[999] bg-slate-950/34 backdrop-blur-[2px]"
        />
        <DialogPrimitive.Content
          ref={setPanel}
          data-component={base || undefined}
          data-slot="anchored-notification-panel"
          data-source-component="AnchoredNotificationModalShell"
          aria-modal="true"
          aria-describedby={undefined}
          className="fixed z-[1000] w-[25rem] max-w-[calc(100vw-24px)] bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden"
          style={{
            ...position,
            height: preferredHeight === undefined ? undefined : Math.min(preferredHeight, position.maxHeight),
          }}
          onEscapeKeyDown={event => { if (interactionPaused) event.preventDefault(); else onEscapeKeyDown?.(event); }}
          onInteractOutside={event => { if (interactionPaused) event.preventDefault(); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // A higher nested modal may still own focus when this shell closes.
            if (document.activeElement === document.body || panelRef.current?.contains(document.activeElement)) {
              anchorRef.current?.focus();
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
