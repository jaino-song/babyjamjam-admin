import { HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";

import type { ProblemCode } from "@babyjamjam/shared/errors/problem-details";

import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    BranchHolidayOverrideRecord,
    HOLIDAY_CALENDAR_REPOSITORY,
    HolidayOverrideConflictError,
    HolidayOverrideKind,
    IHolidayCalendarRepository,
} from "domain/repositories/holiday-calendar.repository.interface";
import { isoDateInKorea } from "domain/utils/business-days";
import { HolidayCalendarService } from "./holiday-calendar.service";

export const HOLIDAY_NAME_MAX_LENGTH = 50;

export interface CreateHolidayOverrideInput {
    /** ISO `YYYY-MM-DD`. */
    date: string;
    kind: HolidayOverrideKind;
    name?: string | null;
}

export interface HolidayOverrideView {
    id: string;
    date: string;
    kind: HolidayOverrideKind;
    name: string | null;
    createdAt: string;
}

/** The status always comes from the catalog; any other status is rewritten to 500 by the filter. */
function holidayProblem(code: ProblemCode): HttpException {
    return new HttpException(codeOnlyProblemBody(code), PROBLEM_CATALOG[code].status);
}

function isWeekend(iso: string): boolean {
    const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
}

function toView(record: BranchHolidayOverrideRecord): HolidayOverrideView {
    return {
        id: record.id,
        date: record.date,
        kind: record.kind,
        name: record.name,
        createdAt: record.createdAt.toISOString(),
    };
}

@Injectable()
export class HolidayOverrideService {
    constructor(
        @Inject(HOLIDAY_CALENDAR_REPOSITORY) private readonly repository: IHolidayCalendarRepository,
        private readonly calendarService: HolidayCalendarService,
    ) {}

    async createOverride(
        branchId: string,
        createdBy: string | null,
        input: CreateHolidayOverrideInput,
    ): Promise<HolidayOverrideView> {
        const { date, kind } = input;
        const name = typeof input.name === "string" ? input.name.trim() : "";

        // Checks that need no DB read run before the transaction takes the revision lock.
        if (date < isoDateInKorea()) throw holidayProblem("HOLIDAY_DATE_IN_PAST");
        if (kind === "add" && (name.length < 1 || name.length > HOLIDAY_NAME_MAX_LENGTH)) {
            throw holidayProblem("HOLIDAY_NAME_REQUIRED");
        }

        try {
            const created = await this.repository.withOverrideTransaction(async (tx) => {
                const lookup = await tx.lookupPublicHoliday(date);
                if (!lookup.yearSupported) throw holidayProblem("HOLIDAY_YEAR_UNSUPPORTED");

                let storedName: string | null;
                if (kind === "add") {
                    if (lookup.publicName !== null) throw holidayProblem("HOLIDAY_ALREADY_PUBLIC");
                    if (isWeekend(date)) throw holidayProblem("HOLIDAY_NOT_WEEKDAY");
                    storedName = name;
                } else {
                    if (lookup.publicName === null) throw holidayProblem("HOLIDAY_NOT_PUBLIC");
                    storedName = name.length > 0 ? name : lookup.publicName;
                }

                const record = await tx.insertOverride({ branchId, date, kind, name: storedName, createdBy });
                await tx.insertBranchChangeEvent({
                    branchId,
                    date,
                    change: kind === "add" ? "added" : "removed",
                    name: storedName,
                });
                return record;
            });
            return toView(created);
        } catch (error) {
            if (error instanceof HolidayOverrideConflictError) throw holidayProblem("HOLIDAY_OVERRIDE_EXISTS");
            throw error;
        } finally {
            // Also on failure: the transaction may have committed before the error surfaced.
            this.calendarService.invalidateRevisionCache();
        }
    }

    async deleteOverride(branchId: string, id: string): Promise<void> {
        try {
            await this.repository.withOverrideTransaction(async (tx) => {
                const existing = await tx.findOverride(id, branchId);
                if (!existing) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                if (existing.date < isoDateInKorea()) throw holidayProblem("HOLIDAY_DATE_IN_PAST");

                const removed = await tx.deleteOverride(id, branchId);
                if (!removed) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));

                // The inverse event is only meaningful when the date's effective state flips back.
                const lookup = await tx.lookupPublicHoliday(existing.date);
                const isPublic = lookup.publicName !== null;
                if (existing.kind === "add" && !isPublic) {
                    await tx.insertBranchChangeEvent({ branchId, date: existing.date, change: "removed", name: existing.name });
                } else if (existing.kind === "exclude" && isPublic) {
                    await tx.insertBranchChangeEvent({ branchId, date: existing.date, change: "added", name: lookup.publicName });
                }
            });
        } finally {
            this.calendarService.invalidateRevisionCache();
        }
    }
}
