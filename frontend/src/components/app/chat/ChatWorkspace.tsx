"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DetailPanel } from "@/components/app/v3/DetailPanel";

const COMPACT_QUERY = "(max-width: 1279px)";
function subscribe(onChange: () => void) {
    const media = window.matchMedia(COMPACT_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}
function compactSnapshot() { return window.matchMedia(COMPACT_QUERY).matches; }

interface ChatWorkspaceProps {
    "data-component": string;
    stats: ReactNode;
    list: (close: () => void) => ReactNode;
    header: (menu: ReactNode) => ReactNode;
    children: ReactNode;
}

/** Shared presentation only. Each controller keeps its sessions, transport and actions. */
export function ChatWorkspace({ "data-component": base, stats, list, header, children }: ChatWorkspaceProps) {
    const compact = useSyncExternalStore(subscribe, compactSnapshot, () => false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [desktopOpen, setDesktopOpen] = useState(true);
    const menuRef = useRef<HTMLButtonElement>(null);
    const open = compact ? drawerOpen : desktopOpen;
    const [previousCompact, setPreviousCompact] = useState(compact);
    if (previousCompact !== compact) {
        setPreviousCompact(compact);
        if (!compact) setDrawerOpen(false);
    }
    const close = () => setDrawerOpen(false);
    const menu = <Button ref={menuRef} data-component={`${base}_thread_header_menu`} type="button" variant="ghost" size="icon" aria-label="사이드바 열기" aria-expanded={open} aria-controls={`${base}-sidebar`} onClick={() => compact ? setDrawerOpen((value) => !value) : setDesktopOpen((value) => !value)}><Menu className="h-4 w-4" /></Button>;

    return (
        <Sheet open={compact && drawerOpen} onOpenChange={setDrawerOpen}>
            <section data-component={base} data-source-component="ChatWorkspace" data-slot="chat-workspace" data-chat-workspace-controls="" inert={compact && drawerOpen} className="chat-workspace flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
                {stats}
                <div data-slot="chat-workspace-panels" className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-hidden">
                    {!compact && desktopOpen && <aside id={`${base}-sidebar`} className="w-[30%] min-w-60 max-w-80 shrink-0">{list(close)}</aside>}
                    <div data-slot="chat-workspace-thread" className="chat-workspace-thread min-h-0 min-w-0 flex-1">
                        <DetailPanel data-component={`${base}_thread`} header={header(menu)}>{children}</DetailPanel>
                    </div>
                </div>
            </section>
            {compact && <SheetContent side="left" id={`${base}-sidebar`} data-component={`${base}_sidebar-drawer`} data-source-component="ChatWorkspace" data-chat-workspace-controls="" aria-describedby={undefined} className="gap-0 p-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]" onCloseAutoFocus={(event) => { event.preventDefault(); menuRef.current?.focus(); }}>
                <div data-component={`${base}_sidebar-drawer_header`} className="flex shrink-0 items-center justify-between px-3 py-2">
                    <SheetTitle data-component={`${base}_sidebar-drawer_header_title`}>대화 목록</SheetTitle>
                    <Button data-component={`${base}_sidebar-drawer_header_close`} type="button" variant="ghost" size="icon" aria-label="사이드바 닫기" onClick={close}><X className="h-4 w-4" /></Button>
                </div>
                <div className="min-h-0 flex-1">{list(close)}</div>
            </SheetContent>}
        </Sheet>
    );
}
