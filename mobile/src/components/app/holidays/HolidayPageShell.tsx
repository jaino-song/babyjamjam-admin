"use client";

import { useEffect, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";

import { StatusBadge } from "@/components/app/ui/status-badge";
import "@/components/app/mobile-redesign/redesign.css";

import styles from "./holiday-page-shell.module.css";

const SOURCE_COMPONENT = "HolidayPageShell";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings";
/** Switches the mobile shell to the same full-height geometry the /all and /notification routes use. */
const ROUTE_BODY_CLASS = "mobile-all-route";

interface HolidayPageShellProps {
  title: string;
  description: string;
  /** Shown as a pill next to the title. */
  branchName?: string | null;
  children?: ReactNode;
  dataComponent?: string;
}

/** The holiday settings page chrome: scrolling content area, white card, icon + title + description header. */
export function HolidayPageShell({
  title,
  description,
  branchName,
  children,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: HolidayPageShellProps) {
  useEffect(() => {
    document.body.classList.add(ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(ROUTE_BODY_CLASS);
    };
  }, []);

  return (
    <section
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-slot="holiday-settings-page"
      className={styles.page}
    >
      <div
        data-component={`${dataComponent}_content`}
        data-slot="holiday-settings-content"
        className={styles.content}
      >
        <div data-component={`${dataComponent}_content_card`} className="list-card pop-up">
          <div data-component={`${dataComponent}_content_card_header`} className="flex items-start gap-3">
            <div
              data-component={`${dataComponent}_content_card_header_icon`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-v3-burgundy/10"
            >
              <CalendarDays size={20} className="text-v3-burgundy" />
            </div>
            <div data-component={`${dataComponent}_content_card_header_title-group`} className="min-w-0 flex-1">
              <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-bold text-v3-dark">
                {title}
                {branchName ? (
                  <StatusBadge
                    data-component={`${dataComponent}_content_card_header_title-group_branch-pill`}
                    data-slot="holiday-branch-pill"
                    variant="primary"
                    className="max-w-full truncate"
                  >
                    {branchName}
                  </StatusBadge>
                ) : null}
              </h2>
              <p className="mt-0.5 text-xs leading-relaxed text-v3-text-muted">{description}</p>
            </div>
          </div>
          {children ? (
            <div data-component={`${dataComponent}_content_card_body`} className="mt-5 grid gap-4">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
