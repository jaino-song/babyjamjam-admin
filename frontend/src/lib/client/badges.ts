import { getClientBadgeStatusToken } from "@babyjamjam/shared/tokens/status-badge";
import { legacyClientBadges } from "@babyjamjam/shared/client/badges";

import { STATUS_SURFACE } from "@/components/app/ui/status-surface";
import type { Client, ClientBadge, ClientBadgeTone } from "@/lib/client/types";

// "정보 불일치" leads so the list shows its warning icon first; every other badge then
// sits behind +N. It never colours the avatar, which keeps the service-status tone.
export const CONTRACT_INFO_MISMATCH_BADGE_KEY = "contract_info_mismatch" as const satisfies ClientBadge["key"];

const PRIMARY_CLIENT_BADGE_KEYS = [
    CONTRACT_INFO_MISMATCH_BADGE_KEY,
    "contract_required",
    "contract_status",
    "service_status",
] as const satisfies readonly ClientBadge["key"][];

const CLIENT_BADGE_AVATAR_CLASS_BY_TONE: Record<ClientBadgeTone, string> = {
    danger: `border ${STATUS_SURFACE.danger}`,
    success: `border ${STATUS_SURFACE.success}`,
    primary: `border ${STATUS_SURFACE.primary}`,
    warning: `border ${STATUS_SURFACE.warning}`,
    neutral: `border ${STATUS_SURFACE.neutral}`,
};

export const prioritizeClientBadges = (badges: ClientBadge[]): ClientBadge[] => {
    const prioritizedBadges = [
        ...PRIMARY_CLIENT_BADGE_KEYS.map((key) => badges.find((badge) => (
            badge.key === key
        ))),
    ]
        .filter((badge): badge is ClientBadge => Boolean(badge));
    const prioritizedBadgeSet = new Set(prioritizedBadges);

    return [
        ...prioritizedBadges,
        ...badges.filter((badge) => !prioritizedBadgeSet.has(badge)),
    ];
};

export const getClientBadges = (
    client:
        | (Pick<Client, "badges">
            & Partial<Pick<Client, "serviceStatus" | "documentStatus" | "breastPump" | "careCenter">>)
        | null
        | undefined,
): ClientBadge[] => {
    // The backend's badges array is the authority; the shared legacy builder only
    // backstops payloads without it, identically to mobile.
    const badges = client?.badges?.length ? client.badges : client ? legacyClientBadges(client) : [];
    return prioritizeClientBadges(badges);
};

export const getPrimaryClientBadge = (badges: ClientBadge[]): ClientBadge | null => {
    return prioritizeClientBadges(badges)[0] ?? null;
};

export const isContractInfoMismatchBadge = (badge: Pick<ClientBadge, "key"> | null | undefined): boolean => (
    badge?.key === CONTRACT_INFO_MISMATCH_BADGE_KEY
);

/** The badge whose tone colours the client avatar: the primary one, skipping "정보 불일치". */
export const getClientAvatarBadge = (badges: ClientBadge[]): ClientBadge | null => {
    return prioritizeClientBadges(badges).find((badge) => !isContractInfoMismatchBadge(badge)) ?? null;
};

export const getClientBadgeAvatarClassName = (badge: Pick<ClientBadge, "key" | "status" | "tone"> | null | undefined): string => {
    const tokenVariant = badge ? getClientBadgeStatusToken(badge.key, badge.status)?.variant : null;
    const tone = tokenVariant === "info" ? "primary" : tokenVariant ?? badge?.tone ?? "warning";
    return CLIENT_BADGE_AVATAR_CLASS_BY_TONE[tone];
};
