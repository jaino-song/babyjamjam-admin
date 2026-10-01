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
 * date field itself.
 */
export function ServiceRecordCalendarBanner({
    "data-component": dataComponent,
    error,
    loading,
    onRetry,
}: ServiceRecordCalendarBannerProps) {
    return (
        <div
            className="fixed inset-x-0 bottom-0 z-40 flex justify-center border-t bg-background/95 px-4 py-3"
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
