import type { Client, ClientBadge, ClientBadgeTone } from "@/lib/client/types";

const SCHEDULE_CHANGE_BADGE_LABEL = "일정 변경";

const CLIENT_BADGE_AVATAR_CLASS_BY_TONE: Record<ClientBadgeTone, string> = {
    danger: "border border-[hsla(355,36%,45%,0.20)] bg-[hsl(355,40%,94%)] text-[hsl(355,36%,45%)]",
    success: "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green",
    primary: "border border-[hsl(214,70%,85%)] bg-[hsl(214,80%,95%)] text-v3-primary",
    warning: "border border-[hsla(38,92%,35%,0.18)] bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)]",
    neutral: "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-v3-text-muted",
};

export const applyScheduleChangeBadge = (
    client: Pick<Client, "pendingScheduleChange"> | null | undefined,
    badges: ClientBadge[],
): ClientBadge[] => {
    if (!client?.pendingScheduleChange) {
        return badges;
    }

    const serviceStatusBadge = badges.find((badge) => badge.key === "service_status");
    const otherBadges = badges.filter((badge) => badge.key !== "service_status");

    return [
        {
            key: "service_status",
            status: "scheduleChange",
            label: SCHEDULE_CHANGE_BADGE_LABEL,
            tone: "danger",
            priority: serviceStatusBadge?.priority ?? 0,
        },
        ...otherBadges,
    ];
};

export const getClientBadges = (client: Pick<Client, "badges" | "pendingScheduleChange"> | null | undefined): ClientBadge[] => {
    return applyScheduleChangeBadge(client, client?.badges ?? []);
};

export const getClientBadgeAvatarClassName = (badge: Pick<ClientBadge, "tone"> | null | undefined): string => {
    return CLIENT_BADGE_AVATAR_CLASS_BY_TONE[badge?.tone ?? "warning"];
};
