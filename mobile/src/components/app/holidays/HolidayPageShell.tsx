"use client";

import { useEffect, type ReactNode } from "react";

import "@/components/app/mobile-redesign/redesign.css";

import styles from "./holiday-page-shell.module.css";

const SOURCE_COMPONENT = "HolidayPageShell";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings";
/** Switches the mobile shell to the same full-height geometry the /all and /notification routes use. */
const ROUTE_BODY_CLASS = "mobile-all-route";

interface HolidayPageShellProps {
  title: string;
  children?: ReactNode;
  dataComponent?: string;
}

/** Holiday settings chrome with a single scrolling content area and list-panel title. */
export function HolidayPageShell({
  title,
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
          <div data-component={`${dataComponent}_content_card_header`} data-slot="list-panel-header" className="flex items-start justify-between gap-3">
            <div data-component={`${dataComponent}_content_card_header_title-group`} className="min-w-0 flex-1">
              <h2 className="text-[18px] font-bold leading-[1.35] text-v3-dark">{title}</h2>
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
