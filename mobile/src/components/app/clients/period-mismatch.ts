import type { ServiceRecordAssignment, ServiceRecordCase, ServiceRecordSession } from "@babyjamjam/shared/types/service-record";

// Temporary app-local extension until the parallel backend/shared type lands.
export type PeriodMismatchSession = ServiceRecordSession & { periodMismatchKeptAt?: string | null };

export function dateDirectionParticle(date: string): "로" | "으로" {
    return "1245789".includes(date.slice(-1)) ? "로" : "으로";
}

export function displayPeriodDate(date: string): string {
    return date.slice(0, 10).replace(/-/g, ".");
}

export function outOfPeriodSessions(
    record: ServiceRecordCase | null,
    assignments: ServiceRecordAssignment[],
): PeriodMismatchSession[] {
    if (!record?.startDate || !record.endDate) return [];
    const start = record.startDate.slice(0, 10);
    const end = record.endDate.slice(0, 10);
    const windowStart = new Date(`${start}T00:00:00Z`).getTime() - 7 * 86400000;
    const windowEnd = new Date(`${end}T00:00:00Z`).getTime() + 7 * 86400000;
    const sessions = new Map<number, PeriodMismatchSession>();
    for (const assignment of assignments) {
        for (const session of assignment.sessions) {
            // Overview sessionIndex is the backend's caseSessionIndex.
            if (!sessions.has(session.sessionIndex)) sessions.set(session.sessionIndex, session);
        }
    }
    return [...sessions.values()].filter((session) => {
        const date = session.serviceDate.slice(0, 10);
        const time = new Date(`${date}T00:00:00Z`).getTime();
        return session.locked && session.sessionIndex >= 1 && session.sessionIndex <= record.totalSessions
            && time >= windowStart && time <= windowEnd && (date < start || date > end);
    }).sort((a, b) => a.sessionIndex - b.sessionIndex);
}

export function periodMismatchQuestion(sessions: PeriodMismatchSession[], startDate: string, endDate: string): string {
    const dates = sessions.map((session) => session.serviceDate.slice(0, 10)).sort();
    const early = dates.find((date) => date < startDate.slice(0, 10));
    const late = dates.filter((date) => date > endDate.slice(0, 10)).at(-1);
    const target = (date: string) => `${displayPeriodDate(date)}${dateDirectionParticle(date)}`;
    if (early && late) return `고객 정보의 서비스 시작일을 ${target(early)}, 종료일을 ${target(late)} 바꿀까요?`;
    if (early) return `고객 정보의 서비스 시작일을 ${target(early)} 바꿀까요?`;
    if (late) return `고객 정보의 서비스 종료일을 ${target(late)} 바꿀까요?`;
    return "";
}

export function periodFitToast(before: { startDate: string; endDate: string }, after: { startDate: string | null; endDate: string | null }): string | null {
    if (after.startDate === null || after.endDate === null) return null;
    const startChanged = before.startDate.slice(0, 10) !== after.startDate;
    const endChanged = before.endDate.slice(0, 10) !== after.endDate;
    if (startChanged && endChanged) return "서비스 시작일과 종료일을 바꿨어요";
    if (startChanged) return `서비스 시작일을 ${displayPeriodDate(after.startDate)}${dateDirectionParticle(after.startDate)} 바꿨어요`;
    if (endChanged) return `서비스 종료일을 ${displayPeriodDate(after.endDate)}${dateDirectionParticle(after.endDate)} 바꿨어요`;
    return null;
}
