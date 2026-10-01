"use client";

import { CalendarLoadNotice } from "@/components/app/holidays/calendar-load-notice";
import type { BusinessDayCalendarError } from "@/hooks/useBusinessDayCalendar";

const SOURCE_COMPONENT = "ServiceRecordCalendarBanner";

interface ServiceRecordCalendarBannerProps {
    "data-component": string;
    error: BusinessDayCalendarError;
    loading: boolean;
    onRetry: () => void;
}

/**
 * Bottom banner for the public service-record page while its branch holiday
 * calendar is loading or failed to load. Saved date computations wait for the
 * calendar, so the caregiver needs a visible reason (and a retry) outside the
 * date field itself. It is sticky, not fixed: it takes its own space after the
 * page content, so it never covers the page bottom (the last buttons stay
 * reachable), and it clears the home-indicator safe area.
 */
export function ServiceRecordCalendarBanner({
    "data-component": dataComponent,
    error,
    loading,
    onRetry,
}: ServiceRecordCalendarBannerProps) {
    return (
        <div
            className="sticky inset-x-0 bottom-0 z-40 flex justify-center border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            data-component={dataComponent}
            data-source-component={SOURCE_COMPONENT}
        >
            <CalendarLoadNotice
                error={error}
                loading={loading}
                onRetry={onRetry}
                dataComponent={`${dataComponent}_notice`}
            />
        </div>
    );
}
