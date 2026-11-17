import type { MobileAgentSessionSummary } from "@/hooks/useAgentChat";

/** Calendar days in the device timezone; updatedAt is the server's last activity. */
export function groupAgentSessions(sessions: MobileAgentSessionSummary[], now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const groups = ["오늘", "지난 7일", "이전"].map((label) => ({ label, sessions: [] as MobileAgentSessionSummary[] }));
    const activity = (session: MobileAgentSessionSummary) => Date.parse(session.updatedAt) || 0;
    for (const session of [...sessions].sort((a, b) => activity(b) - activity(a))) {
        const updatedAt = activity(session);
        const index = updatedAt >= today.getTime() ? 0 : updatedAt >= weekAgo.getTime() ? 1 : 2;
        groups[index].sessions.push(session);
    }
    return groups.filter((group) => group.sessions.length > 0);
}
