import {
  getClientBadgeStatusToken,
  getDefaultClientBadgeStatusToken,
} from "@babyjamjam/shared/tokens/status-badge";

import type {
  Client,
  ClientBadge,
  ClientBadgeKey,
  ClientBadgeStatus,
  ClientBadgeTone,
} from "@/lib/client/types";

export type MobileClientBadgeTone = "burgundy" | "primary" | "muted" | "green" | "orange";

export interface MobileClientBadge {
  key: ClientBadgeKey;
  status: ClientBadgeStatus;
  label: string;
  tone: MobileClientBadgeTone;
  priority: number;
}

const PRIMARY_CLIENT_BADGE_KEYS = ["contract_required", "service_status"] as const satisfies readonly ClientBadgeKey[];

const CLIENT_BADGE_ORDER: Record<ClientBadgeKey, number> = {
  contract_required: 10,
  service_status: 20,
  breast_pump: 30,
  care_center: 40,
};

const CLIENT_BADGE_TONE_BY_VARIANT = {
  danger: "burgundy",
  success: "green",
  primary: "primary",
  info: "primary",
  warning: "orange",
  neutral: "muted",
} as const satisfies Record<string, MobileClientBadgeTone>;

const CLIENT_BADGE_TONE_BY_TONE = {
  danger: "burgundy",
  success: "green",
  primary: "primary",
  warning: "orange",
  neutral: "muted",
} as const satisfies Record<ClientBadgeTone, MobileClientBadgeTone>;

function mapServiceStatusToBadgeStatus(status: Client["serviceStatus"]): ClientBadgeStatus {
  switch (status) {
    case "pre_booking":
      return "preBooking";
    case "active":
      return "active";
    case "waiting":
      return "pending";
    case "replacement_requested":
    case "terminated":
      return "terminated";
    case "completed":
      return "completed";
    default:
      return "pending";
  }
}

function legacyClientBadges(client: Client): ClientBadge[] {
  const badges: ClientBadge[] = [];

  if (client.serviceStatus === "active" && client.documentStatus !== "completed") {
    badges.push({
      key: "contract_required",
      status: "terminated",
      priority: CLIENT_BADGE_ORDER.contract_required,
    });
  }

  badges.push({
    key: "service_status",
    status: mapServiceStatusToBadgeStatus(client.serviceStatus),
    label:
      client.serviceStatus === "pre_booking"
        ? "예약 전"
        : client.serviceStatus === "replacement_requested"
          ? "교체 요청"
          : undefined,
    priority: CLIENT_BADGE_ORDER.service_status,
  });

  if (client.breastPump) {
    badges.push({
      key: "breast_pump",
      status: "breastPump",
      priority: CLIENT_BADGE_ORDER.breast_pump,
    });
  }

  if (client.careCenter) {
    badges.push({
      key: "care_center",
      status: "careCenter",
      priority: CLIENT_BADGE_ORDER.care_center,
    });
  }

  return badges;
}

export function getClientBadges(client: Client | null | undefined): ClientBadge[] {
  if (!client) return [];
  return client.badges?.length ? client.badges : legacyClientBadges(client);
}

export function prioritizeClientBadges(badges: ClientBadge[]): ClientBadge[] {
  const prioritizedBadges = PRIMARY_CLIENT_BADGE_KEYS
    .map((key) => badges.find((badge) => badge.key === key))
    .filter((badge): badge is ClientBadge => Boolean(badge));
  const prioritizedKeys = new Set(prioritizedBadges.map((badge) => badge.key));

  return [
    ...prioritizedBadges,
    ...badges.filter((badge) => !prioritizedKeys.has(badge.key)),
  ];
}

export function getPrimaryClientBadge(badges: ClientBadge[]): ClientBadge | null {
  return prioritizeClientBadges(badges)[0] ?? null;
}

export function toMobileClientBadge(badge: ClientBadge, fallbackIndex = 0): MobileClientBadge {
  const token = getClientBadgeStatusToken(badge.key, badge.status) ?? getDefaultClientBadgeStatusToken(badge.status);
  const variantTone = CLIENT_BADGE_TONE_BY_VARIANT[token.variant];
  const tone = badge.tone ? CLIENT_BADGE_TONE_BY_TONE[badge.tone] : variantTone;

  return {
    key: badge.key,
    status: badge.status,
    label: badge.label ?? token.defaultLabel,
    tone,
    priority: CLIENT_BADGE_ORDER[badge.key] ?? 100 + fallbackIndex,
  };
}

export function getMobileClientBadges(client: Client | null | undefined): MobileClientBadge[] {
  return prioritizeClientBadges(getClientBadges(client)).map(toMobileClientBadge);
}
