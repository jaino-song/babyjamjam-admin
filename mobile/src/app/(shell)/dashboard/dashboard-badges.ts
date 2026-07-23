import type { ListRow } from "@/components/app/mobile-redesign/mockup-data";

export type DashboardStatusBadge = {
  label: string;
  tone: ListRow["badgeTone"];
  order: number;
  due?: string;
  dueSub?: string;
  dueTone?: ListRow["dueTone"];
};

export function compactDashboardBadges(
  badges: DashboardStatusBadge[],
): DashboardStatusBadge[] {
  const byLabel = new Map<string, DashboardStatusBadge>();

  for (const badge of badges) {
    const existing = byLabel.get(badge.label);
    if (!existing || badge.order < existing.order) {
      byLabel.set(badge.label, badge);
    }
  }

  const ordered = [...byLabel.values()].sort((a, b) => a.order - b.order);
  const visible = ordered.length > 2 ? ordered.slice(0, 2) : ordered;

  return visible;
}
