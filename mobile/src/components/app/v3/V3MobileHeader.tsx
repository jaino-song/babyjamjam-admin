"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";
import { useInitialUser } from "@/providers/UserProvider";
import { cn } from "@/lib/utils";
import "@/components/app/mobile-redesign/redesign.css";

const DEFAULT_USER_LABEL = "사용자";
const DEFAULT_BRANCH_LABEL = "지점 미선택";
const SOURCE_COMPONENT = "V3MobileHeader";

interface V3MobileHeaderProps {
  /** Canonical caller-context base, e.g. "mobile_shell_header". */
  "data-component": string;
  "data-slot"?: string;
  leadingSlot?: ReactNode;
  trailingSlot?: ReactNode;
  /** Render inside a route's own shell instead of the fixed global header. */
  embedded?: boolean;
  /** Disable the bell while a route-owned modal drawer contains focus. */
  notificationsDisabled?: boolean;
  className?: string;
}

export function V3MobileHeader({
  "data-component": dataComponent,
  "data-slot": dataSlot = "mobile-header",
  leadingSlot,
  trailingSlot,
  embedded = false,
  notificationsDisabled = false,
  className,
}: V3MobileHeaderProps) {
  const pathname = usePathname();
  const user = useInitialUser();

  if (!pathname || (!embedded && (pathname === "/agent" || pathname === "/chat")) || isLayoutExcluded(pathname)) return null;

  const userLabel = user?.name ? `${user.name} 님` : DEFAULT_USER_LABEL;
  const branchLabel = user?.branchName ?? DEFAULT_BRANCH_LABEL;
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <header
      data-component={dataComponent}
      data-slot={dataSlot}
      data-source-component={SOURCE_COMPONENT}
      className={cn("existing-navbar", embedded ? "relative w-full" : "fixed top-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2", className)}
    >
      {leadingSlot}
      <div className={cn("navbar-identity", Boolean(leadingSlot) && "flex-1")} data-component={sub("identity")} data-slot="mobile-header-identity">
        <div className="navbar-text" data-component={sub("text")} data-slot="mobile-header-text">
          <span data-slot="mobile-header-user" className="navbar-user">{userLabel}</span>
          <span data-slot="mobile-header-branch" className="navbar-branch">{branchLabel}</span>
        </div>
      </div>
      <div className="navbar-icons" data-component={sub("icons")} data-slot="mobile-header-icons">
        {trailingSlot}
        <NotificationBell data-component={`${sub("icons")}_notification-bell`} disabled={notificationsDisabled} className="!rounded-xl bg-transparent hover:bg-transparent hover:scale-100 active:scale-100 text-v3-text" />
      </div>
    </header>
  );
}
