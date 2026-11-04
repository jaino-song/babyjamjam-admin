/**
 * Which planned sessions bear an assignment's period, and which are only a
 * trace of who wrote a row.
 *
 * An assignment period is a record of when a caregiver served. A session whose
 * planned owner was replaced or terminated, whose day row that same owner wrote,
 * and whose date lies outside the owner's period is a HISTORICAL slot: the row
 * keeps its writer (a row is never re-attributed, and finalization needs
 * planned owner == writer), but the slot says nothing about when the owner
 * served. It never widens, shrinks or moves the owner's period, and it is never
 * an anchor for a resume. An assignment whose only sessions are historical is
 * HISTORICAL-ONLY and contributes no period at all.
 *
 * This file is the single definition of that distinction. Pure functions only:
 * no Nest, no Prisma, no I/O.
 */

export interface PeriodOwnershipAssignment {
    id: string | null;
    scheduleId: number | null;
    employeeId: number | null;
    startDate: string;
    endDate: string;
    scheduleStartDate: string;
    scheduleEndDate: string;
    replaced: boolean;
    scheduleTerminatedAt: string | null;
}

/** An actual day row. Duplicate or ambiguous rows are kept as evidence and never read as a writer. */
export interface PeriodOwnershipDay {
    sessionIndex: number;
    scheduleId: number | null;
    employeeId: number | null;
    ambiguous: boolean;
}

export interface PeriodOwnershipEntry {
    sessionIndex: number;
    serviceDate: string;
    assignmentId: string;
}

export interface PeriodOwnershipPeriod {
    startDate: string;
    endDate: string;
}

/** The dates an assignment is judged against: its stored period, or the one a resume replan is about to write. */
export type PeriodOwnershipPeriodOf = (assignment: PeriodOwnershipAssignment) => PeriodOwnershipPeriod | null;

export interface PeriodOwnershipSource {
    assignments: readonly PeriodOwnershipAssignment[];
    sessions: readonly PeriodOwnershipDay[];
}

export interface PeriodSlots<TEntry extends PeriodOwnershipEntry> {
    /** The period-bearing sessions of one assignment, in the order the entries were given. */
    slots: TEntry[];
    startDate: string;
    endDate: string;
}

export interface PeriodOwnership<TEntry extends PeriodOwnershipEntry> {
    /** Per assignment, the sessions that bear its period and their min/max range. Absent: it has none. */
    periodSlots: Map<string, PeriodSlots<TEntry>>;
    /** The session indexes that are historical (kept writer) slots. */
    historicalSlots: Set<number>;
    /** Assignments that own sessions, every one of them historical. */
    historicalOnly: Set<string>;
    /** Assignments that own no session at all. */
    slotless: Set<string>;
}

export function storedAssignmentPeriod(assignment: PeriodOwnershipAssignment): PeriodOwnershipPeriod | null {
    const startDate = assignment.startDate || assignment.scheduleStartDate;
    const endDate = assignment.endDate || assignment.scheduleEndDate;
    return startDate && endDate ? { startDate, endDate } : null;
}

export function isSupersededAssignment(assignment: PeriodOwnershipAssignment): boolean {
    return assignment.replaced || Boolean(assignment.scheduleTerminatedAt);
}

/**
 * Schedule ids are autoincrement, so a caregiver who came later has the greater
 * id. The one ordering every successor rule shares (the token service, the
 * finalization match, the editor); stored dates never decide it, because they
 * may legitimately overlap (a caregiver replaced before her own start is stored
 * as [start, start]).
 */
export function scheduleFollows(laterScheduleId: number | null, earlierScheduleId: number | null): boolean {
    return laterScheduleId !== null && earlierScheduleId !== null && laterScheduleId > earlierScheduleId;
}

/**
 * Whether the session is a kept writer slot: its planned owner was replaced or
 * terminated, exactly one non-ambiguous day row exists and was written by that
 * owner (same schedule, and same employee when both name one), and the date lies
 * outside the owner's period. Zero, several or ambiguous rows never make a slot
 * historical: such a slot stays period-bearing, so the ambiguity checks that
 * look at it still fire.
 */
export function isHistoricalWriterSlot(
    source: PeriodOwnershipSource,
    entry: PeriodOwnershipEntry,
    periodOf: PeriodOwnershipPeriodOf = storedAssignmentPeriod,
): boolean {
    const owner = source.assignments.find((assignment) => assignment.id === entry.assignmentId);
    if (!owner || !isSupersededAssignment(owner)) return false;
    const rows = source.sessions.filter((session) => session.sessionIndex === entry.sessionIndex);
    const row = rows.length === 1 && !rows[0]!.ambiguous ? rows[0]! : null;
    if (!row || row.scheduleId === null || row.scheduleId !== owner.scheduleId) return false;
    if (row.employeeId !== null && owner.employeeId !== null && row.employeeId !== owner.employeeId) return false;
    const period = periodOf(owner);
    return period !== null && (entry.serviceDate < period.startDate || entry.serviceDate > period.endDate);
}

/**
 * Classify every session of `entries` and every assignment of the source.
 * `periodOf` supplies the period a historical slot is judged against: the stored
 * one by default, or the new one a resume replan is about to write.
 */
export function classifyPeriodOwnership<TEntry extends PeriodOwnershipEntry>(
    source: PeriodOwnershipSource,
    entries: readonly TEntry[],
    periodOf: PeriodOwnershipPeriodOf = storedAssignmentPeriod,
): PeriodOwnership<TEntry> {
    const historicalSlots = new Set<number>();
    const owned = new Set<string>();
    const periodSlots = new Map<string, PeriodSlots<TEntry>>();
    for (const entry of entries) {
        owned.add(entry.assignmentId);
        if (isHistoricalWriterSlot(source, entry, periodOf)) {
            historicalSlots.add(entry.sessionIndex);
            continue;
        }
        const current = periodSlots.get(entry.assignmentId);
        if (!current) {
            periodSlots.set(entry.assignmentId, { slots: [entry], startDate: entry.serviceDate, endDate: entry.serviceDate });
            continue;
        }
        current.slots.push(entry);
        if (entry.serviceDate < current.startDate) current.startDate = entry.serviceDate;
        if (entry.serviceDate > current.endDate) current.endDate = entry.serviceDate;
    }
    const historicalOnly = new Set<string>();
    const slotless = new Set<string>();
    for (const assignment of source.assignments) {
        if (!assignment.id) continue;
        if (!owned.has(assignment.id)) slotless.add(assignment.id);
        else if (!periodSlots.has(assignment.id)) historicalOnly.add(assignment.id);
    }
    return { periodSlots, historicalSlots, historicalOnly, slotless };
}
