"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCalendarFromHolidayYears = buildCalendarFromHolidayYears;
exports.holidayYearsToRequest = holidayYearsToRequest;
const business_days_1 = require("./business-days");
/**
 * Turns holiday-year payloads into the one calendar object every consumer
 * (desktop, mobile, backend) uses. Only `supported` years are supported by the
 * result, so an unfetched or unsupported year still fails closed.
 */
function buildCalendarFromHolidayYears(years) {
    const seenYears = new Set();
    const supportedYears = [];
    const holidayDates = [];
    let maxRevision = 0;
    for (const payload of years) {
        if (!Number.isInteger(payload.year)) {
            throw new Error(`Invalid holiday payload year: ${payload.year}`);
        }
        if (seenYears.has(payload.year)) {
            throw new Error(`Duplicate holiday payload for year ${payload.year}`);
        }
        seenYears.add(payload.year);
        if (payload.revision > maxRevision)
            maxRevision = payload.revision;
        if (!payload.supported)
            continue;
        supportedYears.push(payload.year);
        for (const holiday of payload.holidays) {
            if (Number(holiday.date.slice(0, 4)) !== payload.year) {
                throw new Error(`Holiday ${holiday.date} is outside its payload year ${payload.year}`);
            }
            if (holiday.excluded !== true)
                holidayDates.push(holiday.date);
        }
    }
    supportedYears.sort((a, b) => a - b);
    return (0, business_days_1.createKrBusinessDayCalendar)(holidayDates, {
        version: `kr-api-r${maxRevision}-y${supportedYears.join(",")}`,
        supportedYears,
    });
}
/** Years the apps fetch for a given day: previous, current and next year. */
function holidayYearsToRequest(todayIso) {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(todayIso);
    if (!match)
        throw new Error(`Invalid ISO date (expected YYYY-MM-DD): ${todayIso}`);
    const year = Number(match[1]);
    return [year - 1, year, year + 1];
}
